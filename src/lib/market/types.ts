import type { OrderEvent } from "@/lib/battle/orderRules";
import type { Phase } from "@/lib/battle/phase";

export const SYMBOL = "BTCUSDT";

/** bid = Buyers fleet (south), ask = Sellers fleet (north) */
export type BookSide = "bid" | "ask";
export type Fleet = "buyers" | "sellers";
export type Tier = "patrol" | "destroyer" | "frigate" | "cruiser" | "battleship";
export type Weapon = "mg" | "gun" | "torpedo" | "broadside";
export type StreamStatus = "connecting" | "live" | "unavailable";

export const sideFleet = (s: BookSide): Fleet => (s === "bid" ? "buyers" : "sellers");
export const fleetSide = (f: Fleet): BookSide => (f === "buyers" ? "bid" : "ask");
export const FLEET_NAME: Record<BookSide, string> = { bid: "Buyers", ask: "Sellers" };

export type BattleEvent =
  | OrderEvent
  | {
      type: "fire";
      t: number;
      /** taker side: buy fires north at asks, sell fires south at bids */
      taker: "buy" | "sell";
      target: BookSide;
      b: number;
      price: number;
      qty: number;
      notional: number;
      fills: number;
      weapon: Weapon;
      id: number;
    }
  | { type: "order"; t: number; taker: "buy" | "sell"; notional: number; qty: number; fills: number; avg: number; buckets: number[] }
  | { type: "fighter"; t: number; taker: "buy" | "sell"; target: BookSide; notional: number; buckets: number[] }
  | { type: "liquidation"; t: number; liquidated: "longs" | "shorts"; price: number; qty: number; notional: number }
  | { type: "phase"; t: number; phase: Phase | "P0"; oneShot: boolean; detail?: "push" | "fall back" };

export type ConvoyState = "none" | "in-buyers" | "in-sellers" | "out";
