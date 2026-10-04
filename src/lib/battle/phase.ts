/** Battle-rhythm state machine. Time is always injected (testable). */
export type Phase = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7";
export type BasePhase = "P0" | "P1" | "P3" | "P5"; // P0 = active / neutral
export const PHASE_NAME: Record<Phase | "P0", string> = {
  P0: "Patrol",
  P1: "Quiet",
  P2: "Contact",
  P3: "Firefight",
  P4: "Capital ship",
  P5: "Cascade",
  P6: "Maneuver",
  P7: "Reorganize",
};
export const ONE_SHOT_MS = 6_000;
export const T = {
  quietNoLiq: 60_000,
  quietRange: 0.0008,
  contactRange: 0.003,
  contactCooldown: 90_000,
  fireLiqs: 3,
  fireBigTrades: 5,
  bigTrade: 250_000,
  window: 30_000,
  capital: 2_000_000,
  cascadeFloor: 5_000_000,
  cascadeHistoryMs: 3_600_000,
  maneuver: 0.004,
  maneuverWindow: 120_000,
  maneuverCooldown: 60_000,
  reorg: 45_000,
};

export interface PhaseChange {
  t: number;
  phase: Phase | "P0";
  oneShot: boolean;
  detail?: "push" | "fall back";
}

export class PhaseMachine {
  base: BasePhase = "P0";
  oneShot: { phase: Phase; until: number; detail?: "push" | "fall back" } | null = null;
  forced: { phase: Phase; until: number } | null = null;
  private liqs: { t: number; n: number }[] = [];
  private bigTrades: number[] = [];
  private prices: { t: number; p: number }[] = [];
  private lastLiq = -Infinity;
  private startedAt: number | null = null;
  private lastContact = -Infinity;
  private lastManeuver = -Infinity;
  private wasQuiet = false;
  /** 30 s liquidation-notional buckets for the cascade percentile */
  private liqBuckets: { t: number; n: number }[] = [];
  private changes: PhaseChange[] = [];

  get current(): Phase | "P0" {
    return this.forced?.phase ?? this.oneShot?.phase ?? this.base;
  }

  drain() {
    const c = this.changes;
    this.changes = [];
    return c;
  }

  force(phase: Phase, ms: number, now: number) {
    this.forced = { phase, until: now + ms };
    this.changes.push({ t: now, phase, oneShot: true });
  }

  liquidation(t: number, notional: number) {
    this.start(t);
    if (this.wasQuiet) this.contact(t);
    this.liqs.push({ t, n: notional });
    this.lastLiq = t;
    const slot = Math.floor(t / T.window) * T.window;
    const last = this.liqBuckets[this.liqBuckets.length - 1];
    if (last && last.t === slot) last.n += notional;
    else this.liqBuckets.push({ t: slot, n: notional });
  }

  trade(t: number, notional: number) {
    this.start(t);
    if (notional >= T.bigTrade) this.bigTrades.push(t);
  }

  order(t: number, notional: number) {
    this.start(t);
    if (notional >= T.capital) this.fire("P4", t);
  }

  price(t: number, p: number) {
    this.start(t);
    this.prices.push({ t, p });
  }

  cascadeThreshold(now: number) {
    const hist = this.liqBuckets.filter((b) => now - b.t <= 86_400_000);
    if (this.startedAt === null || now - this.startedAt < T.cascadeHistoryMs || hist.length < 20) return T.cascadeFloor;
    // include empty buckets: fraction of 30 s slots in the span that had liquidations
    const slots = Math.max(hist.length, Math.floor((now - this.startedAt) / T.window));
    const vals = hist.map((b) => b.n).sort((a, b) => a - b);
    const zeros = slots - vals.length;
    const idx = Math.ceil(0.95 * slots) - 1 - zeros;
    return Math.max(1, idx < 0 ? 0 : vals[Math.min(vals.length - 1, idx)]!);
  }

  tick(now: number): Phase | "P0" {
    if (this.forced && now > this.forced.until) this.forced = null;
    if (this.oneShot && now > this.oneShot.until) {
      this.oneShot = null;
      this.changes.push({ t: now, phase: this.base, oneShot: false });
    }
    this.liqs = this.liqs.filter((l) => now - l.t <= T.window);
    this.bigTrades = this.bigTrades.filter((t) => now - t <= T.window);
    this.prices = this.prices.filter((p) => now - p.t <= T.maneuverWindow);
    if (this.liqBuckets.length > 3000) this.liqBuckets.splice(0, this.liqBuckets.length - 3000);

    const m1 = this.prices.filter((p) => now - p.t <= 60_000).map((p) => p.p);
    const range1 = m1.length ? (Math.max(...m1) - Math.min(...m1)) / Math.min(...m1) : 0;
    const liqN = this.liqs.reduce((a, l) => a + l.n, 0);

    let base: BasePhase = this.base;
    if (liqN > 0 && liqN >= this.cascadeThreshold(now)) base = "P5";
    else if (this.liqs.length >= T.fireLiqs || this.bigTrades.length >= T.fireBigTrades) base = base === "P5" ? "P5" : "P3";
    else if (base === "P3" || base === "P5") {
      if (now - this.lastLiq >= T.reorg && this.bigTrades.length < T.fireBigTrades) {
        base = "P0";
        this.fire("P7", now);
      }
    } else if (now - this.lastLiq >= T.quietNoLiq && this.startedAt !== null && now - this.startedAt >= 60_000 && range1 < T.quietRange) base = "P1";
    else base = "P0";

    if (base !== this.base) {
      this.wasQuiet = this.base === "P1";
      this.base = base;
      if (!this.oneShot) this.changes.push({ t: now, phase: base, oneShot: false });
    } else if (base === "P1") this.wasQuiet = true;

    if (range1 > T.contactRange) this.contact(now);

    const all = this.prices.map((p) => p.p);
    if (all.length > 5 && now - this.lastManeuver >= T.maneuverCooldown) {
      const cur = all[all.length - 1]!;
      const hi = Math.max(...all);
      const lo = Math.min(...all);
      if (cur >= lo * (1 + T.maneuver) && cur >= hi * 0.9995) this.fire("P6", now, "push");
      else if (cur <= hi * (1 - T.maneuver) && cur <= lo * 1.0005) this.fire("P6", now, "fall back");
    }
    return this.current;
  }

  private contact(now: number) {
    this.wasQuiet = false;
    if (now - this.lastContact < T.contactCooldown) return;
    this.lastContact = now;
    this.fire("P2", now);
  }

  private fire(phase: Phase, now: number, detail?: "push" | "fall back") {
    if (phase === "P6") this.lastManeuver = now;
    this.oneShot = detail ? { phase, until: now + ONE_SHOT_MS, detail } : { phase, until: now + ONE_SHOT_MS };
    this.changes.push(detail ? { t: now, phase, oneShot: true, detail } : { t: now, phase, oneShot: true });
  }

  private start(t: number) {
    if (this.startedAt === null) this.startedAt = t;
  }
}

export type Intensity = "Calm" | "Active" | "Heavy" | "Extreme";
export function intensityOf(p: Phase | "P0"): Intensity {
  if (p === "P5") return "Extreme";
  if (p === "P3" || p === "P4") return "Heavy";
  if (p === "P1" || p === "P7") return "Calm";
  return "Active";
}
