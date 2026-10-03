import type { BattleEvent, BookSide } from "./types";

export type QuestionKind = "hold" | "water" | "storm";
export const ROTATION: QuestionKind[] = ["hold", "water", "storm"];
export const DURATION: Record<QuestionKind, number> = { hold: 60_000, water: 60_000, storm: 300_000 };

export interface Round {
  id: number;
  kind: QuestionKind;
  startedAt: number;
  endsAt: number;
  /** hold */
  side?: BookSide;
  price?: number;
  startMark?: number;
  startVol?: number;
  failed?: boolean;
  choice?: "a" | "b";
}

/** Option "a" = YES / Bulls, "b" = NO / Bears */
export function questionText(r: Round): { q: string; a: string; b: string } {
  if (r.kind === "hold")
    return {
      q: `Will ${r.side === "bid" ? "Bulls" : "Bears"} Battleship ${fmtPrice(r.price ?? 0)} hold for the next 60s?`,
      a: "Yes, holds",
      b: "No, falls",
    };
  if (r.kind === "water") return { q: "Which fleet gains water in the next minute?", a: "Bulls", b: "Bears" };
  return { q: "Will a storm hit in the next 5 minutes?", a: "Yes, storm", b: "No, calm" };
}

/** Hold fails when the battleship level is consumed (sink) or pulled (ghost/pulled). */
export function holdBroken(e: BattleEvent, side: BookSide, price: number) {
  return (e.type === "sink" || e.type === "ghost" || e.type === "pulled") && e.side === side && e.price === price;
}

export function resolveWater(startMark: number, endMark: number): "a" | "b" | null {
  if (endMark > startMark) return "a";
  if (endMark < startMark) return "b";
  return null;
}

export function resolveStorm(startVol: number, endVol: number): "a" | "b" {
  return endVol > startVol ? "a" : "b";
}

export function resolveHold(failed: boolean): "a" | "b" {
  return failed ? "b" : "a";
}

export function xpFor(streak: number) {
  return 10 + Math.min(streak, 10) * 2;
}

export function fmtPrice(p: number) {
  const d = p >= 1000 ? 1 : p >= 100 ? 2 : 3;
  return p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
}
