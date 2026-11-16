/**
 * 作品身份规则。
 *
 * 作品身份 = 图片内容的 SHA-256（imageRef）。收藏、参观记录、笔记都以
 * artworkKey（即 imageRef）为键，因此“迁移”不是改写数据，而是在新展览的
 * 身份索引上重新解析：
 *
 * 1. 内容哈希完全相等 → 同一作品（哪怕 id、标题不同）；
 * 2. 策展人在包内用 sameAs 显式声明的别名 → 同一作品；
 * 3. 其他情况一律不合并 —— 名称相同但内容不同的作品绝不被视为同一作品。
 *
 * 无法在新展览中解析的记录保持“归档”状态，数据保留，绝不指向别的作品。
 */
import type { PackArtwork } from "./types";

export type IdentityIndex = {
  /** imageRef(内容哈希) -> artworkId */
  exact: ReadonlyMap<string, string>;
  /** 策展人声明的别名哈希 -> artworkId */
  alias: ReadonlyMap<string, string>;
  /** artworkId -> 内容哈希 */
  keyOf(id: string): string | undefined;
  /** 内容哈希（或别名）-> 当前展览中的 artworkId */
  resolve(key: string): string | undefined;
};

export function buildIdentity(
  artworks: Pick<PackArtwork, "id" | "imageRef" | "sameAs">[],
): IdentityIndex {
  const exact = new Map<string, string>();
  const alias = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const a of artworks) {
    exact.set(a.imageRef, a.id);
    byId.set(a.id, a.imageRef);
    for (const s of a.sameAs ?? []) {
      // 显式声明的别名不能覆盖内容完全相等的主映射
      if (!exact.has(s)) alias.set(s, a.id);
    }
  }
  return {
    exact,
    alias,
    keyOf: (id) => byId.get(id),
    resolve: (key) => exact.get(key) ?? alias.get(key),
  };
}

export type MigrationResolution = {
  /** 能迁移到新展览的收藏键 */
  matched: string[];
  /** 无法解析、保持归档的收藏键 */
  archived: string[];
};

export function resolveFavorites(
  favoriteKeys: string[],
  identity: IdentityIndex,
): MigrationResolution {
  const matched: string[] = [];
  const archived: string[] = [];
  for (const key of favoriteKeys) {
    if (identity.resolve(key)) matched.push(key);
    else archived.push(key);
  }
  return { matched, archived };
}

export function resolveVisits(
  visitKeys: string[],
  identity: IdentityIndex,
): { matched: number; archived: number } {
  let matched = 0;
  let archived = 0;
  for (const key of visitKeys) {
    if (identity.resolve(key)) matched++;
    else archived++;
  }
  return { matched, archived };
}
