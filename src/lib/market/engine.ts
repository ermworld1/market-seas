import { RollingPercentile } from "./percentile";
import {
  assignTiers,
  countInWindow,
  isFullWar,
  liquidatedSide,
  realizedVolBps,
  tradeDirection,
  weaponFor,
} from "./rules";
import type { BattleEvent, BookSide, ConvoyState, Level, MarketSymbol } from "./types";

export const GHOST_TRADE_WINDOW = 3_000;
export const REPAIR_WINDOW = 10_000;
export const REPAIR_MIN_REFILLS = 2;
export const OI_THRESHOLD_PCT = 0.3;

type RawLevel = [string, string];
interface TradeMark {
  t: number;
  qty: number;
}

/**
 * Pure market-state machine: feed it Binance payloads, it keeps the book,
 * percentiles and emits discrete BattleEvents. No sockets, no rendering.
 */
export class MarketEngine {
  bids: Level[] = [];
  asks: Level[] = [];
  mark = 0;
  indexPrice = 0;
  funding = 0;
  nextFundingTime = 0;
  oi = 0;
  oiChangePct = 0;
  lastMsgAt = 0;
  lastLiq: { t: number; liquidated: "longs" | "shorts"; notional: number; price: number } | null = null;
  liqTimes: number[] = [];
  ghostTimes: number[] = [];
  closes: { m: number; c: number }[] = [];
  volBps = 0;

  readonly levelSampler = new RollingPercentile(4000);
  readonly tradeSampler = new RollingPercentile(3000);

  private events: BattleEvent[] = [];
  private trades = new Map<number, TradeMark[]>();
  private gone = new Map<string, { t: number; refills: number[]; damage: number }>();
  private lastSampleAt = 0;
  private oiHist: { t: number; oi: number }[] = [];
  private oiBase: { t: number; oi: number } | null = null;

  constructor(public readonly symbol: MarketSymbol) {}

  drain(): BattleEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private listeners = new Set<(e: BattleEvent) => void>();
  onEvent(fn: (e: BattleEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: BattleEvent) {
    for (const l of this.listeners) l(e);
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  get bestBid() {
    return this.bids[0]?.price ?? 0;
  }
  get bestAsk() {
    return this.asks[0]?.price ?? 0;
  }
  get mid() {
    return this.bestBid && this.bestAsk ? (this.bestBid + this.bestAsk) / 2 : this.mark;
  }
  get spread() {
    return this.bestBid && this.bestAsk ? this.bestAsk - this.bestBid : 0;
  }

  tradedAt(price: number, now: number, windowMs: number) {
    const list = this.trades.get(price);
    if (!list) return 0;
    let q = 0;
    for (const t of list) if (now - t.t <= windowMs) q += t.qty;
    return q;
  }

  // ───────────────── depth ─────────────────
  handleDepth(rawBids: RawLevel[], rawAsks: RawLevel[], now: number) {
    this.lastMsgAt = now;
    const sample = now - this.lastSampleAt >= 1000 || this.levelSampler.size < 40;
    if (sample) {
      this.lastSampleAt = now;
      for (const [p, q] of rawBids) this.levelSampler.push(+p * +q);
      for (const [p, q] of rawAsks) this.levelSampler.push(+p * +q);
    }
    this.bids = this.diffSide("bid", this.bids, rawBids, now);
    this.asks = this.diffSide("ask", this.asks, rawAsks, now);
    this.prune(now);
  }

  private diffSide(side: BookSide, prev: Level[], raw: RawLevel[], now: number): Level[] {
    const prevMap = new Map<number, Level>();
    for (const l of prev) prevMap.set(l.price, l);
    const next: Level[] = [];
    for (const [ps, qs] of raw) {
      const price = +ps;
      const qty = +qs;
      if (!(qty > 0)) continue;
      const old = prevMap.get(price);
      const key = side + price;
      let level: Level;
      if (old) {
        level = { ...old, qty, notional: price * qty };
        if (qty < old.qty) {
          const traded = this.tradedAt(price, now, GHOST_TRADE_WINDOW);
          if (traded > 0) level.damage = Math.min(0.95, level.damage + Math.min(1, (old.qty - qty) / old.qty) * 0.8);
        } else if (qty > old.qty && this.tradedAt(price, now, REPAIR_WINDOW) > 0) {
          this.registerRefill(side, level, now);
        }
      } else {
        const g = this.gone.get(key);
        level = { price, qty, notional: price * qty, tier: "patrol", tierFrac: 0, damage: 0, repairUntil: 0, refills: [] };
        if (g && now - g.t <= REPAIR_WINDOW) {
          level.refills = g.refills;
          level.damage = g.damage;
          this.gone.delete(key);
          this.registerRefill(side, level, now);
        }
      }
      next.push(level);
    }
    next.sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));
    const tiers = assignTiers(next.map((l) => l.notional), this.levelSampler);
    next.forEach((l, i) => {
      l.tier = tiers[i]!.tier;
      l.tierFrac = tiers[i]!.frac;
    });

    // removals
    if (next.length) {
      const worst = next[next.length - 1]!.price;
      const seen = new Set(next.map((l) => l.price));
      for (const old of prev) {
        if (seen.has(old.price)) continue;
        const beyond = side === "bid" ? old.price < worst : old.price > worst;
        if (beyond) continue; // scrolled out of the visible top-20, not a real event
        const traded = this.tradedAt(old.price, now, GHOST_TRADE_WINDOW) > 0;
        if (traded) {
          this.emit({ type: "sink", t: now, side, price: old.price, tier: old.tier });
          this.gone.set(side + old.price, { t: now, refills: old.refills, damage: 0.5 });
        } else if (old.tier === "cruiser" || old.tier === "battleship") {
          this.ghostTimes.push(now);
          this.emit({ type: "ghost", t: now, side, price: old.price, tier: old.tier });
        } else {
          this.emit({ type: "pulled", t: now, side, price: old.price, tier: old.tier });
        }
      }
    }
    return next;
  }

