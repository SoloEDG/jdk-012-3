export type Point = { x: number; z: number };
export type Artwork = {
  id: string;
  title: string;
  en: string;
  artist: string;
  year: string;
  medium: string;
  color: string;
  position: Point;
  facing: number;
  description: string;
  transcript: string[];
  duration: number;
};
export type Route = {
  id: string;
  name: string;
  subtitle: string;
  stops: string[];
};
/**
 * 参观记录与收藏以“作品身份键”（图片内容哈希）为键 —— 与展览内 id 无关。
 * 这样跨展览迁移只依赖内容身份规则，id 在不同包中即使撞车也不会混淆。
 */
export type Visit = { key: string; seconds: number; at: number };
export type GalleryDocument = {
  favorites: string[];
  visits: Visit[];
  notes: Record<string, string>;
};
export type TourState = {
  routeId: string | null;
  step: number;
  phase: "idle" | "walking" | "listening" | "paused" | "done";
};
export type AudioState = {
  artworkId: string | null;
  elapsed: number;
  playing: boolean;
  rate: number;
};
export type Command =
  { type: "focus"; id: string } | { type: "favorite"; id: string };
