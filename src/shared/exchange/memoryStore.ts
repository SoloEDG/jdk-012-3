/**
 * 内存版存储：与 IndexedDB 实现语义一致，用于单元测试与开发调试。
 */
import type { ExhibitionManifest, MigrationEntry, StoredExhibition } from "./types";
import {
  DEFAULT_BUDGET_BYTES,
  META_ACTIVE,
  META_BUDGET,
  type CapacitySnapshot,
  type CommitInput,
  type ExchangeStore,
  type StagedAsset,
} from "./storeTypes";

type MemAsset = {
  hash: string;
  mime: string;
  bytes: Uint8Array;
  size: number;
  refs: number;
  owners: string[];
  lastUsed: number;
};

export function createMemoryStore(): ExchangeStore & {
  /** 测试辅助：直接读取内部状态 */
  _dump(): {
    assets: Map<string, MemAsset>;
    exhibitions: Map<string, StoredExhibition>;
    staging: Map<string, Map<string, StagedAsset & { size: number }>>;
    meta: Map<string, unknown>;
    migrations: MigrationEntry[];
  };
} {
  const assets = new Map<string, MemAsset>();
  const exhibitions = new Map<string, StoredExhibition>();
  const staging = new Map<string, Map<string, StagedAsset & { size: number }>>();
  const meta = new Map<string, unknown>();
  const migrations: MigrationEntry[] = [];
  let closed = false;

  const ensureOpen = () => {
    if (closed) throw new Error("store 已关闭");
  };

  function release(ownerId: string, manifest: ExhibitionManifest): number {
    let freed = 0;
    for (const m of manifest.assets) {
      const row = assets.get(m.hash);
      if (!row) continue;
      row.refs -= 1;
      row.owners = row.owners.filter((o) => o !== ownerId);
      if (row.refs <= 0) {
        freed += row.size;
        assets.delete(m.hash);
      }
    }
    return freed;
  }

  type Dump = {
    assets: Map<string, MemAsset>;
    exhibitions: Map<string, StoredExhibition>;
    staging: Map<string, Map<string, StagedAsset & { size: number }>>;
    meta: Map<string, unknown>;
    migrations: MigrationEntry[];
  };
  const api: ExchangeStore & { _dump(): Dump } = {
    async bootCleanup() {
      ensureOpen();
      let removed = 0;
      for (const rows of staging.values()) removed += rows.size;
      staging.clear();
      for (const [id, e] of exhibitions) {
        if (e.status === "staged") exhibitions.delete(id);
      }
      return { removedStaging: removed };
    },

    async getMeta<T>(key: string) {
      ensureOpen();
      return meta.get(key) as T | undefined;
    },

    async setMeta(key, value) {
      ensureOpen();
      meta.set(key, value);
    },

    async getActive() {
      ensureOpen();
      const id = meta.get(META_ACTIVE) as string | undefined;
      return (id && exhibitions.get(id)) || null;
    },

    async getExhibition(id) {
      ensureOpen();
      return exhibitions.get(id) ?? null;
    },

    async listExhibitions() {
      ensureOpen();
      return [...exhibitions.values()];
    },

    async installActive(manifest, assetList) {
      ensureOpen();
      const now = Date.now();
      const oldId = meta.get(META_ACTIVE) as string | undefined;
      if (oldId) {
        const old = exhibitions.get(oldId);
        if (old) {
          release(old.manifest.id, old.manifest);
          exhibitions.delete(oldId);
        }
      }
      for (const a of assetList) {
        const existing = assets.get(a.hash);
        if (existing) {
          existing.refs += 1;
          if (!existing.owners.includes(manifest.id))
            existing.owners.push(manifest.id);
          existing.lastUsed = now;
        } else {
          assets.set(a.hash, {
            hash: a.hash,
            mime: a.mime,
            bytes: a.bytes,
            size: a.bytes.byteLength,
            refs: 1,
            owners: [manifest.id],
            lastUsed: now,
          });
        }
      }
      exhibitions.set(manifest.id, {
        manifest,
        status: "active",
        importedAt: now,
      });
      meta.set(META_ACTIVE, manifest.id);
    },

    async existingHashes() {
      ensureOpen();
      return new Set(assets.keys());
    },

    async capacitySnapshot(): Promise<CapacitySnapshot> {
      ensureOpen();
      const budget =
        (meta.get(META_BUDGET) as number | undefined) ?? DEFAULT_BUDGET_BYTES;
      const activeId = meta.get(META_ACTIVE) as string | undefined;
      let stagedBytes = 0;
      for (const rows of staging.values())
        for (const r of rows.values()) stagedBytes += r.size;
      let pinnedBytes = 0;
      const exclusive = new Map<string, number>();
      let totalAssets = 0;
      for (const a of assets.values()) {
        totalAssets += a.size;
        if (activeId && a.owners.includes(activeId)) pinnedBytes += a.size;
        else if (a.owners.length === 1)
          exclusive.set(a.owners[0], (exclusive.get(a.owners[0]) ?? 0) + a.size);
      }
      const archived = [...exhibitions.values()]
        .filter((e) => e.status === "archived")
        .map((e) => ({
          id: e.manifest.id,
          title: e.manifest.title,
          bytes: e.assetsCleared ? 0 : (exclusive.get(e.manifest.id) ?? 0),
          lastUsed: e.archivedAt ?? e.importedAt,
        }));
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
      ensureOpen();
      let rows = staging.get(String(sessionId));
      if (!rows) {
        rows = new Map();
        staging.set(String(sessionId), rows);
      }
      rows.set(asset.hash, { ...asset, size: asset.bytes.byteLength });
    },

    async discardStaging(sessionId) {
      ensureOpen();
      staging.delete(String(sessionId));
    },

    async commit(input: CommitInput) {
      ensureOpen();
      // 内存实现天然具备“先算后写”的原子性：先在副本上执行，全部成功再替换
      const assetsCopy = new Map(
        [...assets].map(([k, v]) => [
          k,
          { ...v, owners: [...v.owners], bytes: v.bytes },
        ]),
      );
      const exhibitionsCopy = new Map(
        [...exhibitions].map(([k, v]) => [k, { ...v }]),
      );
      const stagingCopy = new Map(
        [...staging].map(([k, v]) => [k, new Map(v)]),
      );
      const metaCopy = new Map(meta);
      try {
        const now = Date.now();
        const stagedRows = stagingCopy.get(String(input.sessionId));
        const newHashes = new Set(input.manifest.assets.map((a) => a.hash));
        const oldActiveId = metaCopy.get(META_ACTIVE) as string | undefined;
        const previousVersion = exhibitionsCopy.get(input.manifest.id);
        // 写入/认领新资源（与 IDB 实现一致：已被本展览持有的不重复计数）
        for (const m of input.manifest.assets) {
          const existing = assetsCopy.get(m.hash);
          if (existing) {
            if (!existing.owners.includes(input.manifest.id)) {
              existing.owners.push(input.manifest.id);
              existing.refs += 1;
            }
            existing.lastUsed = now;
          } else {
            const row = stagedRows?.get(m.hash);
            if (!row)
              throw new Error(`暂存区缺少资源 ${m.hash}，提交中止`);
            assetsCopy.set(m.hash, {
              hash: m.hash,
              mime: row.mime,
              bytes: row.bytes,
              size: row.size,
              refs: 1,
              owners: [input.manifest.id],
              lastUsed: now,
            });
          }
        }
        stagingCopy.delete(String(input.sessionId));
        // 移除同 id 前版本：只释放新版本中已不存在的资源
        if (previousVersion) {
          for (const m of previousVersion.manifest.assets) {
            if (newHashes.has(m.hash)) continue;
            const row = assetsCopy.get(m.hash);
            if (!row) continue;
            row.refs -= 1;
            row.owners = row.owners.filter(
              (o) => o !== previousVersion.manifest.id,
            );
            if (row.refs <= 0) assetsCopy.delete(m.hash);
          }
          exhibitionsCopy.delete(previousVersion.manifest.id);
        }
        // 旧展转为归档（资源保留，待容量压力下回收）
        if (oldActiveId && oldActiveId !== input.manifest.id) {
          const old = exhibitionsCopy.get(oldActiveId);
          if (old) {
            old.status = "archived";
            old.archivedAt = now;
          }
        }
        for (const id of input.evictions) {
          const row = exhibitionsCopy.get(id);
          if (!row || row.status !== "archived" || row.assetsCleared) continue;
          for (const m of row.manifest.assets) {
            const a = assetsCopy.get(m.hash);
            if (!a) continue;
            a.refs -= 1;
            a.owners = a.owners.filter((o) => o !== id);
            if (a.refs <= 0) assetsCopy.delete(m.hash);
          }
          row.assetsCleared = true;
        }
        exhibitionsCopy.set(input.manifest.id, {
          manifest: input.manifest,
          status: "active",
          importedAt: now,
        });
        metaCopy.set(META_ACTIVE, input.manifest.id);
        const budget =
          (metaCopy.get(META_BUDGET) as number | undefined) ??
          DEFAULT_BUDGET_BYTES;
        let total = 0;
        for (const a of assetsCopy.values()) total += a.size;
        if (total > budget)
          throw new Error(
            `容量不变量检查失败：${total} 字节超过预算 ${budget}，提交已回滚`,
          );
        // 全部成功：应用副本
        assets.clear();
        for (const [k, v] of assetsCopy) assets.set(k, v);
        exhibitions.clear();
        for (const [k, v] of exhibitionsCopy) exhibitions.set(k, v);
        staging.clear();
        for (const [k, v] of stagingCopy) staging.set(k, v);
        meta.clear();
        for (const [k, v] of metaCopy) meta.set(k, v);
        migrations.push(input.migration);
      } catch (e) {
        // 副本被丢弃，真实状态未变 —— 等价于事务回滚
        throw e;
      }
    },

    async evictArchived(ids) {
      ensureOpen();
      let freed = 0;
      for (const id of ids) {
        const row = exhibitions.get(id);
        if (!row || row.status !== "archived" || row.assetsCleared) continue;
        freed += release(id, row.manifest);
        row.assetsCleared = true;
      }
      return freed;
    },

    async readAsset(hash) {
      ensureOpen();
      const row = assets.get(hash);
      return row ? { mime: row.mime, bytes: row.bytes } : null;
    },

    async addMigration(entry) {
      ensureOpen();
      migrations.push(entry);
    },

    async listMigrations() {
      ensureOpen();
      return [...migrations];
    },

    close() {
      closed = true;
    },

    _dump: () => ({ assets, exhibitions, staging, meta, migrations }),
  };

  return api;
}
