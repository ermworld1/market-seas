import type { BookSide, Fleet, Tier, Weapon } from "./types";
import type { RollingPercentile } from "./percentile";

/** Binance aggTrade `m` = buyer is maker → taker was the seller. */
export function tradeDirection(isBuyerMaker: boolean): { shooter: Fleet; target: BookSide } {
  return isBuyerMaker ? { shooter: "bears", target: "bid" } : { shooter: "bulls", target: "ask" };
}

/** forceOrder side SELL = a long was liquidated (bombs on Bulls), BUY = short liquidated. */
export function liquidatedSide(orderSide: string): "longs" | "shorts" {
  return orderSide === "SELL" ? "longs" : "shorts";
}

export const TRADE_Q = { gun: 0.6, torpedo: 0.9, broadside: 0.99 };
export const LEVEL_Q = { frigate: 0.5, cruiser: 0.9 };

export function weaponFor(notional: number, sampler: RollingPercentile): Weapon {
  if (sampler.size < 30) return "mg";
  const r = sampler.rank(notional);
  if (r >= TRADE_Q.broadside) return "broadside";
  if (r >= TRADE_Q.torpedo) return "torpedo";
  if (r >= TRADE_Q.gun) return "gun";
  return "mg";
}

/**
 * Assign tiers to the visible levels of one side using front-wide rolling
 * percentiles. The single largest level on the side is always the battleship.
 */
export function assignTiers(
  notionals: number[],
  sampler: RollingPercentile,
): { tier: Tier; frac: number }[] {
  const q50 = sampler.quantile(LEVEL_Q.frigate);
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
  return notionals.map((n, i) => {
    if (i === maxI) return { tier: "battleship" as Tier, frac: 1 };
    if (n >= q90) return { tier: "cruiser" as Tier, frac: clamp01((n - q90) / (sMax - q90)) };
    if (n >= q50) return { tier: "frigate" as Tier, frac: clamp01((n - q50) / Math.max(1e-9, q90 - q50)) };
    return { tier: "patrol" as Tier, frac: clamp01(n / Math.max(1e-9, q50)) };
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

/** 0 = calm, 1 = full storm. Thresholds in bps per minute. */
export function seaState(volBps: number): number {
  return clamp01((volBps - 2) / 14);
}

export function countInWindow(times: number[], now: number, windowMs: number) {
  let c = 0;
  for (const t of times) if (now - t <= windowMs) c++;
  return c;
}

export const FULL_WAR_COUNT = 3;
export const FULL_WAR_WINDOW = 10_000;
export function isFullWar(liqTimes: number[], now: number) {
  return countInWindow(liqTimes, now, FULL_WAR_WINDOW) >= FULL_WAR_COUNT;
}
