/**
 * 容量策略（纯函数，可测试）。
 *
 * 规则：
 * - 当前展览（active）的资源是钉住的，任何情况下都不被回收 ——
 *   这保证“导入失败/取消后仍能完整参观旧展”。
 * - 暂存区（staging）属于当前导入会话，取消/失败即整体清除。
 * - 只有“已归档”的展览资源可以被回收，按最近最少使用（LRU）顺序释放；
 *   与其他展览内容相同的资源按内容哈希去重，不会被重复计算。
 * - 预算（budgetBytes）是显式、可观察的上限；不足时给出确切的缺口数值，
 *   而不是静默失败。
 */
export type ArchivedSummary = {
  id: string;
  title: string;
  bytes: number;
  lastUsed: number;
};

export type CapacityState = {
  budgetBytes: number;
  /** 当前展览占用（钉住，不可回收） */
  pinnedBytes: number;
  /** 当前导入会话的暂存占用 */
  stagedBytes: number;
  /** 已归档展览（可回收，按 lastUsed 升序回收） */
  archived: ArchivedSummary[];
};

export type CapacityPlan = {
  fits: boolean;
  /** 为腾出空间将回收的归档展览 id（LRU 顺序） */
  evictions: string[];
  /** 回收全部归档后仍缺的字节数；0 表示可行 */
  shortfall: number;
  freeBytes: number;
  usedBytes: number;
};

export function planCapacity(
  state: CapacityState,
  requiredBytes: number,
): CapacityPlan {
  const archivedBytes = state.archived.reduce((n, a) => n + a.bytes, 0);
  const usedBytes = state.pinnedBytes + state.stagedBytes + archivedBytes;
  const freeBytes = state.budgetBytes - usedBytes;
  if (requiredBytes <= freeBytes) {
    return { fits: true, evictions: [], shortfall: 0, freeBytes, usedBytes };
  }
  const evictions: string[] = [];
  let reclaimed = 0;
  const need = requiredBytes - freeBytes;
  const lru = [...state.archived].sort((a, b) => a.lastUsed - b.lastUsed);
  for (const a of lru) {
    if (reclaimed >= need) break;
    evictions.push(a.id);
    reclaimed += a.bytes;
  }
  const shortfall = Math.max(0, need - reclaimed);
  return {
    fits: shortfall === 0,
    evictions,
    shortfall,
    freeBytes,
    usedBytes,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
