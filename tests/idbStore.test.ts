/**
 * 针对真实 IndexedDB 实现（经 fake-indexeddb）的存储层测试：
 * 重点覆盖原子提交、引用计数、容量快照与启动清理。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { openIdbStore } from "../src/shared/exchange/idbStore";
import {
  META_BUDGET,
  type ExchangeStore,
} from "../src/shared/exchange/storeTypes";
import type { ExhibitionPack, MigrationEntry } from "../src/shared/exchange/types";
import { base64ToBytes } from "../src/shared/exchange/base64";
import { makePack, fakeAsset } from "./helpers";

// 每个用例使用全新的数据库
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory() as IDBFactory & typeof indexedDB;
});

function manifestOf(pack: ExhibitionPack) {
  return {
    id: pack.exhibition.id,
    title: pack.exhibition.title,
    en: pack.exhibition.en,
    intro: pack.exhibition.intro,
    space: pack.exhibition.space,
    artworks: pack.artworks,
    routes: pack.routes,
    narration: pack.narration,
    assets: pack.assets.map((a) => ({
      hash: a.hash,
      mime: a.mime,
      size: base64ToBytes(a.bytes).byteLength,
    })),
    bytesTotal: pack.assets.reduce(
      (n, a) => n + base64ToBytes(a.bytes).byteLength,
      0,
    ),
  };
}

function stagedOf(pack: ExhibitionPack) {
  return pack.assets.map((a) => ({
    hash: a.hash,
    mime: a.mime,
    bytes: base64ToBytes(a.bytes),
  }));
}

function migration(from: string, to: string): MigrationEntry {
  return {
    at: Date.now(),
    from: { id: from, title: from },
    to: { id: to, title: to },
    rule: "image-sha256+declared-alias",
    favoritesMatched: [],
    favoritesArchived: [],
    visitsMatched: 0,
    visitsArchived: 0,
  };
}

describe("idbStore 原子提交与容量", () => {
  it("安装 → 暂存 → 提交：切换当前展览，旧展归档且资源保留", async () => {
    const store = await openIdbStore();
    const packA = await makePack({
      id: "ex-a",
      artworks: [
        { id: "a1", imageName: "shared-img" },
        { id: "a2", imageName: "old-only-img" },
      ],
    });
    await store.installActive(manifestOf(packA), stagedOf(packA));
    expect((await store.getActive())?.manifest.id).toBe("ex-a");

    const packB = await makePack({
      id: "ex-b",
      artworks: [
        { id: "b1", imageName: "shared-img" },
        { id: "b2", imageName: "new-img" },
      ],
    });
    // 模拟协调器：新资源写入暂存（shared-img 已存在，跳过）
    const existing = await store.existingHashes();
    for (const a of stagedOf(packB)) {
      if (!existing.has(a.hash)) await store.stageAsset(1, a);
    }
    const before = await store.capacitySnapshot();
    expect(before.stagedBytes).toBeGreaterThan(0);

    await store.commit({
      sessionId: 1,
      manifest: manifestOf(packB),
      migration: migration("ex-a", "ex-b"),
      evictions: [],
    });
    expect((await store.getActive())?.manifest.id).toBe("ex-b");
    const old = await store.getExhibition("ex-a");
    expect(old?.status).toBe("archived");
    // 共享与旧展独有资源都保留（归档不立即释放）
    const shared = (await fakeAsset("shared-img")).hash;
    const oldOnly = (await fakeAsset("old-only-img")).hash;
    expect(await store.readAsset(shared)).not.toBeNull();
    expect(await store.readAsset(oldOnly)).not.toBeNull();
    // 暂存已清空
    const after = await store.capacitySnapshot();
    expect(after.stagedBytes).toBe(0);
    // 回收旧展：释放 old-only；shared 仍被 ex-b 持有
    const freed = await store.evictArchived(["ex-a"]);
    expect(freed).toBeGreaterThan(0);
    expect(await store.readAsset(oldOnly)).toBeNull();
    expect(await store.readAsset(shared)).not.toBeNull();
    store.close();
  });

  it("提交不变量失败时整体回滚：旧展、资源、暂存全部保持原状", async () => {
    const store = await openIdbStore();
    const packA = await makePack({
      id: "ex-a",
      artworks: [{ id: "a1", imageName: "img-1" }],
    });
    await store.installActive(manifestOf(packA), stagedOf(packA));
    const packB = await makePack({
      id: "ex-b",
      artworks: [{ id: "b1", imageName: "brand-new" }],
    });
    for (const a of stagedOf(packB)) await store.stageAsset(7, a);
    await store.setMeta(META_BUDGET, 5); // 预算极小，提交必然触发不变量
    await expect(
      store.commit({
        sessionId: 7,
        manifest: manifestOf(packB),
        migration: migration("ex-a", "ex-b"),
        evictions: [],
      }),
    ).rejects.toThrow(/容量不变量/);
    // 回滚验证
    expect((await store.getActive())?.manifest.id).toBe("ex-a");
    const img1 = (await fakeAsset("img-1")).hash;
    const brandNew = (await fakeAsset("brand-new")).hash;
    expect(await store.readAsset(img1)).not.toBeNull();
    expect(await store.readAsset(brandNew)).toBeNull();
    // 暂存未被提交消耗（协调器随后会按会话清除）
    const snap = await store.capacitySnapshot();
    expect(snap.stagedBytes).toBeGreaterThan(0);
    await store.discardStaging(7);
    expect((await store.capacitySnapshot()).stagedBytes).toBe(0);
    store.close();
  });

  it("同一展览重新导入：资源引用不泄漏", async () => {
    const store = await openIdbStore();
    const pack = await makePack({
      id: "ex-same",
      artworks: [
        { id: "a1", imageName: "img-1" },
        { id: "a2", imageName: "img-2" },
      ],
    });
    await store.installActive(manifestOf(pack), stagedOf(pack));
    // 重新导入：资源已存在 → 不写暂存
    await store.commit({
      sessionId: 3,
      manifest: manifestOf(pack),
      migration: migration("ex-same", "ex-same"),
      evictions: [],
    });
    const snap = await store.capacitySnapshot();
    const active = await store.getActive();
    expect(active?.manifest.id).toBe("ex-same");
    // 占用没有翻倍
    expect(snap.pinnedBytes).toBe(active!.manifest.bytesTotal);
    store.close();
  });

  it("启动清理移除遗留暂存", async () => {
    let store = await openIdbStore();
    await store.stageAsset(42, {
      hash: "sha256:" + "4".repeat(64),
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    store.close();
    // 模拟重新打开页面（同一数据库句柄工厂，验证库内清理）
    globalThis.indexedDB = new IDBFactory() as IDBFactory & typeof indexedDB;
    store = await openIdbStore();
    // 新数据库没有遗留；再验证同一库内的清理
    await store.stageAsset(43, {
      hash: "sha256:" + "5".repeat(64),
      mime: "image/png",
      bytes: new Uint8Array([1, 2]),
    });
    const { removedStaging } = await store.bootCleanup();
    expect(removedStaging).toBe(1);
    expect((await store.capacitySnapshot()).stagedBytes).toBe(0);
    store.close();
  });

  it("容量快照口径：钉住 / 暂存 / 归档独占 分别统计", async () => {
    const store = await openIdbStore();
    const packA = await makePack({
      id: "ex-a",
      artworks: [
        { id: "a1", imageName: "shared-img" },
        { id: "a2", imageName: "old-only-img" },
      ],
    });
    await store.installActive(manifestOf(packA), stagedOf(packA));
    const packB = await makePack({
      id: "ex-b",
      artworks: [{ id: "b1", imageName: "shared-img" }],
    });
    for (const a of stagedOf(packB)) {
      if (!(await store.existingHashes()).has(a.hash))
        await store.stageAsset(1, a);
    }
    await store.commit({
      sessionId: 1,
      manifest: manifestOf(packB),
      migration: migration("ex-a", "ex-b"),
      evictions: [],
    });
    const snap = await store.capacitySnapshot();
    const shared = await fakeAsset("shared-img");
    const oldOnly = await fakeAsset("old-only-img");
    expect(snap.pinnedBytes).toBe(shared.bytes.byteLength);
    const archivedA = snap.archived.find((x) => x.id === "ex-a");
    // 归档独占 = old-only（shared 与当前展览共享，不计入可回收）
    expect(archivedA?.bytes).toBe(oldOnly.bytes.byteLength);
    store.close();
  });
});
