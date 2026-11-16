/**
 * 策展包（.yujingpack）格式与运行时展览的类型定义。
 *
 * 核心约定：
 * - 作品身份 = 图片内容的 SHA-256（imageRef / artworkKey），与作品名称无关。
 *   名称相同但图片内容不同的作品是不同的作品，绝不合并。
 * - 策展人可在包内通过 sameAs 显式声明“此作品即另一内容哈希的同一作品”，
 *   这是除内容哈希相等之外唯一被承认的身份规则。
 */

export const PACK_FORMAT = "yujing-pack/1";

/** 包内资源：内容寻址，hash = "sha256:" + 十六进制 */
export type PackAsset = {
  hash: string;
  mime: string;
  /** base64 编码的资源字节 */
  bytes: string;
};

export type PackPlace = {
  x: number;
  z: number;
  /** 朝向（弧度），作品正面法线方向 */
  facing: number;
  /** 画面宽 / 高（米） */
  w: number;
  h: number;
};

export type PackArtwork = {
  id: string;
  title: string;
  en: string;
  artist: string;
  year: string;
  medium: string;
  color: string;
  description: string;
  /** 讲解时长（秒）；无讲解时为 0 */
  duration: number;
  place: PackPlace;
  /** 图片资源哈希，即作品身份 */
  imageRef: string;
  /** 策展人显式声明的身份别名（旧展作品的内容哈希） */
  sameAs?: string[];
};

export type PackRoute = {
  id: string;
  name: string;
  subtitle: string;
  stops: string[];
};

export type PackNarration = {
  artwork: string;
  transcript: string[];
  /** 可选的讲解音频资源哈希 */
  audioRef?: string;
};

export type PackExhibition = {
  id: string;
  title: string;
  en: string;
  intro: string;
  space: { width: number; depth: number };
};

export type ExhibitionPack = {
  format: typeof PACK_FORMAT;
  exhibition: PackExhibition;
  artworks: PackArtwork[];
  routes: PackRoute[];
  narration: PackNarration[];
  assets: PackAsset[];
};

/** 存入 IndexedDB 的清单：与包结构一致，但资源只保留元信息（字节独立存放） */
export type AssetMeta = { hash: string; mime: string; size: number };

export type ExhibitionManifest = {
  id: string;
  title: string;
  en: string;
  intro: string;
  space: { width: number; depth: number };
  artworks: PackArtwork[];
  routes: PackRoute[];
  narration: PackNarration[];
  assets: AssetMeta[];
  bytesTotal: number;
};

export type ExhibitionStatus = "active" | "staged" | "archived";

export type StoredExhibition = {
  manifest: ExhibitionManifest;
  status: ExhibitionStatus;
  /** staged 状态所属的导入会话 */
  sessionId?: number;
  importedAt: number;
  archivedAt?: number;
  /** 归档后资源是否已被容量回收清除（清单保留，用于收藏标题解析） */
  assetsCleared?: boolean;
};

/** 导入前预览报告 */
export type ReportIssue = {
  level: "error" | "warning";
  code:
    | "schema"
    | "capacity"
    | "hash-mismatch"
    | "decode-failed"
    | "missing-asset"
    | "broken-route"
    | "broken-narration-ref"
    | "narration-degraded"
    | "spatial-overlap"
    | "spatial-out-of-bounds";
  message: string;
  refs?: string[];
};

export type CapacityPreview = {
  /** 本包实际需要新写入的字节（去重后） */
  requiredBytes: number;
  /** 与现有资源内容相同、可直接复用的字节 */
  reusedBytes: number;
  pinnedBytes: number;
  stagedBytes: number;
  archivedBytes: number;
  evictableBytes: number;
  budgetBytes: number;
  fits: boolean;
  shortfall: number;
  /** 为容纳本包将按 LRU 释放的归档展览 */
  evictions: { id: string; title: string; bytes: number }[];
};

export type IdentityPreview = {
  favoritesMatched: number;
  favoritesArchived: number;
  visitsMatched: number;
  visitsArchived: number;
  matchedTitles: string[];
  archivedTitles: string[];
};

export type SpatialReport = {
  overlaps: { a: string; b: string; area: number }[];
  outOfBounds: string[];
};

export type NarrationReport = {
  artwork: string;
  status: "ok" | "degraded";
  reason?: string;
};

export type PackReport = {
  ok: boolean;
  issues: ReportIssue[];
  stats: { artworks: number; routes: number; assets: number; bytes: number };
  capacity: CapacityPreview;
  identity: IdentityPreview;
  missing: { required: string[]; optional: string[] };
  routes: { id: string; name: string; broken: string[] }[];
  spatial: SpatialReport;
  narration: NarrationReport[];
};

/** 切换展览时的迁移记录（可观察、可审计） */
export type MigrationEntry = {
  at: number;
  from: { id: string; title: string };
  to: { id: string; title: string };
  rule: "image-sha256+declared-alias";
  favoritesMatched: string[];
  favoritesArchived: string[];
  visitsMatched: number;
  visitsArchived: number;
};

export type ExchangeEvent = {
  at: number;
  kind:
    | "boot"
    | "integrity"
    | "import-state"
    | "capacity"
    | "eviction"
    | "migration"
    | "commit"
    | "cancel"
    | "error";
  message: string;
};
