/**
 * "Ask the map": the plain-English read-out for whatever the pointer is over.
 * Pure — it takes numbers that already came from the live book and returns copy.
 * No React, no three, no sockets: everything here is unit-testable.
 */
import { LEVEL_Q } from "./rules";
import { fmtPrice, usd } from "./predictions";
import { FLEET_NAME, type BookSide, type Tier } from "./types";

export type AskKind = "ship" | "water" | "line";

/** The live facts of the ship under the pointer. */
export interface AskShip {
  tier: Tier;
  notional: number;
  qty: number;
  bornAt: number;
  /** price buckets this one ship stands for */
  members: number;
}
export interface AskStats {
  hits: number;
  filled: number;
  pulls: number;
}
export interface AskInput {
  kind: AskKind;
  side: BookSide;
  /** price at the pointer (or the ship's inner edge) */
  price: number;
  /** bucket width in price units */
  width: number;
  /** last traded price: the line in the middle of the sea */
  mark: number;
  now: number;
  ship?: AskShip | null;
  stats?: AskStats | null;
}
export interface AskRow {
  k: string;
  v: string;
}
export interface AskCard {
  tone: "buy" | "sell" | "info";
  title: string;
  rows: AskRow[];
  note: string;
}

/** How long something has been resting, e.g. "12s" or "4m 20s". */
export function ago(ms: number) {
  if (ms < 1_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Size-class wording read straight from the tier percentiles in rules.ts. */
export function sizeClass(tier: Tier): string {
  const d = Math.round(LEVEL_Q.destroyer * 100);
  const f = Math.round(LEVEL_Q.frigate * 100);
  const c = Math.round(LEVEL_Q.cruiser * 100);
  switch (tier) {
    case "patrol":
      return `smallest ${d}% of resting liquidity this side`;
    case "destroyer":
      return `${d}–${f}% of it`;
    case "frigate":
      return `${f}–${c}% of it`;
    case "cruiser":
      return `top ${100 - c}% of it`;
    case "battleship":
      return "the largest single wall this side";
  }
}

const awayPct = (price: number, mark: number) => (mark > 0 ? (Math.abs(price - mark) / mark) * 100 : 0);
const fmtAway = (n: number) => `${n.toFixed(3)}%`;
const sideWord = (s: BookSide) => (s === "bid" ? "buy" : "sell");

/** The price window a ship stands for (a ship can hold several neighbouring buckets). */
function priceRange(i: AskInput) {
  const span = Math.max(i.width, i.width * (i.ship?.members ?? 1));
  return i.width > 0 ? `${fmtPrice(i.price)}–${fmtPrice(i.price + span)}` : fmtPrice(i.price);
}

export function askCard(i: AskInput): AskCard {
  const fleet = FLEET_NAME[i.side];
  const tone: AskCard["tone"] = i.side === "bid" ? "buy" : "sell";

  if (i.kind === "line") {
    return {
      tone: "info",
      title: "The price line",
      rows: [{ k: "Last traded", v: fmtPrice(i.mark) }],
      note: "The buoyed line is the last traded BTC price on Binance Futures. It slides right when buyers push it up, left when sellers push it down.",
    };
  }

  if (i.kind === "water" || !i.ship) {
    return {
      tone,
      title: `${fleet}' water`,
      rows: [
        { k: "Price here", v: fmtPrice(i.price) },
        { k: "Away from the line", v: fmtAway(awayPct(i.price, i.mark)) },
        { k: "Resting liquidity", v: "none showing" },
      ],
      note: `No ${sideWord(i.side)} orders are showing at this price right now. If a trade prints here it lands as a splash, and a ship appears where the liquidity rests.`,
    };
  }

  const s = i.ship;
  const rows: AskRow[] = [
    { k: "Resting liquidity", v: `${usd(s.notional)} · ${s.qty.toFixed(3)} BTC` },
    { k: "Price range", v: priceRange(i) },
    { k: "Size class", v: sizeClass(s.tier) },
    { k: "Resting for", v: ago(i.now - s.bornAt) },
    { k: "Trades at this price", v: `${i.stats?.hits ?? 0} · ${usd(i.stats?.filled ?? 0)} filled` },
    { k: "Liquidity pulled here", v: `${i.stats?.pulls ?? 0}×` },
  ];
  const merged = s.members > 1 ? ` This ship shows ${s.members} neighbouring price buckets together.` : "";
  return {
    tone,
    title: `${fleet}' ship`,
    rows,
    note: `Many separate ${sideWord(i.side)} orders resting at this price on Binance — not one order.${merged} Further back = resting longer; bigger hull = more money.`,
  };
}
