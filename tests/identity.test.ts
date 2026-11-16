import { describe, it, expect } from "vitest";
import {
  buildIdentity,
  resolveFavorites,
  resolveVisits,
} from "../src/shared/exchange/identity";
import { planCapacity, type CapacityState } from "../src/shared/exchange/capacity";

describe("identity 作品身份规则", () => {
  const H = (n: string) => `sha256:${n.repeat(64)}`;

  it("内容哈希相等 → 同一作品；名称相同但内容不同 → 绝不合并", () => {
    const identity = buildIdentity([
      { id: "new-1", imageRef: H("a") },
      { id: "new-2", imageRef: H("b") },
    ]);
    // 旧展收藏键：H(a) 内容相同（哪怕 id 完全不同）→ 迁移
    expect(identity.resolve(H("a"))).toBe("new-1");
    // 旧展有一件“同名”作品但内容哈希 H(z) 不在新展 → 不可解析
    expect(identity.resolve(H("z"))).toBeUndefined();
  });

  it("策展人显式声明的 sameAs 别名可解析，但不覆盖内容相等的主映射", () => {
    const identity = buildIdentity([
      { id: "new-1", imageRef: H("a"), sameAs: [H("old")] },
      { id: "new-2", imageRef: H("old") },
    ]);
    // 内容完全相等优先于别名声明
    expect(identity.resolve(H("old"))).toBe("new-2");
    const withoutConflict = buildIdentity([
      { id: "new-1", imageRef: H("a"), sameAs: [H("old")] },
    ]);
    expect(withoutConflict.resolve(H("old"))).toBe("new-1");
  });

  it("收藏与参观记录按规则分流：匹配的迁移，其余归档", () => {
    const identity = buildIdentity([
      { id: "n1", imageRef: H("a") },
      { id: "n2", imageRef: H("b") },
    ]);
    const favorites = resolveFavorites([H("a"), H("x"), H("b"), H("y")], identity);
    expect(favorites.matched).toEqual([H("a"), H("b")]);
    expect(favorites.archived).toEqual([H("x"), H("y")]);
    const visits = resolveVisits([H("a"), H("a"), H("z")], identity);
    expect(visits).toEqual({ matched: 2, archived: 1 });
  });
});

describe("capacity 容量策略", () => {
  const state: CapacityState = {
    budgetBytes: 1000,
    pinnedBytes: 400,
    stagedBytes: 0,
    archived: [
      { id: "old-1", title: "旧展一", bytes: 200, lastUsed: 1 },
      { id: "old-2", title: "旧展二", bytes: 300, lastUsed: 2 },
    ],
  };

  it("空闲足够时不回收", () => {
    const plan = planCapacity(state, 100);
    expect(plan.fits).toBe(true);
    expect(plan.evictions).toEqual([]);
  });

  it("不足时按 LRU 回收归档，钉住的当前展览绝不被回收", () => {
    const plan = planCapacity(state, 300);
    expect(plan.fits).toBe(true);
    expect(plan.evictions).toEqual(["old-1"]); // 最久未用的先回收
    const bigger = planCapacity(state, 550);
    expect(bigger.evictions).toEqual(["old-1", "old-2"]);
  });

  it("回收全部归档仍不足 → 给出确切缺口", () => {
    const plan = planCapacity(state, 1200);
    expect(plan.fits).toBe(false);
    // free = 1000-400-500 = 100；need = 1100；可回收 500 → 缺口 600
    expect(plan.shortfall).toBe(600);
  });

  it("暂存占用计入已用空间", () => {
    const plan = planCapacity({ ...state, stagedBytes: 300 }, 250);
    // free = 1000-400-300-500 = -200 → 需要 450 → 回收 old-1(200)+old-2(300)
    expect(plan.evictions).toEqual(["old-1", "old-2"]);
    expect(plan.fits).toBe(true);
  });
});
