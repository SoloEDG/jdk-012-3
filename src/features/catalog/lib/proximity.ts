import type { Point } from "../../../shared/types";

export function nearbyArtwork(
  p: Point,
  artworks: { id: string; position: Point }[],
): string | null {
  let best: string | null = null;
  let d = 3.1;
  for (const a of artworks) {
    const next = Math.hypot(a.position.x - p.x, a.position.z - p.z);
    if (next < d) {
      best = a.id;
      d = next;
    }
  }
  return best;
}
