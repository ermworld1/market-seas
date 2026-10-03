import type { BattleEvent, BookSide, Level, Tier } from "@/lib/market/types";
import type { ParticlePool } from "./particles";

/** World layout: -Z is north (Bears/asks), +Z is south (Bulls/bids). */
export const GAP = 1.1; // half-width of the no-man's sea
export const DEPTH = 13; // max row distance from the strait
export const REAR = GAP + DEPTH + 3.2;

export const TIERS: Tier[] = ["patrol", "frigate", "cruiser", "battleship"];
export const TIER_SCALE: Record<Tier, number> = { patrol: 1.35, frigate: 1.9, cruiser: 2.6, battleship: 3.5 };

export interface Display {
  key: string;
  side: BookSide;
  price: number;
  x: number;
  z: number;
  y: number;
  s: number;
  tier: Tier;
  level: Level | null;
  departing: null | { kind: "sink" | "ghost" | "pulled" | "drop"; t0: number };
  hitFlash: number;
  roll: number;
  pitch: number;
  fade: number; // 0 = normal colour, 1 = fog grey
}

export const view = {
  mobile: false,
  cap: 20,
  halfW: 8,
  mid: 0,
  range: 1,
  storm: 0,
  war: false,
  time: 0,
  visible: { bid: [] as Display[], ask: [] as Display[] },
  displays: new Map<string, Display>(),
  frameEvents: [] as BattleEvent[],
  fx: { glow: null as ParticlePool | null, smoke: null as ParticlePool | null },
  sinkPulse: 0,
};

export const sideSign = (s: BookSide) => (s === "ask" ? -1 : 1);

export function zFor(side: BookSide, price: number) {
  const d = Math.abs(price - view.mid) / Math.max(view.range, 1e-9);
  return sideSign(side) * (GAP + 0.6 + Math.min(1.15, d) * DEPTH);
}

export function hash01(v: number) {
  const s = Math.sin(v * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function xFor(price: number, index: number) {
  const pattern = [-0.62, 0.38, -0.12, 0.78, -0.86, 0.1, 0.55, -0.4];
  return (pattern[index % pattern.length]! + (hash01(price) - 0.5) * 0.32) * view.halfW;
}

export function shipLength(d: Display) {
  return d.s;
}
