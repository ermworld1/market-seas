export const BATTLE_MS = 5 * 60_000;
export type Winner = "buyers" | "sellers" | "draw";

/** Battles are aligned to UTC 5-minute boundaries so every viewer shares one clock. */
export function battleWindow(now: number) {
  const start = Math.floor(now / BATTLE_MS) * BATTLE_MS;
  return { id: start, start, end: start + BATTLE_MS };
}

/** Buyers win if they pushed mark price up toward the Sellers fleet, and vice versa. */
export function battleWinner(startMark: number, endMark: number, eps = 1e-9): Winner {
  if (!(startMark > 0) || !(endMark > 0)) return "draw";
  const d = (endMark - startMark) / startMark;
  if (d > eps) return "buyers";
  if (d < -eps) return "sellers";
  return "draw";
}

export interface Scoreboard {
  day: string;
  buyers: number;
  sellers: number;
  draws: number;
  last: number;
}
export function utcDay(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}
export function recordResult(sb: Scoreboard | null, w: Winner, battleId: number): Scoreboard {
  const day = utcDay(battleId);
  const cur = sb && sb.day === day ? { ...sb } : { day, buyers: 0, sellers: 0, draws: 0, last: -1 };
  if (cur.last === battleId) return cur;
  cur.last = battleId;
  if (w === "buyers") cur.buyers++;
  else if (w === "sellers") cur.sellers++;
  else cur.draws++;
  return cur;
}

/** Flagship question resolution from events observed on that bucket. */
export type FlagOutcome = "sunk" | "dive" | "hold";
export function flagshipOutcome(events: { type: string; b: number; side: string }[], side: string, b: number): FlagOutcome {
  let out: FlagOutcome = "hold";
  for (const e of events) {
    if (e.side !== side || e.b !== b) continue;
    if (e.type === "sink") return "sunk";
    if (e.type === "dive" || e.type === "fled" || e.type === "pulled") out = "dive";
  }
  return out;
}
