/**
 * 存储层接口：展览、资源（内容寻址 + 引用计数）、暂存区、容量快照、迁移日志。
 *
 * 原子性保证：
 * - commit() 在单个事务内完成“归档旧展 + 写入新展与资源 + 清理暂存 +
 *   切换 active 指针 + 记录迁移日志”。事务要么全部成功，要么整体回滚 ——
 *   任何时刻崩溃都不会留下新旧混搭的状态。
 * - 暂存区按会话 id 隔离；取消/失败/崩溃遗留的暂存数据按会话清除，
 *   绝不影响当前展览。
 */
import type {
  ExhibitionManifest,
  MigrationEntry,
  StoredExhibition,
} from "./types";
import type { ArchivedSummary, CapacityState } from "./capacity";

export type StagedAsset = { hash: string; mime: string; bytes: Uint8Array };

export type CapacitySnapshot = CapacityState & {
  usedBytes: number;
  freeBytes: number;
};

export type CommitInput = {
  sessionId: number;
  manifest: ExhibitionManifest;
  migration: MigrationEntry;
  /** 预览时批准、确认时执行的归档回收列表 */
  evictions: string[];
};

export interface ExchangeStore {
  /** 启动清理：删除所有遗留暂存数据（上次会话崩溃/取消的残留） */
  bootCleanup(): Promise<{ removedStaging: number }>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  getActive(): Promise<StoredExhibition | null>;
  getExhibition(id: string): Promise<StoredExhibition | null>;
  listExhibitions(): Promise<StoredExhibition[]>;

  /** 首次安装（或自愈重装）内置展览：替换 active，不经过暂存 */
  installActive(
    manifest: ExhibitionManifest,
    assets: StagedAsset[],
  ): Promise<void>;

  existingHashes(): Promise<Set<string>>;
  /**
   * 容量快照。口径：
   * - pinnedBytes：当前展览引用的资源（钉住，永不回收）；
   * - stagedBytes：全部暂存区字节（同一时刻至多一个活跃会话）；
   * - archived[].bytes：该归档展览“独占”的资源字节 —— 即回收它实际能
   *   释放的量；与其他展览共享的资源不计入（回收不会释放它们）。
   */
  capacitySnapshot(): Promise<CapacitySnapshot>;

  stageAsset(sessionId: number, asset: StagedAsset): Promise<void>;
  discardStaging(sessionId: number): Promise<void>;

  /** 原子提交：归档旧展、写入新展、清理暂存、切换指针、记录迁移 */
  commit(input: CommitInput): Promise<void>;

  /** 回收归档展览的独占资源，返回实际释放的字节数 */
  evictArchived(ids: string[]): Promise<number>;

  readAsset(hash: string): Promise<{ mime: string; bytes: Uint8Array } | null>;

  addMigration(entry: MigrationEntry): Promise<void>;
  listMigrations(): Promise<MigrationEntry[]>;

  close(): void;
}

export const DEFAULT_BUDGET_BYTES = 12 * 1024 * 1024;
export const META_ACTIVE = "activeExhibitionId";
export const META_BUDGET = "budgetBytes";

export function manifestBytes(manifest: ExhibitionManifest): number {
  return manifest.assets.reduce((n, a) => n + a.size, 0);
}
