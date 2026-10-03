export type MarketSymbol = "BTCUSDT" | "ETHUSDT" | "BNBUSDT";
export const FRONTS: MarketSymbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

/** bid = Bulls fleet (south), ask = Bears fleet (north) */
export type BookSide = "bid" | "ask";
export type Fleet = "bulls" | "bears";
export type Tier = "patrol" | "frigate" | "cruiser" | "battleship";
export type Weapon = "mg" | "gun" | "torpedo" | "broadside";
export type StreamStatus = "connecting" | "live" | "unavailable";

export const sideFleet = (s: BookSide): Fleet => (s === "bid" ? "bulls" : "bears");
export const fleetSide = (f: Fleet): BookSide => (f === "bulls" ? "bid" : "ask");

export interface Level {
  price: number;
  qty: number;
  notional: number;
  tier: Tier;
  /** 0..1 position inside its tier, drives smooth scale */
  tierFrac: number;
  /** 0..0.95 accumulated damage from fills */
  damage: number;
  /** epoch ms until which repair sparks are shown */
  repairUntil: number;
  refills: number[];
}

export type BattleEvent =
  | {
      type: "fire";
      t: number;
      shooter: Fleet;
      target: BookSide;
      price: number;
      qty: number;
      notional: number;
      weapon: Weapon;
      /** filled qty / resting level qty, 0..1 (0 when the level is not visible) */
      hitFrac: number;
    }
  | { type: "sink"; t: number; side: BookSide; price: number; tier: Tier }
  | { type: "ghost"; t: number; side: BookSide; price: number; tier: Tier }
  | { type: "pulled"; t: number; side: BookSide; price: number; tier: Tier }
  | { type: "repair"; t: number; side: BookSide; price: number }
  | { type: "liquidation"; t: number; liquidated: "longs" | "shorts"; price: number; qty: number; notional: number };

export type ConvoyState = "none" | "in-bulls" | "in-bears" | "out";
