import type { BattleEvent } from "./types";

export const FIGHTER_MIN_NOTIONAL = 200_000;
export const FIGHTER_SWEEP_LEVELS = 3;
export const FIGHTER_WAVE_COOLDOWN = 3_000;
export const TAPE_MAX_DISTANCE = 0.002;
export const RELOCATE_TAPE_COOLDOWN = 10_000;

export function fighterEligible(notional: number, levels: number) {
  return notional >= FIGHTER_MIN_NOTIONAL || levels >= FIGHTER_SWEEP_LEVELS;
}

export function fighterFormationSize(notional: number) {
  return notional >= 1_000_000 ? 4 : notional >= 500_000 ? 3 : 2;
}

export function tapeEligible(ev: BattleEvent, mark: number, p90: number) {
  if (!("price" in ev) || !("notional" in ev) || mark <= 0) return false;
  if (!new Set(["reinforce", "dive", "fled", "relocate", "hidden", "repair"]).has(ev.type)) return false;
  return Math.abs(ev.price - mark) / mark <= TAPE_MAX_DISTANCE && ev.notional >= p90;
}

export function canNarrateRelocate(now: number, last: number) {
  return now - last >= RELOCATE_TAPE_COOLDOWN;
}

export type LessonKind = "shot" | "sink" | "dive" | "fighter" | "bomber" | "reinforce";
export const LESSON_KINDS: LessonKind[] = ["shot", "sink", "dive", "fighter", "bomber", "reinforce"];
export function lessonForEvent(ev: BattleEvent): LessonKind | null {
  if (ev.type === "fire") return "shot";
  if (ev.type === "sink") return "sink";
  if (ev.type === "dive" || ev.type === "fled") return "dive";
  if (ev.type === "fighter") return "fighter";
  if (ev.type === "liquidation") return "bomber";
  if (ev.type === "reinforce") return "reinforce";
  return null;
}

export type ShotKind = "wide" | "trade" | "broadside" | "fighter" | "bomber" | "cascade" | "flagship";
export interface ShotRequest { kind: ShotKind; at: number; until: number; side?: "bid" | "ask"; bucket?: number }
export const CUT_COOLDOWN = 2_500;
export const WIDE_RETURN = 6_000;
export const CASCADE_LOCK_MS = 10_000;
/**
 * Director shot selection. The P5 cascade bypasses the cut cooldown and, while active,
 * locks the director: nothing but a flagship sinking can take the camera from it.
 */
export function selectShot(ev: BattleEvent, now: number, lastCut: number, active?: ShotRequest | null): ShotRequest | null {
  if (ev.type === "phase" && ev.phase === "P5") return { kind: "cascade", at: now, until: now + CASCADE_LOCK_MS };
  const locked = active?.kind === "cascade" && now < active.until;
  if (locked && !(ev.type === "sink" && ev.tier === "battleship")) return null;
  if (!locked && now - lastCut < CUT_COOLDOWN) return null;
  if (ev.type === "sink" && ev.tier === "battleship") return { kind: "flagship", at: now, until: now + 5_000, side: ev.side, bucket: ev.b };
  if (ev.type === "liquidation") return { kind: "bomber", at: now, until: now + 2_200, side: ev.liquidated === "longs" ? "bid" : "ask" };
  if (ev.type === "fighter") {
    if (ev.notional < 500_000) return null;
    const bucket = ev.buckets[0];
    return bucket === undefined ? { kind: "fighter", at: now, until: now + 2_500, side: ev.target } : { kind: "fighter", at: now, until: now + 2_500, side: ev.target, bucket };
  }
  if (ev.type === "fire" && ev.weapon === "broadside") return { kind: "broadside", at: now, until: now + 3_200, side: ev.target, bucket: ev.b };
  if (ev.type === "fire" && ev.notional >= 250_000) return { kind: "trade", at: now, until: now + 2_800, side: ev.target, bucket: ev.b };
  return null;
}

export type QualityTier = "low" | "medium" | "high";
export function nextQuality(current: QualityTier, frameMs: number, slowSamples: number, fastSamples: number): QualityTier {
  if (slowSamples >= 30 && frameMs > (current === "high" ? 19 : 27)) return current === "high" ? "medium" : "low";
  if (fastSamples >= 180 && frameMs < (current === "low" ? 21 : 16)) return current === "low" ? "medium" : "high";
  return current;
}
const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
const px = (n: number) => Math.round(n).toLocaleString("en-US");
const fleetOf = (s: "bid" | "ask") => (s === "bid" ? "Buyers'" : "Sellers'");

/** One plain-English sentence per lesson, built only from the real event's numbers. */
export function lessonText(ev: BattleEvent): string | null {
  switch (ev.type) {
    case "fire":
      return `A real ${money(ev.notional)} ${ev.taker} order just traded against the ${fleetOf(ev.target)} ship at ${px(ev.price)} — every trade is a shot.`;
    case "sink":
      return `The ${fleetOf(ev.side)} ${money(ev.notional)} order at ${px(ev.price)} was fully traded, so that ship sank and the price line moved.`;
    case "dive":
      return `The ${fleetOf(ev.side)} ${money(ev.notional)} order at ${px(ev.price)} was cancelled before trades reached it — the ship dove like a submarine.`;
    case "fled":
      return `The ${fleetOf(ev.side)} ${money(ev.notional)} order at ${px(ev.price)} was pulled just as price came close — that ship fled.`;
    case "fighter":
      return `One taker ${ev.taker === "buy" ? "bought" : "sold"} ${money(ev.notional)} in a single order across ${ev.buckets.length} price level${ev.buckets.length === 1 ? "" : "s"} — that is a fighter strafing run.`;
    case "liquidation":
      return `Binance force-closed ${money(ev.notional)} of ${ev.liquidated} at ${px(ev.price)} — liquidations arrive as bombers.`;
    case "reinforce":
      return `Someone added ${money(ev.notional)} of ${ev.side === "bid" ? "buy" : "sell"} orders at ${px(ev.price)} — the ${fleetOf(ev.side)} ship there was reinforced.`;
    default:
      return null;
  }
}
