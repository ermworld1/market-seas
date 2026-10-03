/** Fixed-size ring buffer with cached sorted quantiles. */
export class RollingPercentile {
  private buf: Float64Array;
  private n = 0;
  private i = 0;
  private sorted: Float64Array | null = null;

  constructor(private capacity = 2000) {
    this.buf = new Float64Array(capacity);
  }

  get size() {
    return this.n;
  }

  push(v: number) {
    if (!Number.isFinite(v)) return;
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.capacity;
    if (this.n < this.capacity) this.n++;
    this.sorted = null;
  }

  private ensure() {
    if (!this.sorted) this.sorted = this.buf.slice(0, this.n).sort();
    return this.sorted;
  }

  quantile(q: number): number {
    if (this.n === 0) return 0;
    const s = this.ensure();
    const idx = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
    return s[idx]!;
  }

  /** Fraction of samples <= v */
  rank(v: number): number {
    if (this.n === 0) return 0;
    const s = this.ensure();
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s[m]! <= v) lo = m + 1;
      else hi = m;
    }
    return lo / s.length;
  }

  clear() {
    this.n = 0;
    this.i = 0;
    this.sorted = null;
  }
}
