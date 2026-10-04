// Pure settlement rules — no I/O, unit-tested.
export const XP_BASE = { winner: 10, flagship: 15 } as const;
export const STREAK_STEP_XP = 5;
export const STREAK_BONUS_CAP = 25;
/** Flagship rounds settled later than this after ends_at are void: the live depth no longer reflects the round end. */
export const FLAGSHIP_MAX_SETTLE_LAG_MS = 6 * 60_000;

export type Kind = keyof typeof XP_BASE;

export function winnerOutcome(startMark: number, endMark: number): "buyers" | "sellers" | "draw" {
  if (endMark > startMark) return "buyers";
  if (endMark < startMark) return "sellers";
  return "draw";
}

/**
 * Approximation (documented): the server cannot read a historical order book, so a
 * flagship round compares the depth snapshot taken when the pick was locked (start_size)
 * with a snapshot taken at settlement (≤6 min after the round end).
 * - remaining ≤ 10% of start and price traded through the bucket → "sunk"
 * - remaining ≤ 10% of start without the price touching it → "dive" (pulled)
 * - otherwise → "hold"
 */
export function flagshipOutcome(startSize: number, endSize: number, low: number, high: number, bucketLo: number, bucketHi: number): "sunk" | "dive" | "hold" {
  const gone = startSize > 0 && endSize <= startSize * 0.1;
  if (!gone) return "hold";
  const touched = low <= bucketHi && high >= bucketLo;
  return touched ? "sunk" : "dive";
}

/** Consecutive correct predictions at the end of an ordered (oldest→newest) list of settled results. */
export function currentStreak(results: (boolean | null)[]): number {
  let n = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r === null) continue; // void rounds neither extend nor break a streak
    if (!r) break;
    n++;
  }
  return n;
}

/** XP for one prediction; priorStreak = streak before this result. */
export function xpFor(kind: Kind, correct: boolean | null, priorStreak: number): number {
  if (!correct) return 0;
  return XP_BASE[kind] + Math.min(STREAK_BONUS_CAP, STREAK_STEP_XP * Math.max(0, priorStreak));
}
