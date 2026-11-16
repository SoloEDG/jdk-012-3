import { useState, useEffect } from "react";
import { loadDocument, saveDocument } from "../../../shared/storage";
import { useServices } from "../../exhibition/ServicesProvider";

/**
 * 收藏 / 参观记录 / 笔记：一律以作品身份键（图片内容哈希）存储。
 * 对外接口仍使用展览内 id，内部经当前展览的身份索引换算 ——
 * 解码期间新增的收藏，commit 时也会被正确迁移。
 */
export function useCollection() {
  const { runtime, collectionKeysRef } = useServices();
  const [document, setDocument] = useState(loadDocument);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setStorageError(!saveDocument(document));
  }, [document]);

  // 同步实时键集合：导入协调器在 commit 时刻读取（含解码期间的新增）
  useEffect(() => {
    collectionKeysRef.current = {
      favorites: document.favorites,
      visits: document.visits.map((v) => v.key),
    };
  }, [document, collectionKeysRef]);

  const keyOf = (id: string) => runtime.identity.keyOf(id);

  return {
    document,
    storageError,
    /** 当前展览中，某 id 是否已收藏 */
    isFavorite: (id: string | null) => {
      if (!id) return false;
      const key = keyOf(id);
      return key ? document.favorites.includes(key) : false;
    },
    toggle: (id: string) => {
      const key = keyOf(id);
      if (!key) return;
      setDocument((d) => ({
        ...d,
        favorites: d.favorites.includes(key)
          ? d.favorites.filter((x) => x !== key)
          : [...d.favorites, key],
      }));
    },
    note: (id: string, text: string) => {
      const key = keyOf(id);
      if (!key) return;
      setDocument((d) => ({ ...d, notes: { ...d.notes, [key]: text } }));
    },
    /** 直接按身份键写笔记（归档收藏没有当前展览 id，用此入口） */
    noteByKey: (key: string, text: string) =>
      setDocument((d) => ({ ...d, notes: { ...d.notes, [key]: text } })),
    toggleByKey: (key: string) =>
      setDocument((d) => ({
        ...d,
        favorites: d.favorites.includes(key)
          ? d.favorites.filter((x) => x !== key)
          : [...d.favorites, key],
      })),
    record: (id: string, seconds: number) => {
      const key = keyOf(id);
      if (!key) return;
      setDocument((d) => {
        const previous = d.visits.find((v) => v.key === key);
        return {
          ...d,
          visits: previous
            ? d.visits.map((v) =>
                v.key === key ? { ...v, seconds: v.seconds + seconds } : v,
              )
            : [...d.visits, { key, seconds, at: Date.now() }],
        };
      });
    },
  };
}
