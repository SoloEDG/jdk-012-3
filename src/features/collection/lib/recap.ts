import type { GalleryDocument } from "../../../shared/types";

export type RecapResolver = {
  /** 当前展览内可解析的身份键 → 作品 */
  resolve(key: string): { title: string; artist: string } | undefined;
};

export function recapStats(
  d: GalleryDocument,
  resolve: RecapResolver["resolve"],
) {
  const current = d.visits.filter((v) => resolve(v.key));
  return {
    seen: current.filter((v) => v.seconds >= 2).length,
    seconds: Math.round(current.reduce((n, v) => n + v.seconds, 0)),
    saved: d.favorites.length,
    savedHere: d.favorites.filter((k) => resolve(k)).length,
    archived: d.favorites.filter((k) => !resolve(k)).length,
  };
}

export function createRecap(
  d: GalleryDocument,
  resolve: RecapResolver["resolve"],
  exhibitionTitle: string,
): string {
  const stats = recapStats(d, resolve);
  const lines = [
    `余境 · 我的参观回顾（${exhibitionTitle}）`,
    `观看 ${stats.seen} 件作品 · 停留 ${stats.seconds} 秒`,
    "",
  ];
  for (const key of d.favorites) {
    const a = resolve(key);
    if (!a) continue;
    lines.push(
      `${a.title} / ${a.artist}`,
      d.notes[key] || "未添加感想",
      `停留 ${Math.round(d.visits.find((v) => v.key === key)?.seconds || 0)} 秒`,
      "",
    );
  }
  if (stats.archived > 0) {
    lines.push(`另有 ${stats.archived} 件收藏来自其他展览，已妥善保留。`);
  }
  return lines.join("\n");
}
