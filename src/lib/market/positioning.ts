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

export interface StationPoint { key: string; x: number; z: number; length: number; beam: number }

/** Resolve every projected hull collision only on the time axis. X is never altered. */
export function separateStationDepth(points: StationPoint[], halfDepth: number) {
  const out = new Map<string, { x: number; z: number }>();
  const placed: Array<StationPoint & { z: number }> = [];
  const ordered = [...points].sort((a, b) => b.z - a.z || a.x - b.x || a.key.localeCompare(b.key));
  const collides = (point: StationPoint, z: number) => placed.some((other) => {
    const xClearance = (point.length + other.length) * 0.52;
    const zClearance = (point.beam + other.beam) * 0.72 + 0.08;
    return Math.abs(point.x - other.x) < xClearance && Math.abs(z - other.z) < zClearance;
  });
  for (const point of ordered) {
    const target = Math.max(-halfDepth, Math.min(point.z, halfDepth));
    let z = target;
    // Search both depth directions around the data-derived target. X is exact;
    // only the minimum depth displacement needed to clear another hull is used.
    if (collides(point, z)) {
      const step = Math.max(0.18, point.beam * 0.32);
      for (let ring = 1; ring <= Math.ceil((halfDepth * 2) / step); ring++) {
        const towardRear = target - ring * step;
        const towardCamera = target + ring * step;
        if (towardRear >= -halfDepth && !collides(point, towardRear)) { z = towardRear; break; }
        if (towardCamera <= halfDepth && !collides(point, towardCamera)) { z = towardCamera; break; }
      }
    }
    const placedPoint = { ...point, z };
    placed.push(placedPoint);
    out.set(point.key, { x: point.x, z });
  }
  return out;
}
