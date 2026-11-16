/**
 * 语义校验：引用完整性、空间冲突、讲解可用性、容量与身份预览。
 *
 * 设计原则：图片解码成功 ≠ 整包可用。只有这里全部通过（无 error 级问题），
 * 包才被认为“可用”；讲解类问题只会降级（warning），不阻断导入。
 */
import type {
  CapacityPreview,
  ExhibitionPack,
  IdentityPreview,
  NarrationReport,
  PackReport,
  ReportIssue,
  SpatialReport,
} from "./types";
import { base64Length } from "./base64";
import { planCapacity, type CapacityState } from "./capacity";
import { buildIdentity, resolveFavorites, resolveVisits } from "./identity";
import { narrationTranscript } from "./packFormat";

/** 展厅内固定设施（中央雕塑基座），作品不得与其冲突 */
export const OBSTACLES = [{ name: "中央雕塑", x: 0, z: -0.3, w: 1.8, d: 1.5 }];

/** 作品 footprint 的进深（画框厚度方向，米） */
const FRAME_DEPTH = 0.4;
/** 锚点允许超出地面边界的容差（墙体厚度方向） */
const WALL_TOLERANCE = 0.3;
/** 画框与室内空间在每个轴向上必须保有的最小交集（米） */
const MIN_INSIDE = 0.05;

type Box = { x0: number; z0: number; x1: number; z1: number };

function artworkBox(a: {
  place: { x: number; z: number; w: number };
}): Box {
  return {
    x0: a.place.x - a.place.w / 2,
    x1: a.place.x + a.place.w / 2,
    z0: a.place.z - FRAME_DEPTH / 2,
    z1: a.place.z + FRAME_DEPTH / 2,
  };
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0 && d > 0 ? w * d : 0;
}

export function checkSpatial(pack: ExhibitionPack): SpatialReport {
  const overlaps: SpatialReport["overlaps"] = [];
  const outOfBounds: string[] = [];
  const { width, depth } = pack.exhibition.space;
  for (const a of pack.artworks) {
    // 挂画物理模型：画框挂在墙面上，可以探出地面边界；
    // 越界 = 锚点离开室内（含墙体容差），或画框与室内的交集不足最小进深
    const anchorOut =
      Math.abs(a.place.x) > width / 2 + WALL_TOLERANCE ||
      Math.abs(a.place.z) > depth / 2 + WALL_TOLERANCE;
    const box = artworkBox(a);
    const insideX =
      Math.min(box.x1, width / 2) - Math.max(box.x0, -width / 2);
    const insideZ =
      Math.min(box.z1, depth / 2) - Math.max(box.z0, -depth / 2);
    if (anchorOut || insideX < MIN_INSIDE || insideZ < MIN_INSIDE) {
      outOfBounds.push(a.id);
    }
    for (const ob of OBSTACLES) {
      const area = overlapArea(box, {
        x0: ob.x - ob.w / 2,
        x1: ob.x + ob.w / 2,
        z0: ob.z - ob.d / 2,
        z1: ob.z + ob.d / 2,
      });
      if (area > 0.0001) {
        overlaps.push({ a: a.id, b: ob.name, area });
      }
    }
  }
  for (let i = 0; i < pack.artworks.length; i++) {
    for (let j = i + 1; j < pack.artworks.length; j++) {
      const area = overlapArea(
        artworkBox(pack.artworks[i]),
        artworkBox(pack.artworks[j]),
      );
      if (area > 0.0001) {
        overlaps.push({ a: pack.artworks[i].id, b: pack.artworks[j].id, area });
      }
    }
  }
  return { overlaps, outOfBounds };
}

export type ReferenceReport = {
  missingRequired: string[];
  missingOptional: string[];
  brokenRoutes: { id: string; name: string; broken: string[] }[];
  danglingNarration: string[];
};

export function checkReferences(pack: ExhibitionPack): ReferenceReport {
  const assetHashes = new Set(pack.assets.map((a) => a.hash));
  const artworkIds = new Set(pack.artworks.map((a) => a.id));
  const missingRequired = new Set<string>();
  const missingOptional = new Set<string>();
  for (const a of pack.artworks) {
    if (!assetHashes.has(a.imageRef)) missingRequired.add(a.imageRef);
  }
  const danglingNarration: string[] = [];
  for (const n of pack.narration) {
    if (!artworkIds.has(n.artwork)) danglingNarration.push(n.artwork);
    if (n.audioRef && !assetHashes.has(n.audioRef))
      missingOptional.add(n.audioRef);
  }
  const brokenRoutes = pack.routes
    .map((r) => ({
      id: r.id,
      name: r.name,
      broken: r.stops.filter((s) => !artworkIds.has(s)),
    }))
    .filter((r) => r.broken.length > 0);
  return {
    missingRequired: [...missingRequired],
    missingOptional: [...missingOptional],
    brokenRoutes,
    danglingNarration,
  };
}

/** 讲解可用性：文本为空或音频缺失 → 降级（可导入，该作品讲解不可用） */
export function checkNarration(pack: ExhibitionPack): NarrationReport[] {
  const assetHashes = new Set(pack.assets.map((a) => a.hash));
  const byArtwork = new Map(pack.narration.map((n) => [n.artwork, n]));
  return pack.artworks.map((a) => {
    const n = byArtwork.get(a.id);
    if (!n) return { artwork: a.id, status: "degraded", reason: "无讲解资源" };
    if (narrationTranscript(n).length === 0)
      return { artwork: a.id, status: "degraded", reason: "讲解文本缺失或为空" };
    if (n.audioRef && !assetHashes.has(n.audioRef))
      return { artwork: a.id, status: "degraded", reason: "讲解音频缺失，仅保留文本" };
    return { artwork: a.id, status: "ok" };
  });
}

