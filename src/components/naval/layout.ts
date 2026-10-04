import type { BattleEvent, BookSide, Tier } from "@/lib/market/types";
import type { Tracked } from "@/lib/battle/orderRules";
import type { ParticlePool } from "./particles";

/** World layout: -Z is north (Sellers/asks), +Z is south (Buyers/bids). */
export const GAP = 0.9; // half-width of the no-man's sea
export const DEPTH = 13; // row distance of a bucket 1% away
export const REAR = GAP + DEPTH + 2.2;
export const ELEVATION = 65; // degrees from horizontal

export const TIERS: Tier[] = ["patrol", "destroyer", "frigate", "cruiser", "battleship"];
export const TIER_SCALE: Record<Tier, number> = { patrol: 0.75, destroyer: 0.95, frigate: 1.15, cruiser: 1.65, battleship: 2.5 };
export const CAPITAL: Tier[] = ["cruiser", "battleship"];

export type DepartKind = "sink" | "dive" | "fled" | "pulled" | "drop";

export interface Display {
  key: string;
  side: BookSide;
  b: number;
  price: number;
  x: number;
  z: number;
  y: number;
  s: number;
  tier: Tier;
  ship: Tracked | null;
  departing: null | { kind: DepartKind; t0: number };
  surfacing: number; // >0 while rising from below (relocate / hidden)
  smoke: number; // smoke-screen timer
  hitFlash: number;
  damage: number;
  roll: number;
  pitch: number;
  fade: number;
}

export interface Anchor {
  x: number;
  y: number;
  z: number;
}
export interface Floater extends Anchor {
  id: number;
  text: string;
  tone: "buy" | "sell" | "ok" | "sub";
  t0: number;
}

export const view = {
  mobile: false,
  cap: 120,
  halfW: 8,
  offsetX: 0,
  mid: 0,
  storm: 0,
  war: false,
  time: 0,
  viewMode: "all" as "all" | "capital",
  filter: "all" as "all" | "1m" | "near" | "subs",
  visible: { bid: [] as Display[], ask: [] as Display[] },
  displays: new Map<string, Display>(),
  frameEvents: [] as BattleEvent[],
  fx: { glow: null as ParticlePool | null, smoke: null as ParticlePool | null },
  sinkPulse: 0,
  frameMs: 16,
  anchors: {
    flag: { bid: null as Anchor | null, ask: null as Anchor | null },
    near: null as Anchor | null,
    repairs: [] as Anchor[],
    floaters: [] as Floater[],
  },
};

export const sideSign = (s: BookSide) => (s === "ask" ? -1 : 1);

export function zFor(side: BookSide, price: number) {
  const d = Math.abs(price - view.mid) / Math.max(view.mid * 0.01, 1e-9);
  return sideSign(side) * (GAP + 0.35 + Math.min(1.08, d) * DEPTH);
}

export function hash01(v: number) {
  const s = Math.sin(v * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Deterministic horizontal slot per bucket so a ship keeps its lane. */
export function xFor(b: number) {
  return ((hash01(b * 0.731) * 2 - 1) * 0.9 + (hash01(b) - 0.5) * 0.08) * view.halfW + view.offsetX;
}

let floaterId = 0;
export function addFloater(a: Anchor, text: string, tone: Floater["tone"]) {
  const list = view.anchors.floaters;
  list.push({ ...a, id: ++floaterId, text, tone, t0: view.time });
  if (list.length > 10) list.shift();
}