  private registerRefill(side: BookSide, level: Level, now: number) {
    level.refills = [...level.refills.filter((t) => now - t <= REPAIR_WINDOW), now];
    if (level.refills.length >= REPAIR_MIN_REFILLS) {
      const fresh = level.repairUntil < now;
      level.repairUntil = now + 4000;
      level.damage *= 0.6;
      if (fresh) this.emit({ type: "repair", t: now, side, price: level.price });
    }
  }

  // ───────────────── trades ─────────────────
  handleTrade(d: { p: string; q: string; m: boolean; T?: number }, now: number) {
    this.lastMsgAt = now;
    const price = +d.p;
    const qty = +d.q;
    const notional = price * qty;
    this.tradeSampler.push(notional);
    const list = this.trades.get(price) ?? [];
    list.push({ t: now, qty });
    this.trades.set(price, list);
    const dir = tradeDirection(d.m);
    const book = dir.target === "bid" ? this.bids : this.asks;
    const lvl = book.find((l) => l.price === price);
    this.emit({
      type: "fire",
      t: now,
      shooter: dir.shooter,
      target: dir.target,
      price,
      qty,
      notional,
      weapon: weaponFor(notional, this.tradeSampler),
      hitFrac: lvl ? Math.min(1, qty / lvl.qty) : 0,
    });
  }

  // ───────────────── liquidations ─────────────────
  handleForce(o: { S: string; p: string; q: string; ap?: string; z?: string }, now: number) {
    this.lastMsgAt = now;
    const price = +(o.ap && +o.ap > 0 ? o.ap : o.p);
    const qty = +(o.z && +o.z > 0 ? o.z : o.q);
    const liquidated = liquidatedSide(o.S);
    this.liqTimes.push(now);
    this.lastLiq = { t: now, liquidated, notional: price * qty, price };
    this.emit({ type: "liquidation", t: now, liquidated, price, qty, notional: price * qty });
  }

  // ───────────────── mark / funding ─────────────────
  handleMark(d: { p: string; i?: string; r: string; T: number; E?: number }, now: number) {
    this.lastMsgAt = now;
    this.mark = +d.p;
    if (d.i) this.indexPrice = +d.i;
    this.funding = +d.r;
    this.nextFundingTime = d.T;
    const minute = Math.floor((d.E ?? now) / 60_000);
    const last = this.closes[this.closes.length - 1];
    if (last && last.m === minute) last.c = this.mark;
    else this.closes.push({ m: minute, c: this.mark });
    if (this.closes.length > 16) this.closes.splice(0, this.closes.length - 16);
    this.volBps = realizedVolBps(this.closes.map((c) => c.c));
  }

  seedCloses(klines: { openTime: number; close: number }[]) {
    const merged = new Map<number, number>();
    for (const k of klines) merged.set(Math.floor(k.openTime / 60_000), k.close);
    for (const c of this.closes) merged.set(c.m, c.c);
    this.closes = [...merged.entries()].sort((a, b) => a[0] - b[0]).slice(-16).map(([m, c]) => ({ m, c }));
    this.volBps = realizedVolBps(this.closes.map((c) => c.c));
  }

  /** Mark change (%) over ~5 minutes from 1-minute closes. */
  get priceChange5m() {
    if (this.closes.length < 2) return 0;
    const ref = this.closes[Math.max(0, this.closes.length - 6)]!.c;
    const cur = this.mark || this.closes[this.closes.length - 1]!.c;
    return ((cur - ref) / ref) * 100;
  }

  // ───────────────── open interest ─────────────────
  seedOIBase(t: number, oi: number) {
    this.oiBase = { t, oi };
  }

  setOI(oi: number, now: number) {
    this.oi = oi;
    this.oiHist.push({ t: now, oi });
    this.oiHist = this.oiHist.filter((h) => now - h.t <= 10 * 60_000);
    const target = now - 5 * 60_000;
    let base = this.oiHist.find((h) => h.t <= target + 30_000 && h.t >= target - 60_000) ?? null;
    if (!base && this.oiBase && now - this.oiBase.t <= 11 * 60_000) base = this.oiBase;
    if (!base && this.oiHist[0] && now - this.oiHist[0].t >= 4 * 60_000) base = this.oiHist[0];
    this.oiChangePct = base ? ((oi - base.oi) / base.oi) * 100 : 0;
  }

  get convoy(): ConvoyState {
    if (this.oiChangePct > OI_THRESHOLD_PCT) return this.priceChange5m >= 0 ? "in-bulls" : "in-bears";
    if (this.oiChangePct < -OI_THRESHOLD_PCT) return "out";
    return "none";
  }

  fullWar(now: number) {
    return isFullWar(this.liqTimes, now);
  }

  ghostsPerMinute(now: number) {
    return countInWindow(this.ghostTimes, now, 60_000);
  }

  private prune(now: number) {
    for (const [p, list] of this.trades) {
      const kept = list.filter((t) => now - t.t <= REPAIR_WINDOW);
      if (kept.length) this.trades.set(p, kept);
      else this.trades.delete(p);
    }
    for (const [k, g] of this.gone) if (now - g.t > REPAIR_WINDOW) this.gone.delete(k);
    this.ghostTimes = this.ghostTimes.filter((t) => now - t <= 60_000);
    this.liqTimes = this.liqTimes.filter((t) => now - t <= 60_000);
  }
}
