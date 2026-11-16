import { describe, it, expect } from "vitest";
import {
  checkReferences,
  checkSpatial,
  checkNarration,
  buildReport,
  buildCapacityPreview,
  buildIdentityPreview,
} from "../src/shared/exchange/validate";
import { makePack } from "./helpers";
import type { CapacityState } from "../src/shared/exchange/capacity";

const emptyCapacity: CapacityState = {
  budgetBytes: 100 * 1024 * 1024,
  pinnedBytes: 0,
  stagedBytes: 0,
  archived: [],
};

describe("validate 语义校验", () => {
  it("缺失图片资源 → error；缺失讲解音频 → warning 级降级", async () => {
    const pack = await makePack({
      artworks: [{ id: "a", imageName: "img-a" }],
      narration: { a: { transcript: ["讲解"], audioRef: "sha256:" + "1".repeat(64) } },
    });
    // 删掉图片资源，制造缺失
    pack.assets = pack.assets.filter((a) => a.mime !== "image/png");
    const refs = checkReferences(pack);
    expect(refs.missingRequired).toHaveLength(1);
    expect(refs.missingOptional).toHaveLength(1);
    const report = buildReport({
      pack,
      extraIssues: [],
      capacity: buildCapacityPreview(pack, emptyCapacity, new Set()),
      identity: buildIdentityPreview(pack, { favorites: [], visits: [] }, () => undefined),
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.level === "error" && i.code === "missing-asset")).toBe(true);
  });

  it("路线引用不存在的作品 → error", async () => {
    const pack = await makePack({
      artworks: [{ id: "a", imageName: "img-a" }],
      routes: [{ id: "r1", name: "断裂路线", stops: ["a", "ghost"] }],
    });
    const refs = checkReferences(pack);
    expect(refs.brokenRoutes).toHaveLength(1);
    expect(refs.brokenRoutes[0].broken).toEqual(["ghost"]);
  });

  it("空间冲突：重叠与越界都被检出", async () => {
    const pack = await makePack({
      artworks: [
        { id: "a", imageName: "img-a", x: -4, z: -4 },
        { id: "b", imageName: "img-b", x: -4, z: -4 }, // 与 a 完全重叠
        { id: "c", imageName: "img-c", x: 100, z: 0 }, // 越界
      ],
    });
    const spatial = checkSpatial(pack);
    expect(spatial.overlaps.some((o) => o.a === "a" && o.b === "b")).toBe(true);
    expect(spatial.outOfBounds).toContain("c");
  });

  it("与中央雕塑基座的冲突也被检出", async () => {
    const pack = await makePack({
      artworks: [{ id: "a", imageName: "img-a", x: 0, z: -0.3 }],
    });
    const spatial = checkSpatial(pack);
    expect(spatial.overlaps.some((o) => o.b === "中央雕塑")).toBe(true);
  });

  it("讲解降级：空文本与缺失音频 → warning，不阻断导入", async () => {
    const pack = await makePack({
      artworks: [
        { id: "a", imageName: "img-a" },
        { id: "b", imageName: "img-b" },
        { id: "c", imageName: "img-c" },
      ],
      narration: {
        a: ["完整讲解"],
        b: [],
        c: { transcript: ["文本保留"], audioRef: "sha256:" + "2".repeat(64) },
      },
    });
    const narration = checkNarration(pack);
    expect(narration.find((n) => n.artwork === "a")?.status).toBe("ok");
    expect(narration.find((n) => n.artwork === "b")?.status).toBe("degraded");
    expect(narration.find((n) => n.artwork === "c")?.status).toBe("degraded");
    const report = buildReport({
      pack,
      extraIssues: [],
      capacity: buildCapacityPreview(pack, emptyCapacity, new Set()),
      identity: buildIdentityPreview(pack, { favorites: [], visits: [] }, () => undefined),
    });
    expect(report.ok).toBe(true); // 只有 warning，可导入
  });

  it("同一展览内两件作品共用同一图片 → 身份冲突 error", async () => {
    const pack = await makePack({
      artworks: [
        { id: "a", imageName: "same-img" },
        { id: "b", imageName: "same-img" },
      ],
    });
    const report = buildReport({
      pack,
      extraIssues: [],
      capacity: buildCapacityPreview(pack, emptyCapacity, new Set()),
      identity: buildIdentityPreview(pack, { favorites: [], visits: [] }, () => undefined),
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.message.includes("身份冲突"))).toBe(true);
  });

  it("容量预览：去重计算 requiredBytes 与 reusedBytes", async () => {
    const pack = await makePack({
      artworks: [
        { id: "a", imageName: "img-a" },
        { id: "b", imageName: "img-b" },
      ],
    });
    const existing = new Set([pack.assets[0].hash]);
    const preview = buildCapacityPreview(pack, emptyCapacity, existing);
    expect(preview.reusedBytes).toBeGreaterThan(0);
    expect(preview.requiredBytes).toBeGreaterThan(0);
    expect(preview.fits).toBe(true);
  });
});
