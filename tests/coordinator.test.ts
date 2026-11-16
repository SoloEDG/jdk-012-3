import { describe, it, expect, beforeEach } from "vitest";
import { ImportCoordinator } from "../src/shared/exchange/coordinator";
import { createMemoryStore } from "../src/shared/exchange/memoryStore";
import { ExchangeEvents } from "../src/shared/exchange/events";
import { META_BUDGET, type ExchangeStore } from "../src/shared/exchange/storeTypes";
import type { ExhibitionPack, MigrationEntry } from "../src/shared/exchange/types";
import { base64ToBytes, bytesToBase64 } from "../src/shared/exchange/base64";
import { makePack, makeDecoder, makeGatedDecoder, fakeAsset, flushMicrotasks } from "./helpers";

/** 把包安装为当前展览（模拟首次启动） */
async function installPack(store: ExchangeStore, pack: ExhibitionPack) {
  await store.installActive(
    {
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
    },
    pack.assets.map((a) => ({
      hash: a.hash,
      mime: a.mime,
      bytes: base64ToBytes(a.bytes),
    })),
  );
}

type Harness = {
  store: ReturnType<typeof createMemoryStore>;
  events: ExchangeEvents;
  coordinator: ImportCoordinator;
  collection: { favorites: string[]; visits: string[] };
  committed: string[];
};

function makeHarness(decodeImage?: (b: Uint8Array, m: string) => Promise<void>): Harness {
  const store = createMemoryStore();
  const events = new ExchangeEvents();
  const collection = { favorites: [] as string[], visits: [] as string[] };
  const committed: string[] = [];
  const coordinator = new ImportCoordinator({
    store,
    events,
    decodeImage: decodeImage ?? makeDecoder(),
    getCollectionKeys: () => collection,
    titleOfKey: () => undefined,
    onCommitted: (m) => {
      committed.push(m.id);
    },
  });
  return { store, events, coordinator, collection, committed };
}

