import type { BookSide } from "@/lib/market/types";

export const BUCKET_FRAC = 0.0001; // 0.01% of mark
export const RANGE_FRAC = 0.01; // ±1%

export interface Bucket {
  side: BookSide;
  /** distance index from the reference price: 0 = touching, 99 = 1% away */
  idx: number;
  /** representative (inner edge) price */
  price: number;
  qty: number;
  notional: number;
}

/** Bucket width in price units for a given reference price. Fixed per session to keep keys stable. */
export function bucketWidth(ref: number) {
  return ref * BUCKET_FRAC;
}

/** Absolute bucket number for a price: stable as mark moves. */
export function bucketOf(price: number, width: number) {
  return Math.floor(price / width);
}

/**
 * Aggregate one side of a book into buckets within ±RANGE_FRAC of mark.
 * Keyed by absolute bucket number so a bucket keeps its identity as price moves.
 */
export function bucketize(side: BookSide, levels: Map<number, number> | [number, number][], mark: number, width: number): Map<number, Bucket> {
  const out = new Map<number, Bucket>();
  if (!(mark > 0) || !(width > 0)) return out;
  const lo = mark * (1 - RANGE_FRAC);
  const hi = mark * (1 + RANGE_FRAC);
  const markB = bucketOf(mark, width);
  for (const [p, q] of levels) {
    if (!(q > 0) || p < lo || p > hi) continue;
    if (side === "bid" ? p > mark * 1.0005 : p < mark * 0.9995) continue;
    const b = bucketOf(p, width);
    let k = out.get(b);
    if (!k) {
      k = { side, idx: Math.abs(b - markB), price: (b + 0.5) * width, qty: 0, notional: 0 };
      out.set(b, k);
    }
    k.qty += q;
    k.notional += p * q;
  }
  return out;
}
