/**
 * Local order book synced per Binance USD-M rules:
 * 1. buffer diff events, 2. fetch snapshot (lastUpdateId),
 * 3. drop events with u < lastUpdateId,
 * 4. first applied event must satisfy U <= lastUpdateId <= u,
 * 5. every next event's pu must equal the previous event's u, else resync.
 */
export interface DepthDiff {
  U: number;
  u: number;
  pu: number;
  b: [string, string][];
  a: [string, string][];
}
export interface Snapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export type ApplyResult = "applied" | "buffered" | "stale" | "gap";

export class LocalBook {
  bids = new Map<number, number>();
  asks = new Map<number, number>();
  lastU = 0;
  synced = false;
  private buffer: DepthDiff[] = [];
  private snapId = 0;
  /** recently applied diffs, kept to replay a REST snapshot forward for verification */
  private recent: DepthDiff[] = [];

  reset() {
    this.bids.clear();
    this.asks.clear();
    this.synced = false;
    this.lastU = 0;
    this.snapId = 0;
    this.buffer = [];
    this.recent = [];
  }

  /** Feed a diff. Returns "gap" when a re-snapshot is required. */
  push(d: DepthDiff): ApplyResult {
    if (!this.synced) {
      this.buffer.push(d);
      if (this.buffer.length > 2000) this.buffer.shift();
      if (this.snapId) return this.drain();
      return "buffered";
    }
    if (d.u < this.lastU) return "stale";
    if (d.pu !== this.lastU) {
      this.synced = false;
      this.snapId = 0;
      this.buffer = [d];
      return "gap";
    }
    this.apply(d);
    return "applied";
  }

  loadSnapshot(s: Snapshot): ApplyResult {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of s.bids) if (+q > 0) this.bids.set(+p, +q);
    for (const [p, q] of s.asks) if (+q > 0) this.asks.set(+p, +q);
    this.snapId = s.lastUpdateId;
    this.lastU = s.lastUpdateId;
    return this.drain();
  }

  private drain(): ApplyResult {
    const evs = this.buffer.filter((d) => d.u >= this.snapId);
    this.buffer = [];
    let first = true;
    for (const d of evs) {
      if (first) {
        if (!(d.U <= this.snapId && d.u >= this.snapId)) {
          // the buffer started after the snapshot: need a fresh one
          this.snapId = 0;
          this.buffer = [];
          return "gap";
        }
        first = false;
        this.synced = true;
        this.apply(d);
        continue;
      }
      if (d.pu !== this.lastU) {
        this.synced = false;
        this.snapId = 0;
        return "gap";
      }
      this.apply(d);
    }
    if (first) {
      // no event bridged the snapshot yet; keep waiting (snapshot stays)
      this.synced = false;
      return "buffered";
    }
    return "applied";
  }

  private apply(d: DepthDiff) {
    for (const [p, q] of d.b) {
      if (+q > 0) this.bids.set(+p, +q);
      else this.bids.delete(+p);
    }
    for (const [p, q] of d.a) {
      if (+q > 0) this.asks.set(+p, +q);
      else this.asks.delete(+p);
    }
    this.lastU = d.u;
    this.recent.push(d);
    if (this.recent.length > 600) this.recent.splice(0, this.recent.length - 500);
  }

  /**
   * Compare a fresh REST snapshot with the local book: replay the applied diffs
   * after the snapshot's lastUpdateId onto it, then compare every level inside
   * the snapshot's price range. Returns null when the comparison is not possible.
   */
  verify(s: Snapshot): { mismatches: number; levels: number } | null {
    const L = s.lastUpdateId;
    if (!this.synced || L > this.lastU) return null;
    const after = this.recent.filter((d) => d.u > L);
    const first = after[0];
    if (first ? first.pu > L : this.lastU !== L) return null; // history does not reach back to L
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (const [p, q] of s.bids) if (+q > 0) bids.set(+p, +q);
    for (const [p, q] of s.asks) if (+q > 0) asks.set(+p, +q);
    if (!bids.size || !asks.size) return null;
    const lowBid = Math.min(...bids.keys());
    const highAsk = Math.max(...asks.keys());
    for (const d of after) {
      for (const [p, q] of d.b) (+q > 0 ? bids.set(+p, +q) : bids.delete(+p));
      for (const [p, q] of d.a) (+q > 0 ? asks.set(+p, +q) : asks.delete(+p));
    }
    let mismatches = 0;
    let levels = 0;
    const cmp = (ref: Map<number, number>, local: Map<number, number>, inRange: (p: number) => boolean) => {
      const keys = new Set<number>();
      for (const p of ref.keys()) if (inRange(p)) keys.add(p);
      for (const p of local.keys()) if (inRange(p)) keys.add(p);
      for (const p of keys) {
        levels++;
        if (Math.abs((ref.get(p) ?? 0) - (local.get(p) ?? 0)) > 1e-9) mismatches++;
      }
    };
    cmp(bids, this.bids, (p) => p >= lowBid);
    cmp(asks, this.asks, (p) => p <= highAsk);
    return { mismatches, levels };
  }

  /** Replace from a partial depth20 snapshot (fallback mode). */
  setPartial(b: [string, string][], a: [string, string][]) {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of b) if (+q > 0) this.bids.set(+p, +q);
    for (const [p, q] of a) if (+q > 0) this.asks.set(+p, +q);
    this.synced = true;
  }

  bestBid() {
    let m = 0;
    for (const p of this.bids.keys()) if (p > m) m = p;
    return m;
  }
  bestAsk() {
    let m = Infinity;
    for (const p of this.asks.keys()) if (p < m) m = p;
    return m === Infinity ? 0 : m;
  }
}
