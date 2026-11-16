import type { PackRoute } from "../../../shared/exchange/types";
import type { TourState } from "../../../shared/types";

export function tourRoute(
  t: TourState,
  routes: PackRoute[],
): PackRoute | undefined {
  return routes.find((r) => r.id === t.routeId);
}

export function tourTarget(t: TourState, routes: PackRoute[]): string | null {
  return tourRoute(t, routes)?.stops[t.step] || null;
}

export function tourProgress(t: TourState, routes: PackRoute[]): number {
  const r = tourRoute(t, routes);
  return r ? (t.phase === "done" ? 1 : t.step / r.stops.length) : 0;
}