describe("ImportCoordinator 两阶段导入", () => {
  let oldPack: ExhibitionPack;
  let mountain: string;
  let tideOld: string;

  beforeEach(async () => {
    mountain = (await fakeAsset("mountain")).hash;
    tideOld = (await fakeAsset("tide-old")).hash;
    oldPack = await makePack({
      id: "ex-old",
      title: "旧展",
      artworks: [
        { id: "a1", title: "山的另一种记忆", imageName: "mountain" },
        { id: "a2", title: "无声的潮汐", imageName: "tide-old" },
      ],
      routes: [{ id: "r1", name: "旧路线", stops: ["a1", "a2"] }],
      narration: { a1: ["讲解一"], a2: ["讲解二"] },
    });
  });

  it("完整流程：预览 → 确认 → 原子切换；收藏按内容身份迁移，同名不同内容不合并", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    // 参观者在旧展收藏了两件作品、留下了参观记录
    h.collection.favorites = [mountain, tideOld];
    h.collection.visits = [mountain, mountain, tideOld];

    const newPack = await makePack({
      id: "ex-new",
      title: "新展",
      artworks: [
        { id: "b1", title: "山的另一种记忆", imageName: "mountain" }, // 内容相同 → 迁移
        { id: "b2", title: "无声的潮汐", imageName: "tide-new" }, // 同名不同内容 → 不合并
      ],
      routes: [{ id: "r2", name: "新路线", stops: ["b1", "b2"] }],
      narration: { b1: ["讲解"], b2: ["讲解"] },
    });
    const tideNew = newPack.artworks[1].imageRef;

    await h.coordinator.begin("new.yujingpack.json", async () =>
      JSON.stringify(newPack),
    );
    expect(h.coordinator.current.phase).toBe("preview");
    const report = h.coordinator.current.report!;
    expect(report.ok).toBe(true);
    expect(report.identity.favoritesMatched).toBe(1);
    expect(report.identity.favoritesArchived).toBe(1);
    expect(report.identity.visitsMatched).toBe(2);
    expect(report.identity.visitsArchived).toBe(1);

    // 确认前旧展仍是当前展览
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");

    const ok = await h.coordinator.confirm();
    expect(ok).toBe(true);
    expect(h.coordinator.current.phase).toBe("done");
    expect(h.committed).toEqual(["ex-new"]);
    expect((await h.store.getActive())?.manifest.id).toBe("ex-new");

    // 迁移日志：mountain 迁移，tideOld 归档；tideNew 与 tideOld 绝不合并
    const migrations = await h.store.listMigrations();
    const m: MigrationEntry = migrations[migrations.length - 1];
    expect(m.favoritesMatched).toEqual([mountain]);
    expect(m.favoritesArchived).toEqual([tideOld]);
    expect(tideNew).not.toBe(tideOld);

    // 资源：共享的 mountain refs=2；旧展独有的 tide-old 随旧展归档保留
    // （归档资源只有在容量压力下才被回收）
    const dump = h.store._dump();
    expect(dump.assets.get(mountain)?.refs).toBe(2);
    expect(dump.assets.get(tideOld)?.refs).toBe(1);
    expect(dump.assets.get(tideNew)?.refs).toBe(1);
    // 旧展已归档
    const oldRow = await h.store.getExhibition("ex-old");
    expect(oldRow?.status).toBe("archived");
    // 容量快照：旧展独占 tide-old，可被回收
    const snap = await h.store.capacitySnapshot();
    const archivedOld = snap.archived.find((a) => a.id === "ex-old");
    expect(archivedOld).toBeDefined();
    expect(archivedOld!.bytes).toBeGreaterThan(0);
    // 回收旧展：tide-old 被释放，共享的 mountain 仍保留
    const freed = await h.store.evictArchived(["ex-old"]);
    expect(freed).toBeGreaterThan(0);
    expect(h.store._dump().assets.has(tideOld)).toBe(false);
    expect(h.store._dump().assets.has(mountain)).toBe(true);
  });

  it("解码期间新增的收藏，在 commit 时也会被迁移", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    h.collection.favorites = []; // 开始时没有收藏
    const gate = makeGatedDecoder();
    const h2 = makeHarness(gate.decoder);
    h2.store = h.store;
    // 用带闸门的解码器重新开始
    const coordinator = new ImportCoordinator({
      store: h.store,
      events: h.events,
      decodeImage: gate.decoder,
      getCollectionKeys: () => h.collection,
      titleOfKey: () => undefined,
      onCommitted: () => {},
    });
    const newPack = await makePack({
      id: "ex-new",
      artworks: [{ id: "b1", imageName: "mountain" }],
    });
    const begun = coordinator.begin("new.json", async () =>
      JSON.stringify(newPack),
    );
    await flushMicrotasks();
    // 解码进行中，参观者收藏了旧展的 a1（mountain）
    h.collection.favorites = [mountain];
    gate.releaseAll();
    await begun;
    expect(coordinator.current.phase).toBe("preview");
    // 预览报告反映了解码期间的收藏
    expect(coordinator.current.report?.identity.favoritesMatched).toBe(1);
    await coordinator.confirm();
    const migrations = await h.store.listMigrations();
    expect(migrations.at(-1)?.favoritesMatched).toEqual([mountain]);
  });

  it("取消后迟到的解码结果被丢弃：暂存清空、旧展完好、状态回到 idle", async () => {
    const gate = makeGatedDecoder();
    const h = makeHarness(gate.decoder);
    await installPack(h.store, oldPack);
    const newPack = await makePack({
      id: "ex-new",
      artworks: [
        { id: "b1", imageName: "new-img-1" },
        { id: "b2", imageName: "new-img-2" },
      ],
    });
    const begun = h.coordinator.begin("new.json", async () =>
      JSON.stringify(newPack),
    );
    await flushMicrotasks();
    expect(gate.pending()).toBeGreaterThan(0);
    await h.coordinator.cancel();
    expect(h.coordinator.current.phase).toBe("idle");
    // 解码结果迟到到达
    gate.releaseAll();
    await begun;
    await flushMicrotasks();
    const snap = await h.store.capacitySnapshot();
    expect(snap.stagedBytes).toBe(0);
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");
    // 旧展资源一个不少
    expect(h.store._dump().assets.has(mountain)).toBe(true);
    expect(h.store._dump().assets.has(tideOld)).toBe(true);
  });

  it("连续导入两个包：第一个被取代，其迟到结果不会混入", async () => {
    const h = makeHarness(async (bytes) => {
      const text = new TextDecoder().decode(bytes);
      if (text.includes("slow")) await new Promise((r) => setTimeout(r, 60));
    });
    await installPack(h.store, oldPack);
    const packSlow = await makePack({
      id: "ex-slow",
      artworks: [{ id: "s1", imageName: "slow-image" }],
    });
    const packFast = await makePack({
      id: "ex-fast",
      artworks: [{ id: "f1", imageName: "fast-image" }],
    });
    const first = h.coordinator.begin("slow.json", async () =>
      JSON.stringify(packSlow),
    );
    await flushMicrotasks(2);
    const second = h.coordinator.begin("fast.json", async () =>
      JSON.stringify(packFast),
    );
    await Promise.all([first, second]);
    expect(h.coordinator.current.phase).toBe("preview");
    expect(h.coordinator.current.sourceName).toBe("fast.json");
    await h.coordinator.confirm();
    expect((await h.store.getActive())?.manifest.id).toBe("ex-fast");
    // 慢包的资源没有混入存储
    const slowHash = packSlow.artworks[0].imageRef;
    expect(h.store._dump().assets.has(slowHash)).toBe(false);
    const snap = await h.store.capacitySnapshot();
    expect(snap.stagedBytes).toBe(0);
  });

  it("损坏讲解：空文本与缺失音频 → 警告降级，包仍可导入", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    const pack = await makePack({
      id: "ex-broken-narration",
      artworks: [
        { id: "b1", imageName: "img-1" },
        { id: "b2", imageName: "img-2" },
      ],
      narration: {
        b1: [],
        b2: { transcript: ["保留文本"], audioRef: "sha256:" + "0".repeat(64) },
      },
    });
    await h.coordinator.begin("broken.json", async () => JSON.stringify(pack));
    expect(h.coordinator.current.phase).toBe("preview");
    const report = h.coordinator.current.report!;
    expect(report.ok).toBe(true);
    expect(report.issues.every((i) => i.level === "warning")).toBe(true);
    expect(report.narration.filter((n) => n.status === "degraded")).toHaveLength(2);
    await h.coordinator.confirm();
    expect((await h.store.getActive())?.manifest.id).toBe("ex-broken-narration");
  });

  it("图片内容校验失败 → 导入失败，旧展资源完好", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    const pack = await makePack({
      id: "ex-tampered",
      artworks: [{ id: "b1", imageName: "img-1" }],
    });
    // 篡改图片字节（哈希不再匹配）
    pack.assets[0].bytes = base64Encode("tampered-bytes");
    await h.coordinator.begin("tampered.json", async () => JSON.stringify(pack));
    expect(h.coordinator.current.phase).toBe("failed");
    expect(h.coordinator.current.report?.issues.some((i) => i.code === "hash-mismatch")).toBe(true);
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");
    expect((await h.store.capacitySnapshot()).stagedBytes).toBe(0);
  });

  it("图片无法解码 → 失败；图片解码成功但路线断裂 → 同样失败（解码成功 ≠ 整包可用）", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    const undecodable = await makePack({
      id: "ex-bad-img",
      artworks: [{ id: "b1", imageName: "undecodable-image" }],
    });
    await h.coordinator.begin("bad.json", async () => JSON.stringify(undecodable));
    expect(h.coordinator.current.phase).toBe("failed");

    const brokenRoute = await makePack({
      id: "ex-broken-route",
      artworks: [{ id: "b1", imageName: "fine-image" }],
      routes: [{ id: "r", name: "断", stops: ["b1", "ghost"] }],
    });
    await h.coordinator.begin("broken-route.json", async () =>
      JSON.stringify(brokenRoute),
    );
    expect(h.coordinator.current.phase).toBe("failed");
    expect(
      h.coordinator.current.report?.issues.some((i) => i.code === "broken-route"),
    ).toBe(true);
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");
  });

  it("空间冲突在预览中被报告并阻断确认", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    const pack = await makePack({
      id: "ex-conflict",
      artworks: [
        { id: "b1", imageName: "img-1", x: 0, z: -4 },
        { id: "b2", imageName: "img-2", x: 0, z: -4 },
      ],
    });
    await h.coordinator.begin("conflict.json", async () => JSON.stringify(pack));
    expect(h.coordinator.current.phase).toBe("failed");
    const report = h.coordinator.current.report!;
    expect(report.spatial.overlaps.length).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  });

  it("容量不足：预检即失败并给出缺口，未写入任何暂存", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    await h.store.setMeta(META_BUDGET, 60); // 极小预算
    const pack = await makePack({
      id: "ex-big",
      artworks: [
        { id: "b1", imageName: "big-image-1" },
        { id: "b2", imageName: "big-image-2" },
      ],
    });
    await h.coordinator.begin("big.json", async () => JSON.stringify(pack));
    expect(h.coordinator.current.phase).toBe("failed");
    expect(h.coordinator.current.error).toContain("容量不足");
    const report = h.coordinator.current.report!;
    expect(report.capacity.fits).toBe(false);
    expect(report.capacity.shortfall).toBeGreaterThan(0);
    expect((await h.store.capacitySnapshot()).stagedBytes).toBe(0);
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");
  });

  it("容量足够但需回收归档：预览给出回收计划，确认时执行", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    // 先导入 ex-mid 使其成为归档
    const mid = await makePack({
      id: "ex-mid",
      title: "中间展",
      artworks: [{ id: "m1", imageName: "mid-image" }],
    });
    await h.coordinator.begin("mid.json", async () => JSON.stringify(mid));
    await h.coordinator.confirm();
    expect((await h.store.getExhibition("ex-old"))?.status).toBe("archived");
    // 预算：刚好容下 mid + 新展，但必须回收 ex-old
    const midHash = mid.artworks[0].imageRef;
    const midSize = h.store._dump().assets.get(midHash)?.size ?? 0;
    const mountainSize = h.store._dump().assets.get(mountain)?.size ?? 0;
    const tideOldSize = h.store._dump().assets.get(tideOld)?.size ?? 0;
    const next = await makePack({
      id: "ex-next",
      artworks: [{ id: "n1", imageName: "next-image" }],
    });
    const nextSize = base64ToBytes(next.assets[0].bytes).byteLength;
    await h.store.setMeta(
      META_BUDGET,
      midSize + mountainSize + nextSize + 1, // tideOld 必须被回收
    );
    await h.coordinator.begin("next.json", async () => JSON.stringify(next));
    expect(h.coordinator.current.phase).toBe("preview");
    const report = h.coordinator.current.report!;
    expect(report.capacity.evictions.map((e) => e.id)).toContain("ex-old");
    await h.coordinator.confirm();
    // ex-old 的资源已被回收，清单保留
    const oldRow = await h.store.getExhibition("ex-old");
    expect(oldRow?.assetsCleared).toBe(true);
    expect(h.store._dump().assets.has(tideOld)).toBe(false);
    expect(h.store._dump().assets.has(mountain)).toBe(false);
    void tideOldSize;
  });

  it("重新导入同一展览（同 id）：正常刷新，资源引用不泄漏", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    const before = h.store._dump().assets.size;
    await h.coordinator.begin("again.json", async () => JSON.stringify(oldPack));
    expect(h.coordinator.current.phase).toBe("preview");
    await h.coordinator.confirm();
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");
    const dump = h.store._dump();
    expect(dump.assets.size).toBe(before);
    for (const [, a] of dump.assets) expect(a.refs).toBe(1);
  });

  it("启动清理：上次会话遗留的暂存被移除", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    await h.store.stageAsset(999, {
      hash: "sha256:" + "9".repeat(64),
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect((await h.store.capacitySnapshot()).stagedBytes).toBe(3);
    const { removedStaging } = await h.store.bootCleanup();
    expect(removedStaging).toBe(1);
    expect((await h.store.capacitySnapshot()).stagedBytes).toBe(0);
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");
  });

  it("提交原子性：预算被调低导致不变量失败时，旧展与暂存状态不变", async () => {
    const h = makeHarness();
    await installPack(h.store, oldPack);
    const pack = await makePack({
      id: "ex-new",
      artworks: [{ id: "b1", imageName: "brand-new-image" }],
    });
    await h.coordinator.begin("new.json", async () => JSON.stringify(pack));
    expect(h.coordinator.current.phase).toBe("preview");
    // 预览通过后，预算被调到装不下新展
    await h.store.setMeta(META_BUDGET, 10);
    const ok = await h.coordinator.confirm();
    expect(ok).toBe(false);
    expect(h.coordinator.current.phase).toBe("failed");
    // 旧展仍是当前展览，资源未丢失
    expect((await h.store.getActive())?.manifest.id).toBe("ex-old");
    expect(h.store._dump().assets.has(mountain)).toBe(true);
    expect(h.store._dump().assets.has(tideOld)).toBe(true);
  });
});

function base64Encode(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}