export function buildCapacityPreview(
  pack: ExhibitionPack,
  state: CapacityState,
  existingHashes: ReadonlySet<string>,
): CapacityPreview {
  const seen = new Set<string>();
  let requiredBytes = 0;
  let reusedBytes = 0;
  for (const asset of pack.assets) {
    if (seen.has(asset.hash)) continue;
    seen.add(asset.hash);
    const size = base64Length(asset.bytes);
    if (existingHashes.has(asset.hash)) reusedBytes += size;
    else requiredBytes += size;
  }
  const archivedBytes = state.archived.reduce((n, a) => n + a.bytes, 0);
  const plan = planCapacity(state, requiredBytes);
  const evictions = plan.evictions.map((id) => {
    const found = state.archived.find((a) => a.id === id)!;
    return { id, title: found.title, bytes: found.bytes };
  });
  return {
    requiredBytes,
    reusedBytes,
    pinnedBytes: state.pinnedBytes,
    stagedBytes: state.stagedBytes,
    archivedBytes,
    evictableBytes: archivedBytes,
    budgetBytes: state.budgetBytes,
    fits: plan.fits,
    shortfall: plan.shortfall,
    evictions,
  };
}

export function buildIdentityPreview(
  pack: ExhibitionPack,
  collection: { favorites: string[]; visits: string[] },
  titleOf: (key: string) => string | undefined,
): IdentityPreview {
  const identity = buildIdentity(pack.artworks);
  const favorites = resolveFavorites(collection.favorites, identity);
  const visits = resolveVisits(collection.visits, identity);
  return {
    favoritesMatched: favorites.matched.length,
    favoritesArchived: favorites.archived.length,
    visitsMatched: visits.matched,
    visitsArchived: visits.archived,
    matchedTitles: favorites.matched.map(
      (k) => titleOf(k) ?? k.slice(0, 18) + "…",
    ),
    archivedTitles: favorites.archived.map(
      (k) => titleOf(k) ?? k.slice(0, 18) + "…",
    ),
  };
}

/** 汇总完整预览报告（在结构校验通过、资源核验完成后调用） */
export function buildReport(input: {
  pack: ExhibitionPack;
  extraIssues: ReportIssue[];
  capacity: CapacityPreview;
  identity: IdentityPreview;
  /** 包资源总字节（在资源字节被释放前预计算） */
  statsBytes?: number;
}): PackReport {
  const { pack } = input;
  const refs = checkReferences(pack);
  const spatial = checkSpatial(pack);
  const narration = checkNarration(pack);
  const issues: ReportIssue[] = [...input.extraIssues];
  // 身份唯一性：同一展览内两件作品共用同一图片 → 身份冲突，必须拒绝
  const seenImage = new Map<string, string>();
  for (const a of pack.artworks) {
    const prev = seenImage.get(a.imageRef);
    if (prev) {
      issues.push({
        level: "error",
        code: "schema",
        message: `作品 ${prev} 与 ${a.id} 使用同一张图片，作品身份冲突`,
        refs: [prev, a.id],
      });
    } else {
      seenImage.set(a.imageRef, a.id);
    }
  }
  for (const hash of refs.missingRequired)
    issues.push({
      level: "error",
      code: "missing-asset",
      message: `作品图片资源缺失：${hash.slice(0, 20)}…`,
      refs: [hash],
    });
  for (const hash of refs.missingOptional)
    issues.push({
      level: "warning",
      code: "missing-asset",
      message: `讲解音频资源缺失（降级为文本讲解）：${hash.slice(0, 20)}…`,
      refs: [hash],
    });
  for (const r of refs.brokenRoutes)
    issues.push({
      level: "error",
      code: "broken-route",
      message: `路线「${r.name}」引用了不存在的作品：${r.broken.join("、")}`,
      refs: r.broken,
    });
  for (const id of refs.danglingNarration)
    issues.push({
      level: "warning",
      code: "broken-narration-ref",
      message: `讲解指向不存在的作品 ${id}，将被忽略`,
      refs: [id],
    });
  for (const o of spatial.overlaps)
    issues.push({
      level: "error",
      code: "spatial-overlap",
      message: `空间冲突：${o.a} 与 ${o.b} 占位重叠 ${o.area.toFixed(2)}㎡`,
      refs: [o.a, o.b],
    });
  for (const id of spatial.outOfBounds)
    issues.push({
      level: "error",
      code: "spatial-out-of-bounds",
      message: `作品 ${id} 的摆放超出展厅边界`,
      refs: [id],
    });
  for (const n of narration)
    if (n.status === "degraded")
      issues.push({
        level: "warning",
        code: "narration-degraded",
        message: `作品 ${n.artwork} 的讲解降级：${n.reason}`,
        refs: [n.artwork],
      });
  if (!input.capacity.fits)
    issues.push({
      level: "error",
      code: "capacity",
      message: `容量不足：还需 ${input.capacity.shortfall} 字节，已无可回收的归档资源`,
    });
  const bytes =
    input.statsBytes ??
    pack.assets.reduce((n, a) => n + base64Length(a.bytes), 0);
  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    stats: {
      artworks: pack.artworks.length,
      routes: pack.routes.length,
      assets: pack.assets.length,
      bytes,
    },
    capacity: input.capacity,
    identity: input.identity,
    missing: { required: refs.missingRequired, optional: refs.missingOptional },
    routes: refs.brokenRoutes,
    spatial,
    narration,
  };
}
