import type { BattleEvent } from "./types";

export const FIGHTER_MIN_NOTIONAL = 500_000;
export const FIGHTER_PERCENTILE = 0.97;
export const TAPE_MAX_DISTANCE = 0.002;
export const RELOCATE_TAPE_COOLDOWN = 10_000;

export function fighterEligible(notional: number, percentile97: number, samples: number) {
  return samples >= 30 && notional >= FIGHTER_MIN_NOTIONAL && notional >= percentile97;
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
export function selectShot(ev: BattleEvent, now: number, lastCut: number): ShotRequest | null {
  if (now - lastCut < CUT_COOLDOWN) return null;
  if (ev.type === "phase" && ev.phase === "P5") return { kind: "cascade", at: now, until: now + 6_000 };
  if (ev.type === "sink" && ev.tier === "battleship") return { kind: "flagship", at: now, until: now + 5_000, side: ev.side, bucket: ev.b };
  if (ev.type === "liquidation") return { kind: "bomber", at: now, until: now + 2_200, side: ev.liquidated === "longs" ? "bid" : "ask" };
  if (ev.type === "fighter") {
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