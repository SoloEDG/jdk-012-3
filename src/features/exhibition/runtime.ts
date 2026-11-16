/**
 * 运行时展览：由清单 + 资源字节构建出的、可直接渲染的展览对象。
 * 应用任何时候只持有一个运行时展览；切换 = 整体替换（revision 递增），
 * 旧运行时在替换完成后整体释放 —— 不存在新旧资源的交叉引用。
 */
import type { PackRoute } from "../../shared/exchange/types";
import type { ExhibitionManifest } from "../../shared/exchange/types";
import {
  buildIdentity,
  type IdentityIndex,
} from "../../shared/exchange/identity";
import { narrationTranscript } from "../../shared/exchange/packFormat";
import { composeArtworkCanvas, decodeToBitmap } from "../../shared/exchange/imageTools";
import type { Point } from "../../shared/types";

export type RuntimeArtwork = {
  id: string;
  title: string;
  en: string;
  artist: string;
  year: string;
  medium: string;
  color: string;
  description: string;
  duration: number;
  /** 讲解字幕；无讲解时为空数组 */
  transcript: string[];
  hasNarration: boolean;
  /** 作品身份 = 图片内容哈希 */
  imageKey: string;
  position: Point;
  facing: number;
  size: { w: number; h: number };
  image: HTMLCanvasElement;
  previewUrl: string;
};

export type RuntimeExhibition = {
  revision: number;
  id: string;
  title: string;
  en: string;
  intro: string;
  space: { width: number; depth: number };
  artworks: RuntimeArtwork[];
  routes: PackRoute[];
  identity: IdentityIndex;
  artworkById(id: string | null): RuntimeArtwork | undefined;
};

export class IntegrityError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`当前展览缺少 ${missing.length} 项资源`);
    this.missing = missing;
  }
}

export async function buildRuntime(
  manifest: ExhibitionManifest,
  readAsset: (
    hash: string,
  ) => Promise<{ mime: string; bytes: Uint8Array } | null>,
  revision: number,
): Promise<RuntimeExhibition> {
  const narrationByArtwork = new Map(
    manifest.narration.map((n) => [n.artwork, n]),
  );
  // 完整性检查：当前展览的任何资源缺失都视为完整性错误，
  // 由调用方决定自愈策略 —— 绝不渲染“半个展览”。
  const missing: string[] = [];
  const bytesByHash = new Map<string, { mime: string; bytes: Uint8Array }>();
  for (const meta of manifest.assets) {
    const found = await readAsset(meta.hash);
    if (!found) missing.push(meta.hash);
    else bytesByHash.set(meta.hash, found);
  }
  if (missing.length > 0) throw new IntegrityError(missing);

  const artworks: RuntimeArtwork[] = [];
  for (const a of manifest.artworks) {
    const asset = bytesByHash.get(a.imageRef)!;
    const bitmap = await decodeToBitmap(asset.bytes, asset.mime);
    const { canvas, previewUrl } = composeArtworkCanvas(bitmap);
    bitmap.close(); // 位图即刻释放，运行时只持有合成后的画布
    const n = narrationByArtwork.get(a.id);
    const transcript = n ? narrationTranscript(n) : [];
    artworks.push({
      id: a.id,
      title: a.title,
      en: a.en ?? "",
      artist: a.artist,
      year: a.year,
      medium: a.medium,
      color: a.color || "#c5a66d",
      description: a.description,
      duration: a.duration,
      transcript,
      hasNarration: transcript.length > 0,
      imageKey: a.imageRef,
      position: { x: a.place.x, z: a.place.z },
      facing: a.place.facing,
      size: { w: a.place.w, h: a.place.h },
      image: canvas,
      previewUrl,
    });
  }
  const byId = new Map(artworks.map((a) => [a.id, a]));
  return {
    revision,
    id: manifest.id,
    title: manifest.title,
    en: manifest.en,
    intro: manifest.intro,
    space: manifest.space,
    artworks,
    routes: manifest.routes as PackRoute[],
    identity: buildIdentity(manifest.artworks),
    artworkById: (id) => (id ? byId.get(id) : undefined),
  };
}
