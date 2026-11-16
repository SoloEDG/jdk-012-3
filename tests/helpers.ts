/** 测试辅助：构造合法的策展包与可控的解码器 */
import {
  PACK_FORMAT,
  type ExhibitionPack,
  type PackArtwork,
} from "../src/shared/exchange/types";
import { contentHash } from "../src/shared/exchange/hash";
import { bytesToBase64 } from "../src/shared/exchange/base64";

export function fakeImageBytes(name: string): Uint8Array {
  return new TextEncoder().encode(`png-bytes-of-${name}`);
}

export async function fakeAsset(name: string) {
  const bytes = fakeImageBytes(name);
  return { hash: await contentHash(bytes), bytes };
}

export type TestArtworkSpec = {
  id: string;
  title?: string;
  imageName: string;
  x?: number;
  z?: number;
  sameAs?: string[];
};

/** 构造结构合法的包；图片字节为可预测的假数据 */
export async function makePack(input: {
  id?: string;
  title?: string;
  artworks: TestArtworkSpec[];
  routes?: { id: string; name: string; stops: string[] }[];
  narration?: Record<string, string[] | { transcript: string[]; audioRef?: string }>;
  extraAssets?: { name: string; mime?: string }[];
  space?: { width: number; depth: number };
}): Promise<ExhibitionPack> {
  const assets: ExhibitionPack["assets"] = [];
  const artworks: PackArtwork[] = [];
  const seen = new Map<string, string>();
  let index = 0;
  for (const spec of input.artworks) {
    let hash = seen.get(spec.imageName);
    if (!hash) {
      hash = (await fakeAsset(spec.imageName)).hash;
      seen.set(spec.imageName, hash);
      assets.push({
        hash,
        mime: "image/png",
        bytes: bytesToBase64(fakeImageBytes(spec.imageName)),
      });
    }
    // 默认摆放沿墙分布，互不重叠、不压中央雕塑
    const defaultX = -4 + (index % 3) * 4;
    const defaultZ = index < 3 ? -4 : 4;
    index += 1;
    artworks.push({
      id: spec.id,
      title: spec.title ?? `作品-${spec.id}`,
      en: spec.id.toUpperCase(),
      artist: "测试艺术家",
      year: "2026",
      medium: "测试媒介",
      color: "#888888",
      description: "测试描述",
      duration: 30,
      place: {
        x: spec.x ?? defaultX,
        z: spec.z ?? defaultZ,
        facing: 0,
        w: 2,
        h: 2.6,
      },
      imageRef: hash,
      sameAs: spec.sameAs,
    });
  }
  for (const extra of input.extraAssets ?? []) {
    const bytes = new TextEncoder().encode(`asset-${extra.name}`);
    assets.push({
      hash: await contentHash(bytes),
      mime: extra.mime ?? "audio/mpeg",
      bytes: bytesToBase64(bytes),
    });
  }
  const narration = Object.entries(input.narration ?? {}).map(
    ([artwork, value]) =>
      Array.isArray(value)
        ? { artwork, transcript: value }
        : { artwork, ...value },
  );
  return {
    format: PACK_FORMAT,
    exhibition: {
      id: input.id ?? "test-ex-1",
      title: input.title ?? "测试展览",
      en: "TEST",
      intro: "测试",
      space: input.space ?? { width: 12, depth: 16 },
    },
    artworks,
    routes: (input.routes ?? []).map((r) => ({
      ...r,
      subtitle: "测试路线",
    })),
    narration,
    assets,
  };
}

/** 可控解码器：bytes 含 "undecodable" 时失败；可注入人为延迟 */
export function makeDecoder(options?: {
  delayMs?: number;
  onCall?: () => void;
}): (bytes: Uint8Array, mime: string) => Promise<void> {
  return async (bytes) => {
    options?.onCall?.();
    if (options?.delayMs)
      await new Promise((r) => setTimeout(r, options.delayMs));
    const text = new TextDecoder().decode(bytes);
    if (text.includes("undecodable")) throw new Error("无法解码");
  };
}

/** 手动控制的延迟解码器：测试取消后迟到的解码结果 */
export function makeGatedDecoder() {
  const gates: (() => void)[] = [];
  const decoder = (_bytes: Uint8Array, _mime: string) =>
    new Promise<void>((resolve) => {
      gates.push(() => resolve());
    });
  return {
    decoder,
    /** 放行所有在途解码 */
    releaseAll() {
      while (gates.length) gates.shift()!();
    },
    pending: () => gates.length,
  };
}

export const flushMicrotasks = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};
