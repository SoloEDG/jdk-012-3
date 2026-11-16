/** 导出当前展览为策展包文件（.yujingpack.json），用于再次交换。 */
import {
  PACK_FORMAT,
  type ExhibitionPack,
} from "../../../shared/exchange/types";
import { bytesToBase64 } from "../../../shared/exchange/base64";
import type { ExchangeStore } from "../../../shared/exchange/storeTypes";

export async function buildExportPack(
  store: ExchangeStore,
): Promise<ExhibitionPack> {
  const active = await store.getActive();
  if (!active) throw new Error("没有当前展览，无法导出");
  const m = active.manifest;
  const assets: ExhibitionPack["assets"] = [];
  for (const meta of m.assets) {
    const found = await store.readAsset(meta.hash);
    if (!found) {
      throw new Error(`资源 ${meta.hash.slice(0, 20)}… 缺失，导出中止`);
    }
    assets.push({
      hash: meta.hash,
      mime: meta.mime,
      bytes: bytesToBase64(found.bytes),
    });
  }
  return {
    format: PACK_FORMAT,
    exhibition: {
      id: m.id,
      title: m.title,
      en: m.en,
      intro: m.intro,
      space: m.space,
    },
    artworks: m.artworks,
    routes: m.routes,
    narration: m.narration,
    assets,
  };
}

export function downloadPack(pack: ExhibitionPack) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(pack)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${pack.exhibition.title}.yujingpack.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
