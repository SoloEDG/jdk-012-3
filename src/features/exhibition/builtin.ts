/**
 * 内置展览包构建器：把 shared/catalog.ts 的静态数据 + 程序化画家
 * 转换为与导入包完全同构的展览清单 + 内容寻址资源。
 * 首次启动时安装到存储层；此后内置展览与导入展览走同一条代码路径。
 */
import { artworks, routes } from "../../shared/catalog";
import type { ExhibitionManifest } from "../../shared/exchange/types";
import { contentHash } from "../../shared/exchange/hash";
import type { StagedAsset } from "../../shared/exchange/storeTypes";
import { canvasToPngBytes } from "../../shared/exchange/imageTools";
import { paintBuiltinArtwork } from "../space/lib/painters";

export const BUILTIN_EXHIBITION_ID = "builtin-yujing-001";

export async function buildBuiltinPack(): Promise<{
  manifest: ExhibitionManifest;
  assets: StagedAsset[];
}> {
  const assets: StagedAsset[] = [];
  const assetMeta: ExhibitionManifest["assets"] = [];
  const packArtworks: ExhibitionManifest["artworks"] = [];
  for (const a of artworks) {
    const canvas = paintBuiltinArtwork(a.id);
    const bytes = await canvasToPngBytes(canvas);
    const hash = await contentHash(bytes);
    assets.push({ hash, mime: "image/png", bytes });
    assetMeta.push({ hash, mime: "image/png", size: bytes.byteLength });
    packArtworks.push({
      id: a.id,
      title: a.title,
      en: a.en,
      artist: a.artist,
      year: a.year,
      medium: a.medium,
      color: a.color,
      description: a.description,
      duration: a.duration,
      place: {
        x: a.position.x,
        z: a.position.z,
        facing: a.facing,
        w: 2.13,
        h: 2.73,
      },
      imageRef: hash,
    });
  }
  const manifest: ExhibitionManifest = {
    id: BUILTIN_EXHIBITION_ID,
    title: "万物之间",
    en: "BETWEEN ALL THINGS",
    intro: "当自然、空间与想象相遇，一场不受边界限制的艺术漫游。",
    space: { width: 12, depth: 16 },
    artworks: packArtworks,
    routes: routes.map((r) => ({ ...r })),
    narration: artworks.map((a) => ({
      artwork: a.id,
      transcript: [...a.transcript],
    })),
    assets: assetMeta,
    bytesTotal: assetMeta.reduce((n, m) => n + m.size, 0),
  };
  return { manifest, assets };
}
