/**
 * 导入协调器：两阶段导入（暂存 + 原子切换）的状态机。
 *
 * 状态：idle → reading → decoding → preview → committing → done / failed
 *                └────────── cancel ──────────┘→ idle（旧展不受影响）
 *
 * 并发规则：
 * - 每次导入分配单调递增的会话号；每个 await 之后都校验会话是否仍然有效，
 *   失效（被取消 / 被新导入取代）的解码结果直接丢弃，绝不写入。
 * - 暂存数据按会话隔离；取消、失败、被取代都会清除对应暂存。
 * - 只有到达 preview 且会话仍然有效时才能 confirm；commit 在存储层单事务完成。
 * - 收藏/参观记录的迁移键在 commit 时刻重新读取 —— 解码期间新增的收藏
 *   也会被正确迁移。
 */
import type {
  ExhibitionManifest,
  ExhibitionPack,
  MigrationEntry,
  PackReport,
  ReportIssue,
} from "./types";
import { parsePack } from "./packFormat";
import { base64ToBytes, base64Length } from "./base64";
import { contentHash } from "./hash";
import {
  buildCapacityPreview,
  buildIdentityPreview,
  buildReport,
} from "./validate";
import { buildIdentity, resolveFavorites, resolveVisits } from "./identity";
import { planCapacity } from "./capacity";
import type { ExchangeStore } from "./storeTypes";
import type { ExchangeEvents } from "./events";

export type ImportPhase =
  | "idle"
  | "reading"
  | "decoding"
  | "preview"
  | "committing"
  | "done"
  | "failed";

export type ImportState = {
  phase: ImportPhase;
  sessionId: number;
  sourceName: string | null;
  progress: { done: number; total: number };
  report: PackReport | null;
  error: string | null;
};

export type CoordinatorDeps = {
  store: ExchangeStore;
  events: ExchangeEvents;
  /** 验证图片字节可解码（浏览器：createImageBitmap；测试：注入假实现） */
  decodeImage: (bytes: Uint8Array, mime: string) => Promise<void>;
  /** 当前收藏/参观记录的作品身份键（commit 时刻会重新读取） */
  getCollectionKeys: () => { favorites: string[]; visits: string[] };
  /** 用身份键反查作品标题（搜索当前与归档展览），用于预览展示 */
  titleOfKey: (key: string) => string | undefined;
  /** commit 成功后回调：应用方应在此重建运行时展览 */
  onCommitted: (manifest: ExhibitionManifest) => void | Promise<void>;
};

