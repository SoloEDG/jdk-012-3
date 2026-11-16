/**
 * IndexedDB 实现的存储层。浏览器端唯一持久化实现。
 * 关键不变量见 storeTypes.ts 头部注释。
 */
import type {
  ExhibitionManifest,
  MigrationEntry,
  StoredExhibition,
} from "./types";
import {
  DEFAULT_BUDGET_BYTES,
  META_ACTIVE,
  META_BUDGET,
  type CapacitySnapshot,
  type CommitInput,
  type ExchangeStore,
  type StagedAsset,
} from "./storeTypes";

const DB_NAME = "yujing-exchange";
const DB_VERSION = 1;

type AssetRow = {
  hash: string;
  mime: string;
  bytes: ArrayBuffer;
  size: number;
  refs: number;
  owners: string[];
  lastUsed: number;
};

type ExhibitionRow = StoredExhibition & { id: string };

type StagingRow = {
  sessionId: number;
  hash: string;
  mime: string;
  bytes: ArrayBuffer;
  size: number;
};

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("事务被中止"));
    tx.onerror = () => reject(tx.error);
  });
}

export async function openIdbStore(): Promise<ExchangeStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("meta", { keyPath: "key" });
      d.createObjectStore("exhibitions", { keyPath: "id" });
      d.createObjectStore("assets", { keyPath: "hash" });
      const staging = d.createObjectStore("staging", {
        keyPath: ["sessionId", "hash"],
      });
      staging.createIndex("bySession", "sessionId");
      d.createObjectStore("migrations", { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  const store = (names: string[], mode: IDBTransactionMode) =>
    db.transaction(names, mode);

  async function getMeta<T>(key: string): Promise<T | undefined> {
    const row = await req<{ key: string; value: T } | undefined>(
      store(["meta"], "readonly").objectStore("meta").get(key),
    );
    return row?.value;
  }

  async function setMeta(key: string, value: unknown): Promise<void> {
    const tx = store(["meta"], "readwrite");
    tx.objectStore("meta").put({ key, value });
    await txDone(tx);
  }

  async function getActive(): Promise<StoredExhibition | null> {
    const id = await getMeta<string>(META_ACTIVE);
    if (!id) return null;
    const row = await req<ExhibitionRow | undefined>(
      store(["exhibitions"], "readonly").objectStore("exhibitions").get(id),
    );
    return row ?? null;
  }

  /** 在事务内递减某展览的资源引用；refs 归零即删除（大资源尽早释放）。
   *  keepHashes 中的哈希跳过（同一展览新版本中仍然保留的资源）。 */
  async function releaseAssets(
    tx: IDBTransaction,
    ownerId: string,
    manifest: ExhibitionManifest,
    keepHashes?: ReadonlySet<string>,
  ): Promise<number> {
    const assets = tx.objectStore("assets");
    let freed = 0;
    for (const meta of manifest.assets) {
      if (keepHashes?.has(meta.hash)) continue;
      const row = await req<AssetRow | undefined>(assets.get(meta.hash));
      if (!row) continue;
      row.refs -= 1;
      row.owners = row.owners.filter((o) => o !== ownerId);
      if (row.refs <= 0) {
        freed += row.size;
        assets.delete(row.hash);
      } else {
        assets.put(row);
      }
    }
    return freed;
  }

  async function commit(input: CommitInput): Promise<void> {
    const now = Date.now();
    const tx = store(
      ["exhibitions", "assets", "staging", "meta", "migrations"],
      "readwrite",
    );
    // 任何校验失败都必须显式 abort：直接 throw 只会让事务自动提交，
    // 无法回滚 —— 这是保证“绝不新旧混搭”的关键。
    try {
      await commitBody(tx, input, now);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // 事务可能已结束
      }
      throw e;
    }
    await txDone(tx);
  }

  async function commitBody(
    tx: IDBTransaction,
    input: CommitInput,
    now: number,
  ): Promise<void> {
    const exhibitions = tx.objectStore("exhibitions");
    const assets = tx.objectStore("assets");
    const staging = tx.objectStore("staging");
    const meta = tx.objectStore("meta");
    const migrations = tx.objectStore("migrations");

    // 1. 读取本会话的暂存资源
    const stagedRows = await req<StagingRow[]>(
      staging.index("bySession").getAll(input.sessionId),
    );
    const staged = new Map(stagedRows.map((r) => [r.hash, r]));

    // 2. 定位“同 id 前版本”（可能是当前展览，也可能是已归档的旧版本）
    const activeIdRow = await req<{ key: string; value: string } | undefined>(
      meta.get(META_ACTIVE),
    );
    const oldActiveId = activeIdRow?.value;
    const previousVersion = await req<ExhibitionRow | undefined>(
      exhibitions.get(input.manifest.id),
    );
    const newHashes = new Set(input.manifest.assets.map((a) => a.hash));

    // 3. 写入/认领新展览的资源：已存在且未被本展览持有的 → 引用 +1；
    //    本展览（前版本）已持有的 → 保持不变，避免重复计数
    for (const metaAsset of input.manifest.assets) {
      const existing = await req<AssetRow | undefined>(
        assets.get(metaAsset.hash),
      );
      if (existing) {
        if (!existing.owners.includes(input.manifest.id)) {
          existing.owners.push(input.manifest.id);
          existing.refs += 1;
        }
        existing.lastUsed = now;
        assets.put(existing);
      } else {
        const row = staged.get(metaAsset.hash);
        if (!row) {
          throw new Error(`暂存区缺少资源 ${metaAsset.hash}，提交中止`);
        }
        assets.put({
          hash: row.hash,
          mime: row.mime,
          bytes: row.bytes,
          size: row.size,
          refs: 1,
          owners: [input.manifest.id],
          lastUsed: now,
        } satisfies AssetRow);
      }
    }

    // 3. 清理本会话暂存
    for (const row of stagedRows) {
      staging.delete([input.sessionId, row.hash]);
    }

    // 5. 移除同 id 前版本：只释放“新版本中已不存在”的资源
    if (previousVersion) {
      await releaseAssets(
        tx,
        previousVersion.id,
        previousVersion.manifest,
        newHashes,
      );
      exhibitions.delete(previousVersion.id);
    }

    // 6. 旧展转为归档：资源引用保持不变（归档保留资源，可被快速恢复；
    //    只有在容量压力下才按 LRU 回收）
    if (oldActiveId && oldActiveId !== input.manifest.id) {
      const old = await req<ExhibitionRow | undefined>(
        exhibitions.get(oldActiveId),
      );
      if (old) {
        old.status = "archived";
        old.archivedAt = now;
        exhibitions.put(old);
      }
    }

    // 7. 执行预览时批准的归档回收
    for (const id of input.evictions) {
      const row = await req<ExhibitionRow | undefined>(exhibitions.get(id));
      if (!row || row.status !== "archived" || row.assetsCleared) continue;
      await releaseAssets(tx, row.id, row.manifest);
      row.assetsCleared = true;
      exhibitions.put(row);
    }

    // 8. 写入新展览、切换 active 指针、记录迁移日志
    exhibitions.put({
      id: input.manifest.id,
      manifest: input.manifest,
      status: "active",
      importedAt: now,
    } satisfies ExhibitionRow);
    meta.put({ key: META_ACTIVE, value: input.manifest.id });
    migrations.add(input.migration);

    // 9. 不变量检查：总占用不得超过预算，否则整个事务回滚
    const budget =
      (await req<{ key: string; value: number } | undefined>(meta.get(META_BUDGET)))
        ?.value ?? DEFAULT_BUDGET_BYTES;
    let total = 0;
    const cursorReq = assets.openCursor();
    await new Promise<void>((resolve, reject) => {
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          total += (cursor.value as AssetRow).size;
          cursor.continue();
        } else resolve();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    if (total > budget) {
      throw new Error(
        `容量不变量检查失败：${total} 字节超过预算 ${budget}，提交已回滚`,
      );
    }
  }

  const api: ExchangeStore = {
    async bootCleanup() {
      const tx = store(["staging", "exhibitions"], "readwrite");
      const staging = tx.objectStore("staging");
      const count = await req<number>(staging.count());
      staging.clear();
      // 防御：清除可能残留的 staged 状态展览行
      const exhibitions = tx.objectStore("exhibitions");
      const all = await req<ExhibitionRow[]>(exhibitions.getAll());
      for (const row of all) {
        if (row.status === "staged") exhibitions.delete(row.id);
      }
      await txDone(tx);
      return { removedStaging: count };
    },

    getMeta,
    setMeta,
    getActive,

    async getExhibition(id) {
      const row = await req<ExhibitionRow | undefined>(
        store(["exhibitions"], "readonly").objectStore("exhibitions").get(id),
      );
      return row ?? null;
    },

    async listExhibitions() {
      return req<StoredExhibition[]>(
        store(["exhibitions"], "readonly").objectStore("exhibitions").getAll(),
      );
    },

    async installActive(manifest, assetList) {
      const now = Date.now();
      const tx = store(["exhibitions", "assets", "meta"], "readwrite");
      const exhibitions = tx.objectStore("exhibitions");
      const assets = tx.objectStore("assets");
      const meta = tx.objectStore("meta");
      const activeIdRow = await req<{ key: string; value: string } | undefined>(
        meta.get(META_ACTIVE),
      );
      if (activeIdRow?.value) {
        const old = await req<ExhibitionRow | undefined>(
          exhibitions.get(activeIdRow.value),
        );
        if (old) {
          await releaseAssets(tx, old.id, old.manifest);
          exhibitions.delete(old.id);
        }
      }
      for (const a of assetList) {
        const existing = await req<AssetRow | undefined>(assets.get(a.hash));
        if (existing) {
          existing.refs += 1;
          if (!existing.owners.includes(manifest.id))
            existing.owners.push(manifest.id);
          existing.lastUsed = now;
          assets.put(existing);
        } else {
          assets.put({
            hash: a.hash,
            mime: a.mime,
            bytes: a.bytes.buffer as ArrayBuffer,
            size: a.bytes.byteLength,
            refs: 1,
            owners: [manifest.id],
            lastUsed: now,
          } satisfies AssetRow);
        }
      }
      exhibitions.put({
        id: manifest.id,
        manifest,
        status: "active",
        importedAt: now,
      } satisfies ExhibitionRow);
      meta.put({ key: META_ACTIVE, value: manifest.id });
      await txDone(tx);
    },

    async existingHashes() {
      const keys = await req<IDBValidKey[]>(
        store(["assets"], "readonly").objectStore("assets").getAllKeys(),
      );
      return new Set(keys.map(String));
    },

    async capacitySnapshot(): Promise<CapacitySnapshot> {
      const tx = store(["assets", "staging", "exhibitions", "meta"], "readonly");
      const assetRows = await req<AssetRow[]>(tx.objectStore("assets").getAll());
      const stagingRows = await req<StagingRow[]>(
        tx.objectStore("staging").getAll(),
      );
      const exhibitionRows = await req<ExhibitionRow[]>(
        tx.objectStore("exhibitions").getAll(),
      );
      const budgetRow = await req<{ key: string; value: number } | undefined>(
        tx.objectStore("meta").get(META_BUDGET),
      );
      const activeRow = await req<{ key: string; value: string } | undefined>(
        tx.objectStore("meta").get(META_ACTIVE),
      );
      const budget = budgetRow?.value ?? DEFAULT_BUDGET_BYTES;
      const activeId = activeRow?.value;
      const stagedBytes = stagingRows.reduce((n, r) => n + r.size, 0);
      let pinnedBytes = 0;
      const exclusive = new Map<string, number>();
      for (const a of assetRows) {
        if (activeId && a.owners.includes(activeId)) {
          pinnedBytes += a.size;
        } else if (a.owners.length === 1) {
          exclusive.set(
            a.owners[0],
            (exclusive.get(a.owners[0]) ?? 0) + a.size,
          );
        }
      }
      const archived = exhibitionRows
        .filter((e) => e.status === "archived")
        .map((e) => ({
          id: e.id,
          title: e.manifest.title,
          bytes: e.assetsCleared ? 0 : (exclusive.get(e.id) ?? 0),
          lastUsed: e.archivedAt ?? e.importedAt,
        }));
      const totalAssets = assetRows.reduce((n, a) => n + a.size, 0);
      const usedBytes = totalAssets + stagedBytes;
      return {
        budgetBytes: budget,
        pinnedBytes,
        stagedBytes,
        archived,
        usedBytes,
        freeBytes: budget - usedBytes,
      };
    },

    async stageAsset(sessionId, asset) {
      const tx = store(["staging"], "readwrite");
      tx.objectStore("staging").put({
        sessionId,
        hash: asset.hash,
        mime: asset.mime,
        bytes: asset.bytes.buffer as ArrayBuffer,
        size: asset.bytes.byteLength,
      } satisfies StagingRow);
      await txDone(tx);
    },

    async discardStaging(sessionId) {
      const tx = store(["staging"], "readwrite");
      const staging = tx.objectStore("staging");
      const keys = await req<IDBValidKey[]>(
        staging.index("bySession").getAllKeys(sessionId),
      );
      for (const key of keys) staging.delete(key);
      await txDone(tx);
    },

    commit,

    async evictArchived(ids) {
      const tx = store(["exhibitions", "assets"], "readwrite");
      const exhibitions = tx.objectStore("exhibitions");
      let freed = 0;
      for (const id of ids) {
        const row = await req<ExhibitionRow | undefined>(exhibitions.get(id));
        if (!row || row.status !== "archived" || row.assetsCleared) continue;
        freed += await releaseAssets(tx, row.id, row.manifest);
        row.assetsCleared = true;
        exhibitions.put(row);
      }
      await txDone(tx);
      return freed;
    },

    async readAsset(hash) {
      const row = await req<AssetRow | undefined>(
        store(["assets"], "readonly").objectStore("assets").get(hash),
      );
      return row
        ? { mime: row.mime, bytes: new Uint8Array(row.bytes) }
        : null;
    },

    async addMigration(entry) {
      const tx = store(["migrations"], "readwrite");
      tx.objectStore("migrations").add(entry);
      await txDone(tx);
    },

    async listMigrations() {
      return req<MigrationEntry[]>(
        store(["migrations"], "readonly").objectStore("migrations").getAll(),
      );
    },

    close() {
      db.close();
    },
  };

  return api;
}
