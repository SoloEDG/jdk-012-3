import type { GalleryDocument } from "./types";

const KEY_V1 = "yujing-gallery-v1";
const KEY_V2 = "yujing-gallery-v2";

export const emptyDocument = (): GalleryDocument => ({
  favorites: [],
  visits: [],
  notes: {},
});

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function sanitize(d: unknown): GalleryDocument {
  if (typeof d !== "object" || !d) return emptyDocument();
  const doc = d as Partial<GalleryDocument>;
  return {
    favorites: isStringArray(doc.favorites) ? doc.favorites : [],
    visits: Array.isArray(doc.visits)
      ? doc.visits.filter(
          (v: { key?: unknown; seconds?: unknown }) =>
            typeof v.key === "string" && typeof v.seconds === "number",
        )
      : [],
    notes:
      typeof doc.notes === "object" && doc.notes ? (doc.notes as Record<string, string>) : {},
  };
}

export function loadDocument(): GalleryDocument {
  try {
    const d = JSON.parse(localStorage.getItem(KEY_V2) || "null");
    if (!d) return emptyDocument();
    return sanitize(d);
  } catch {
    return emptyDocument();
  }
}

export function saveDocument(d: GalleryDocument): boolean {
  try {
    localStorage.setItem(KEY_V2, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

/**
 * v1 → v2 迁移：旧文档以展览内 id 为键，新文档以作品身份键（内容哈希）为键。
 * 仅在首次启动（内置展览为当前展览）时执行一次；无法映射的条目被丢弃，
 * 绝不猜测性合并。迁移成功后删除 v1。
 */
export function migrateV1Document(
  keyOf: (artworkId: string) => string | undefined,
): boolean {
  try {
    if (localStorage.getItem(KEY_V2)) return false;
    const raw = localStorage.getItem(KEY_V1);
    if (!raw) return false;
    const old = JSON.parse(raw) as {
      favorites?: unknown;
      visits?: unknown;
      notes?: unknown;
    };
    const doc = emptyDocument();
    if (isStringArray(old.favorites)) {
      for (const id of old.favorites) {
        const key = keyOf(id);
        if (key && !doc.favorites.includes(key)) doc.favorites.push(key);
      }
    }
    if (Array.isArray(old.visits)) {
      for (const v of old.visits as { id?: unknown; seconds?: unknown; at?: unknown }[]) {
        if (typeof v.id !== "string" || typeof v.seconds !== "number") continue;
        const key = keyOf(v.id);
        if (!key) continue;
        const existing = doc.visits.find((x) => x.key === key);
        if (existing) existing.seconds += v.seconds;
        else
          doc.visits.push({
            key,
            seconds: v.seconds,
            at: typeof v.at === "number" ? v.at : Date.now(),
          });
      }
    }
    if (typeof old.notes === "object" && old.notes) {
      for (const [id, text] of Object.entries(old.notes as Record<string, string>)) {
        const key = keyOf(id);
        if (key && typeof text === "string") doc.notes[key] = text;
      }
    }
    localStorage.setItem(KEY_V2, JSON.stringify(doc));
    localStorage.removeItem(KEY_V1);
    return true;
  } catch {
    return false;
  }
}