type Pending = {
  session: number;
  pack: ExhibitionPack;
  manifest: ExhibitionManifest;
  evictions: string[];
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class ImportCoordinator {
  private deps: CoordinatorDeps;
  private session = 0;
  private pending: Pending | null = null;
  private state: ImportState = {
    phase: "idle",
    sessionId: 0,
    sourceName: null,
    progress: { done: 0, total: 0 },
    report: null,
    error: null,
  };

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
  }

  get current(): ImportState {
    return this.state;
  }

  private set(patch: Partial<ImportState>) {
    this.state = { ...this.state, ...patch };
    this.deps.events.emit(
      "import-state",
      `导入状态 → ${this.state.phase}` +
        (this.state.error ? `（${this.state.error}）` : ""),
    );
  }

  private alive(session: number): boolean {
    return this.session === session;
  }

  /** 使当前会话失效并清理其暂存；返回新的会话号 */
  private invalidate(reason: string): number {
    const prev = this.session;
    const next = prev + 1;
    this.session = next;
    if (this.pending) {
      this.deps.store.discardStaging(this.pending.session).catch(() => {});
      this.pending = null;
    } else if (prev > 0) {
      this.deps.store.discardStaging(prev).catch(() => {});
    }
    if (reason) this.deps.events.emit("cancel", reason);
    return next;
  }

  async begin(sourceName: string, readText: () => Promise<string>): Promise<void> {
    if (this.state.phase === "committing") {
      // 原子提交进行中：不可抢占。提交完成后会以新展览为起点再导入。
      this.deps.events.emit("error", "提交进行中，请稍后再开始新的导入");
      return;
    }
    const session = this.invalidate("已开始新的导入，上一导入被取消");
    const { store, events } = this.deps;
    this.set({
      phase: "reading",
      sessionId: session,
      sourceName,
      progress: { done: 0, total: 0 },
      report: null,
      error: null,
    });
    try {
      const text = await readText();
      if (!this.alive(session)) return;
      const { pack, issues } = parsePack(text);
      if (!pack) {
        await this.fail(session, "包结构不合法", issues);
        return;
      }

      // —— 容量预检：按声明大小估算，不足则尽早失败，不做无谓解码 ——
      const [snapshot, existing] = await Promise.all([
        store.capacitySnapshot(),
        store.existingHashes(),
      ]);
      if (!this.alive(session)) return;
      const capacity = buildCapacityPreview(pack, snapshot, existing);
      if (!capacity.fits) {
        const report = buildReport({
          pack,
          extraIssues: [],
          capacity,
          identity: buildIdentityPreview(
            pack,
            this.deps.getCollectionKeys(),
            this.deps.titleOfKey,
          ),
        });
        await this.fail(
          session,
          `容量不足：缺口 ${capacity.shortfall} 字节`,
          report.issues,
          report,
        );
        return;
      }

      // —— 逐资源核验：哈希 + 可解码性；通过即写入暂存（按会话隔离） ——
      this.set({
        phase: "decoding",
        progress: { done: 0, total: pack.assets.length },
      });
      const decodeIssues: ReportIssue[] = [];
      const assetSizes = new Map<string, { mime: string; size: number }>();
      /** 通过核验（哈希匹配且可解码）的资源；清单只包含这些 */
      const usableHashes = new Set<string>();
      const imageRefs = new Set(pack.artworks.map((a) => a.imageRef));
      // 包资源总字节在释放 base64 字符串前预计算
      const statsBytes = pack.assets.reduce(
        (n, a) => n + base64Length(a.bytes),
        0,
      );
      let done = 0;
      for (const asset of pack.assets) {
        await tick(); // 让出主线程：解码期间旧展仍可交互、可收藏
        if (!this.alive(session)) return; // 取消后迟到的解码结果直接丢弃
        const bytes = base64ToBytes(asset.bytes);
        asset.bytes = ""; // 大字符串尽早释放，降低内存占用
        const actual = await contentHash(bytes);
        if (!this.alive(session)) return;
        const required = imageRefs.has(asset.hash);
        let usable = true;
        if (actual !== asset.hash) {
          usable = false;
          decodeIssues.push({
            level: required ? "error" : "warning",
            code: "hash-mismatch",
            message: required
              ? `作品图片内容校验失败（声明 ${asset.hash.slice(0, 20)}…）`
              : `资源内容校验失败（${asset.hash.slice(0, 20)}…），相关讲解将降级`,
            refs: [asset.hash],
          });
        } else if (asset.mime.startsWith("image/")) {
          try {
            await this.deps.decodeImage(bytes, asset.mime);
          } catch {
            usable = false;
            decodeIssues.push({
              level: required ? "error" : "warning",
              code: "decode-failed",
              message: required
                ? `作品图片无法解码（${asset.hash.slice(0, 20)}…）`
                : `图片资源无法解码（${asset.hash.slice(0, 20)}…）`,
              refs: [asset.hash],
            });
          }
        }
        if (!this.alive(session)) return;
        // 只有通过核验的资源才写入暂存 / 计入清单；
        // 校验失败的资源绝不入库（否则清单会引用不存在的字节）
        if (usable) {
          usableHashes.add(asset.hash);
          if (!existing.has(asset.hash)) {
            await store.stageAsset(session, {
              hash: asset.hash,
              mime: asset.mime,
              bytes,
            });
            if (!this.alive(session)) {
              // 写入落在取消之后：由取消方的 discardStaging 兜底清除
              return;
            }
          }
        }
        assetSizes.set(asset.hash, {
          mime: asset.mime,
          size: bytes.byteLength,
        });
        done += 1;
        this.set({ progress: { done, total: pack.assets.length } });
      }

      // —— 语义校验与预览报告 ——
      const manifest = toManifest(pack, assetSizes, usableHashes);
      const report = buildReport({
        pack,
        extraIssues: decodeIssues,
        capacity,
        identity: buildIdentityPreview(
          pack,
          this.deps.getCollectionKeys(),
          this.deps.titleOfKey,
        ),
        statsBytes,
      });
      if (!this.alive(session)) return;
      if (!report.ok) {
        await this.fail(session, "包校验未通过", report.issues, report);
        return;
      }
      this.pending = {
        session,
        pack,
        manifest,
        evictions: capacity.evictions.map((e) => e.id),
      };
      this.set({ phase: "preview", report });
      events.emit(
        "capacity",
        `预览就绪：需新写入 ${report.capacity.requiredBytes} 字节` +
          (capacity.evictions.length
            ? `，将回收 ${capacity.evictions.length} 个归档展览`
            : "，无需回收"),
      );
    } catch (e) {
      if (!this.alive(session)) return;
      await this.fail(session, e instanceof Error ? e.message : String(e));
    }
  }

  private async fail(
    session: number,
    message: string,
    issues?: ReportIssue[],
    report?: PackReport,
  ) {
    this.deps.events.emit("error", `导入失败：${message}`);
    await this.deps.store.discardStaging(session).catch(() => {});
    this.pending = null;
    this.set({
      phase: "failed",
      error: message,
      report: report ?? null,
      progress: { done: 0, total: 0 },
    });
    void issues;
  }

  /** 用户确认：原子切换到新展览。只有当前会话的 preview 才能确认。 */
  async confirm(): Promise<boolean> {
    const pending = this.pending;
    if (!pending || !this.alive(pending.session)) return false;
    const { store, events } = this.deps;
    this.set({ phase: "committing" });
    try {
      // 确认前复核容量（预算可能被调低、可能有新归档）
      const snapshot = await store.capacitySnapshot();
      if (!this.alive(pending.session)) return false;
      const plan = planCapacity(snapshot, 0);
      if (plan.shortfall > 0) {
        await this.fail(pending.session, "确认时容量复核未通过");
        return false;
      }
      // 迁移键在 commit 时刻重新读取：解码期间新增的收藏也会被迁移
      const keys = this.deps.getCollectionKeys();
      const identity = buildIdentity(pending.pack.artworks);
      const favorites = resolveFavorites(keys.favorites, identity);
      const visits = resolveVisits(keys.visits, identity);
      const from = await store.getActive();
      const migration: MigrationEntry = {
        at: Date.now(),
        from: from
          ? { id: from.manifest.id, title: from.manifest.title }
          : { id: "", title: "（空）" },
        to: { id: pending.manifest.id, title: pending.manifest.title },
        rule: "image-sha256+declared-alias",
        favoritesMatched: favorites.matched,
        favoritesArchived: favorites.archived,
        visitsMatched: visits.matched,
        visitsArchived: visits.archived,
      };
      await store.commit({
        sessionId: pending.session,
        manifest: pending.manifest,
        migration,
        evictions: pending.evictions,
      });
      if (!this.alive(pending.session)) return false;
      this.pending = null;
      events.emit(
        "migration",
        `身份迁移：${favorites.matched.length} 件收藏迁移，` +
          `${favorites.archived.length} 件归档（规则：内容哈希 + 显式声明）`,
      );
      events.emit(
        "commit",
        `已切换到「${pending.manifest.title}」（原子提交完成）`,
      );
      this.set({ phase: "done" });
      await this.deps.onCommitted(pending.manifest);
      return true;
    } catch (e) {
      if (!this.alive(pending.session)) return false;
      await this.fail(
        pending.session,
        `提交失败：${e instanceof Error ? e.message : e}（旧展不受影响）`,
      );
      return false;
    }
  }

  /** 用户取消：清除暂存，回到 idle；旧展全程不受影响。提交阶段不可取消。 */
  async cancel(reason = "用户取消导入"): Promise<void> {
    if (this.state.phase === "committing") {
      this.deps.events.emit("cancel", "提交进行中，取消请求被忽略");
      return;
    }
    const session = this.session;
    this.invalidate(reason);
    await this.deps.store.discardStaging(session).catch(() => {});
    this.set({
      phase: "idle",
      sourceName: null,
      progress: { done: 0, total: 0 },
      report: null,
      error: null,
    });
  }

  /** 关闭结果态（done / failed），回到 idle */
  reset() {
    if (this.state.phase === "done" || this.state.phase === "failed") {
      this.set({ phase: "idle", report: null, error: null, sourceName: null });
    }
  }
}

/** 由通过核验的包构造清单（资源只留元信息，且只包含通过核验的资源） */
function toManifest(
  pack: ExhibitionPack,
  sizes: Map<string, { mime: string; size: number }>,
  usableHashes: ReadonlySet<string>,
): ExhibitionManifest {
  const assets = pack.assets
    .filter((a) => usableHashes.has(a.hash))
    .map((a) => {
      const meta = sizes.get(a.hash);
      return {
        hash: a.hash,
        mime: a.mime,
        size: meta ? meta.size : base64Length(a.bytes),
      };
    });
  return {
    id: pack.exhibition.id,
    title: pack.exhibition.title,
    en: pack.exhibition.en ?? "",
    intro: pack.exhibition.intro ?? "",
    space: pack.exhibition.space,
    artworks: pack.artworks,
    routes: pack.routes,
    narration: pack.narration,
    assets,
    bytesTotal: assets.reduce((n, a) => n + a.size, 0),
  };
}
