import type { Fleet, Tier, Weapon } from "./types";
import type { RollingPercentile } from "./percentile";

/** Binance aggTrade `m` = buyer is maker → taker was the seller. */
export function tradeDirection(isBuyerMaker: boolean): { taker: "buy" | "sell"; shooter: Fleet; target: "bid" | "ask" } {
  return isBuyerMaker ? { taker: "sell", shooter: "sellers", target: "bid" } : { taker: "buy", shooter: "buyers", target: "ask" };
}

/** forceOrder side SELL = a long was liquidated, BUY = a short was liquidated. */
export function liquidatedSide(orderSide: string): "longs" | "shorts" {
  return orderSide === "SELL" ? "longs" : "shorts";
}

export const TRADE_Q = { gun: 0.6, torpedo: 0.9, broadside: 0.99 };
export const LEVEL_Q = { destroyer: 0.4, frigate: 0.7, cruiser: 0.9 };
export const FIGHTER_Q = 0.97;

export function weaponFor(notional: number, sampler: RollingPercentile): Weapon {
  if (sampler.size < 30) return "mg";
  const r = sampler.rank(notional);
  if (r >= TRADE_Q.broadside) return "broadside";
  if (r >= TRADE_Q.torpedo) return "torpedo";
  if (r >= TRADE_Q.gun) return "gun";
  return "mg";
}

/** Tiers from rolling bucket-notional percentiles; the single largest bucket per side is the battleship. */
export function assignTiers(notionals: number[], sampler: RollingPercentile): { tier: Tier; frac: number }[] {
  const q40 = sampler.quantile(LEVEL_Q.destroyer);
  const q70 = sampler.quantile(LEVEL_Q.frigate);
  const q90 = sampler.quantile(LEVEL_Q.cruiser);
  let maxI = -1;
  let max = -Infinity;
  notionals.forEach((n, i) => {
    if (n > max) {
      max = n;
      maxI = i;
    }
  });
  const sMax = Math.max(sampler.quantile(1), max, q90 + 1e-9);
  const f = (n: number, lo: number, hi: number) => clamp01((n - lo) / Math.max(1e-9, hi - lo));
  return notionals.map((n, i) => {
    if (i === maxI) return { tier: "battleship" as Tier, frac: 1 };
    if (n >= q90) return { tier: "cruiser" as Tier, frac: f(n, q90, sMax) };
    if (n >= q70) return { tier: "frigate" as Tier, frac: f(n, q70, q90) };
    if (n >= q40) return { tier: "destroyer" as Tier, frac: f(n, q40, q70) };
    return { tier: "patrol" as Tier, frac: f(n, 0, q40) };
  });
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Std-dev of 1-minute log returns, in basis points. */
export function realizedVolBps(closes: number[]): number {
  if (closes.length < 3) return 0;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i]! / closes[i - 1]!));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * 1e4;
}

/** 0 = calm, 1 = full storm. */
export function seaState(volBps: number): number {
  return clamp01((volBps - 2) / 14);
}

export function countInWindow(times: number[], now: number, windowMs: number) {
  let c = 0;
  for (const t of times) if (now - t <= windowMs) c++;
  return c;
}

export function fillsOf(f?: number, l?: number) {
  if (f === undefined || l === undefined) return 1;
  return Math.max(1, l - f + 1);
}
export const MAX_TRACERS = 24;
export function tracersFor(fills: number) {
  return Math.min(MAX_TRACERS, Math.max(1, fills));
}

export type Regime = "LONGS CHARGING" | "SHORTS RETREATING" | "SHORTS CHARGING" | "LONGS RETREATING" | null;
/** The only place longs/shorts are named: derived from price direction + OI change. */
export function regimeOf(priceChangePct: number, oiChangePct: number, minOi = 0.05): Regime {
  if (Math.abs(oiChangePct) < minOi || priceChangePct === 0) return null;
  if (priceChangePct > 0) return oiChangePct > 0 ? "LONGS CHARGING" : "SHORTS RETREATING";
  return oiChangePct > 0 ? "SHORTS CHARGING" : "LONGS RETREATING";
}
