import type { BookSide, Tier } from "@/lib/market/types";
import type { Bucket } from "./buckets";

export const HIT_GRACE = 3_000;
export const REPAIR_WINDOW = 10_000;
export const REPAIR_MIN = 2;
export const RELOCATE_WINDOW = 300;
export const RELOCATE_TOL = 0.1;
export const FLED_FRAC = 0.0003;
export const CANCEL_TOL = 0.1;

export interface Tracked {
  b: number;
  side: BookSide;
  price: number;
  qty: number;
  notional: number;
  peak: number;
  tier: Tier;
  tierFrac: number;
  bornAt: number;
  lastHitAt: number;
  everHit: boolean;
  refills: number[];
  repairUntil: number;
}

interface Base {
  t: number;
  side: BookSide;
  b: number;
  price: number;
}
export type OrderEvent =
  | (Base & { type: "damage"; filled: number; notional: number; hp: number })
  | (Base & { type: "cancel"; qty: number; notional: number })
  | (Base & { type: "sink"; tier: Tier; notional: number })
  | (Base & { type: "dive"; tier: Tier; notional: number; lived: number; neverHit: boolean })
  | (Base & { type: "fled"; tier: Tier; notional: number; lived: number; neverHit: boolean })
  | (Base & { type: "pulled"; tier: Tier; notional: number })
  | (Base & { type: "relocate"; from: number; fromPrice: number; qty: number; notional: number })
  | (Base & { type: "hidden"; extra: number; notional: number })
  | (Base & { type: "reinforce"; qty: number; notional: number; fresh: boolean })
  | (Base & { type: "repair" });

export type TierFn = (buckets: Bucket[]) => { tier: Tier; frac: number }[];

interface Pending {
  t: number;
  b: number;
  price: number;
  qty: number;
}

const BIG: Tier[] = ["cruiser", "battleship"];

/**
 * Per-side bucket tracker. Feed it the new buckets and the maker-side
 * fills that printed in each bucket since the previous tick.
 */
export class SideTracker {
  ships = new Map<number, Tracked>();
  private pending: Pending[] = [];
  constructor(readonly side: BookSide) {}

  tick(next: Map<number, Bucket>, filled: Map<number, number>, now: number, mark: number, tierFn: TierFn, big = 0): OrderEvent[] {
    const side = this.side;
    const out: OrderEvent[] = [];
    const list = [...next.entries()];
    const tiers = tierFn(list.map(([, b]) => b));
    const tierOf = new Map<number, { tier: Tier; frac: number }>();
    list.forEach(([k], i) => tierOf.set(k, tiers[i]!));
    this.pending = this.pending.filter((p) => now - p.t <= RELOCATE_WINDOW);

    // removals
    for (const [b, s] of this.ships) {
      if (next.has(b)) continue;
      const f = filled.get(b) ?? 0;
      const base = { t: now, side, b, price: s.price };
      if (f > s.qty * 1.02 + 1e-9) out.push({ ...base, type: "hidden", extra: f - s.qty, notional: (f - s.qty) * s.price });
      if (f > 0 || now - s.lastHitAt <= HIT_GRACE) {
        out.push({ ...base, type: "sink", tier: s.tier, notional: s.notional });
      } else if (BIG.includes(s.tier)) {
        const near = mark > 0 && Math.abs(mark - s.price) / mark <= FLED_FRAC;
        out.push({ ...base, type: near ? "fled" : "dive", tier: s.tier, notional: s.notional, lived: now - s.bornAt, neverHit: !s.everHit });
        this.pending.push({ t: now, b, price: s.price, qty: s.qty });
      } else {
        out.push({ ...base, type: "pulled", tier: s.tier, notional: s.notional });
      }
      this.ships.delete(b);
    }

    // updates and arrivals
    for (const [b, k] of list) {
      const tf = tierOf.get(b)!;
      const f = filled.get(b) ?? 0;
      const s = this.ships.get(b);
      const base = { t: now, side, b, price: k.price };
      if (!s) {
        const t: Tracked = {
          b, side, price: k.price, qty: k.qty, notional: k.notional, peak: k.qty, tier: tf.tier, tierFrac: tf.frac,
          bornAt: now, lastHitAt: f > 0 ? now : 0, everHit: f > 0, refills: [], repairUntil: 0,
        };
        this.ships.set(b, t);
        if (f > 0) out.push({ ...base, type: "hidden", extra: f, notional: f * k.price });
        const reloc = k.notional >= big ? this.matchPending(k.qty, b) : null;
        if (reloc) out.push({ ...base, type: "relocate", from: reloc.b, fromPrice: reloc.price, qty: k.qty, notional: k.notional });
        else out.push({ ...base, type: "reinforce", qty: k.qty, notional: k.notional, fresh: true });
        continue;
      }
      const old = s.qty;
      const delta = k.qty - old;
      s.price = k.price;
      s.tier = tf.tier;
      s.tierFrac = tf.frac;
      if (f > 0) {
        s.lastHitAt = now;
        s.everHit = true;
        // more traded than was showing (after accounting for any refill) → hidden size
        const shown = old + Math.max(0, delta);
        if (f > shown * 1.02 + 1e-9) out.push({ ...base, type: "hidden", extra: f - shown, notional: (f - shown) * k.price });
      }
      if (delta < 0) {
        const dec = -delta;
        const hit = Math.min(dec, f);
        if (hit > 0) out.push({ ...base, type: "damage", filled: hit, notional: hit * k.price, hp: k.qty / Math.max(s.peak, 1e-12) });
        const extra = dec - f;
        if (extra > Math.max(1e-9, f * CANCEL_TOL)) {
          out.push({ ...base, type: "cancel", qty: extra, notional: extra * k.price });
          if (extra * k.price >= big) this.pending.push({ t: now, b, price: k.price, qty: extra });
        }
      } else if (delta > 0) {
        s.peak = Math.max(s.peak, k.qty);
        const reloc = delta * k.price >= big ? this.matchPending(delta, b) : null;
        if (reloc) out.push({ ...base, type: "relocate", from: reloc.b, fromPrice: reloc.price, qty: delta, notional: delta * k.price });
        else out.push({ ...base, type: "reinforce", qty: delta, notional: delta * k.price, fresh: false });
        if (s.lastHitAt && now - s.lastHitAt <= REPAIR_WINDOW) {
          s.refills = [...s.refills.filter((t) => now - t <= REPAIR_WINDOW), now];
          if (s.refills.length >= REPAIR_MIN) {
            if (s.repairUntil < now) out.push({ ...base, type: "repair" });
            s.repairUntil = now + 4000;
          }
        }
      }
      s.qty = k.qty;
      s.notional = k.notional;
    }
    return out;
  }

  private matchPending(qty: number, b: number): Pending | null {
    const i = this.pending.findIndex((p) => Math.abs(p.b - b) >= 2 && Math.abs(qty - p.qty) <= p.qty * RELOCATE_TOL);
    if (i < 0) return null;
    return this.pending.splice(i, 1)[0]!;
  }
}
