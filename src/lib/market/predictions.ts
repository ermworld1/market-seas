import type { BookSide } from "./types";

export type Choice = "buyers" | "sellers" | "sunk" | "dive" | "hold";
export interface Round {
  id: number;
  kind: "winner" | "flagship";
  startedAt: number;
  endsAt: number;
  /** winner: the battle id it belongs to; picks lock after `lockAt` */
  battleId?: number;
  lockAt?: number;
  side?: BookSide;
  b?: number;
  price?: number;
  outcome?: "sunk" | "dive" | "hold";
  choice?: Choice;
}

export const FLAG_ROUND_MS = 60_000;
export const PICK_WINDOW_MS = 60_000;

export function questionText(r: Round): { q: string; options: { id: Choice; label: string }[] } {
  if (r.kind === "winner")
    return {
      q: "Who wins this 5-minute battle?",
      options: [
        { id: "buyers", label: "Buyers" },
        { id: "sellers", label: "Sellers" },
      ],
    };
  const name = r.side === "bid" ? "Buyers'" : "Sellers'";
  return {
    q: `Will the ${name} flagship ${fmtPrice(r.price ?? 0)} be sunk, dive, or hold in the next 60s?`,
    options: [
      { id: "sunk", label: "Sunk" },
      { id: "dive", label: "Dive" },
      { id: "hold", label: "Hold" },
    ],
  };
}

export function xpFor(streak: number) {
  return 10 + Math.min(streak, 10) * 2;
}

export function fmtPrice(p: number) {
  const d = p >= 1000 ? 1 : p >= 100 ? 2 : 3;
  return p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
}
export function usd(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `$${n.toFixed(0)}`;
}
