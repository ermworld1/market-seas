import type { BattleEvent, BookSide, Tier } from "@/lib/market/types";
import type { Tracked } from "@/lib/battle/orderRules";
import type { ParticlePool } from "./particles";
import type { QualityTier, ShotRequest } from "@/lib/market/presentation";
import { stationDepth } from "@/lib/market/positioning";

/** World layout: Buyers/bids are -X (left), Sellers/asks are +X (right). */
export const GAP = 0.9; // half-width of the no-man's sea
export const DEPTH = 13; // row distance of a bucket 1% away
export const REAR = GAP + DEPTH + 2.2;
export const ELEVATION = 65; // degrees from horizontal

export const TIERS: Tier[] = ["patrol", "destroyer", "frigate", "cruiser", "battleship"];
export const TIER_SCALE: Record<Tier, number> = { patrol: 1.35, destroyer: 1.7, frigate: 2.25, cruiser: 3.15, battleship: 4.65 };
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
  visualWeight: number;
  lod: "high" | "low";
  introBorn: number;
  stationZ: number;
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
  frontX: 0,
  origin: 0,
  cameraX: 0,
  zoomScale: 1,
  presentation: "cinema" as "cinema" | "map",
  shot: null as ShotRequest | null,
  quality: "high" as QualityTier,
  selectedBucket: null as null | { side: BookSide; b: number },
  /** what the current first-time lesson points at */
  lessonTarget: null as null | { kind: "ship"; side: BookSide; b: number } | { kind: "plane" },
  /** world position of the most recently launched aircraft (written by Effects) */
  plane: null as Anchor | null,
  planeDir: null as null | { x: number; z: number },
  /** last big projectile for the cinema tracking shot */
  track: null as null | { side: BookSide; fx: number; fz: number; tx: number; tz: number; t0: number; dur: number },
  /** depth-of-field focus distance (0 = off) */
  focus: 0,
  /** director cuts per shot kind since load (debug) */
  cuts: {} as Record<string, number>,
  tapeTotal: 0,
  planeActive: false,
  fighterWaves: 0,
  mid: 0,
  storm: 0,
  war: false,
  time: 0,
  introStartedAt: 0,
  introSerial: 0,
  viewMode: "all" as "all" | "capital",
  filter: "all" as "all" | "1m" | "near" | "subs",
  visible: { bid: [] as Display[], ask: [] as Display[] },
  displays: new Map<string, Display>(),
  bucketVisual: new Map<string, Display>(),
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

export const sideSign = (s: BookSide) => (s === "ask" ? 1 : -1);

/** Horizontal price position, measured outwards from the moving mark-price front. */
export function xForPrice(side: BookSide, price: number) {
  const d = Math.abs(price - view.mid) / Math.max(view.mid * 0.01, 1e-9);
  return view.frontX + sideSign(side) * (GAP + 0.35 + Math.min(1.08, d) * DEPTH);
}

/** Order age is the sole source of fore/aft placement. */
export function zForStation(bornAt: number, now = Date.now()) {
  return stationDepth(bornAt, now, view.halfW * 0.86);
}

export function startFleetIntro(now = performance.now()) {
  view.introStartedAt = now;
  view.introSerial++;
  for (const display of view.displays.values()) {
    display.x = xForPrice(display.side, display.price) + sideSign(display.side) * REAR;
    display.introBorn = view.introSerial;
  }
}

export function hash01(v: number) {
  const s = Math.sin(v * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Event fallback only; visible ships use zForStation from their real resting age. */
export function zForBucket(b: number) {
  return (hash01(b * 1.73) - 0.5) * view.halfW * 0.08;
}

export function updateFront(mark: number) {
  if (!mark) return;
  if (!view.origin || Math.abs(mark - view.origin) / view.origin > 0.012) view.origin = mark;
  view.frontX = ((mark - view.origin) / Math.max(view.origin * 0.01, 1e-9)) * DEPTH;
}

let floaterId = 0;
export function addFloater(a: Anchor, text: string, tone: Floater["tone"]) {
  const list = view.anchors.floaters;
  list.push({ ...a, id: ++floaterId, text, tone, t0: view.time });
  if (list.length > 3) list.shift();
}

/** Longest gap between visible shots (ms) — exposed in ?debug=1. */
/**
 * maxGap: longest silence between visible+audible shots overall (includes quiet market);
 * maxGapActive: same, but only counting gaps while a received trade was waiting to be drawn;
 * maxLag: longest delay from trade receipt to its shot on screen.
 */
export const fireStats = { last: 0, lastWall: 0, maxGap: 0, maxGapActive: 0, maxLag: 0, recvLast: 0, maxRecvGap: 0 };
