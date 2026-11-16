import { useEffect, useState } from "react";
import type { Point } from "../../../shared/types";
import { nearbyArtwork } from "../lib/proximity";
import { useServices } from "../../exhibition/ServicesProvider";

export function useCatalog() {
  const { runtime } = useServices();
  const [active, setActive] = useState<string | null>(
    runtime.artworks[0]?.id ?? null,
  );
  const [nearby, setNearby] = useState<string | null>(null);
  // 展览切换后：重置到首件作品，避免指向已下架的作品
  useEffect(() => {
    setActive((current) =>
      current && runtime.artworkById(current)
        ? current
        : (runtime.artworks[0]?.id ?? null),
    );
    setNearby(null);
  }, [runtime]);
  return {
    active,
    nearby,
    select: (id: string) => {
      if (runtime.artworkById(id)) setActive(id);
    },
    /**
     * 行走位置更新。locked = 正在自动前往某件作品：
     * 此时只更新“附近”指示，不抢占选中态 —— 否则详情面板会在
     * 途经作品之间闪烁，收藏可能记到错误的作品上。
     */
    observe: (p: Point, locked = false) => {
      const id = nearbyArtwork(p, runtime.artworks);
      setNearby(id);
      if (id && !locked) setActive(id);
    },
  };
}
