import { useEffect, useRef } from "react";
import { useWalker, distance, viewingPoint } from "../features/space";
import { useCatalog } from "../features/catalog";
import { useNarration } from "../features/narration";
import { useTour } from "../features/tours";
import { useCollection } from "../features/collection";
import { useServices } from "../features/exhibition/ServicesProvider";

export function useGallery() {
  const { runtime } = useServices();
  const catalog = useCatalog();
  const tour = useTour();
  const collection = useCollection();
  const walker = useWalker(runtime.space, (p, walking) =>
    catalog.observe(p, walking),
  );
  const narration = useNarration(() => {
    if (tour.state.phase === "listening") tour.next();
  });
  const go = (id: string) => {
    const a = runtime.artworkById(id);
    if (a) {
      catalog.select(id);
      walker.go(viewingPoint(a.position, a.facing));
      walker.yaw.current = a.facing;
    }
  };
  useEffect(() => {
    if (tour.state.phase === "walking" && tour.target) go(tour.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.state.phase, tour.target]);
  useEffect(() => {
    if (tour.state.phase !== "walking" || !tour.target) return;
    const a = runtime.artworkById(tour.target);
    if (!a) return;
    if (distance(walker.position, viewingPoint(a.position, a.facing)) < 0.15) {
      tour.arrive();
      narration.play(a.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walker.position, tour.state.phase, tour.target]);
  const current = useRef({ nearby: catalog.nearby, record: collection.record });
  current.current = { nearby: catalog.nearby, record: collection.record };
  useEffect(() => {
    const t = setInterval(() => {
      if (current.current.nearby)
        current.current.record(current.current.nearby, 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return {
    catalog,
    tour,
    collection,
    walker,
    narration,
    go,
    pauseTour: () => {
      tour.pause();
      walker.stop();
      narration.pause();
    },
    stopTour: () => {
      tour.stop();
      walker.stop();
      narration.pause();
    },
    nextTour: () => {
      walker.stop();
      narration.pause();
      tour.next();
    },
  };
}
