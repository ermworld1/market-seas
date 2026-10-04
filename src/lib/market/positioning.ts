import type { Tier } from "./types";

export const STATION_MAX_MS = 30 * 60_000;
export const INTRO_MS = 3_000;

/** New orders start at the fleet's far lane; resting orders approach the camera on a logarithmic clock. */
export function stationDepth(bornAt: number, now: number, halfDepth: number) {
  const age = Math.max(0, Math.min(STATION_MAX_MS, now - bornAt));
  const progress = Math.log1p(age / 1000) / Math.log1p(STATION_MAX_MS / 1000);
  return -halfDepth + progress * halfDepth * 2;
}

const INTRO_DELAY: Record<Tier, number> = {
  battleship: 0,
  cruiser: 320,
  destroyer: 640,
  frigate: 640,
  patrol: 960,
};

export function introProgress(tier: Tier, elapsedMs: number) {
  const delay = INTRO_DELAY[tier];
  const duration = INTRO_MS - delay;
  const u = Math.max(0, Math.min(1, (elapsedMs - delay) / duration));
  return 1 - Math.pow(1 - u, 3);
}

export function introArrived(tier: Tier, elapsedMs: number) {
  return introProgress(tier, elapsedMs) >= 0.999;
}

export interface StationPoint { key: string; x: number; z: number; radius: number }

/** Resolve overlap only on the time axis. X is copied exactly and never altered. */
export function separateStationDepth(points: StationPoint[], halfDepth: number) {
  const byX = new Map<number, StationPoint[]>();
  for (const point of points) {
    const key = Math.round(point.x * 10_000);
    const group = byX.get(key) ?? [];
    group.push({ ...point });
    byX.set(key, group);
  }
  const out = new Map<string, { x: number; z: number }>();
  for (const group of byX.values()) {
    group.sort((a, b) => b.z - a.z || a.key.localeCompare(b.key));
    let previous = Number.POSITIVE_INFINITY;
    for (const point of group) {
      const clearance = point.radius * 0.7;
      const z = Math.max(-halfDepth, Math.min(point.z, previous - clearance));
      out.set(point.key, { x: point.x, z });
      previous = z;
    }
  }
  return out;
}
