import { LocalBook, type DepthDiff, type Snapshot } from "@/lib/battle/book";
import { bucketOf, bucketWidth, bucketize, type Bucket } from "@/lib/battle/buckets";
import { SideTracker, type OrderEvent } from "@/lib/battle/orderRules";
import { PhaseMachine } from "@/lib/battle/phase";
import { TapePipeline } from "@/lib/battle/tape";
import { createWalls } from "@/lib/battle/walls";
import { RollingPercentile } from "./percentile";
import { assignTiers, countInWindow, fillsOf, liquidatedSide, realizedVolBps, tradeDirection, weaponFor } from "./rules";
import type { BattleEvent, BookSide, ConvoyState } from "./types";
import { SYMBOL } from "./types";
import { fighterEligible, fighterFormationSize, FIGHTER_WAVE_COOLDOWN } from "./presentation";

export const OI_THRESHOLD_PCT = 0.3;
const ORDER_WINDOW = 300;

interface OpenOrder {
  key: string;
  first: number;
  taker: "buy" | "sell";
  buckets: Set<number>;
  firstAggId: number;
  lastAggId: number;
}

export const WALL_STAT_MIN = 1_000_000;
export const WALL_STAT_NEAR = 0.002;

export interface RecentTrade { aggId: number; time: number; price: number; qty: number; notional: number; taker: "buy" | "sell" }

/**
 * Pure market-state machine: feed it Binance payloads, it keeps the full
 * local book, buckets, percentiles and emits discrete BattleEvents.
 */
export class MarketEngine {
  readonly symbol = SYMBOL;
  book = new LocalBook();
  partial = false;
  needSnapshot = true;
  width = 0;
  mark = 0;
  /** last traded price: trades print here, so the front line and hit tests use it */
  last = 0;
  indexPrice = 0;
  funding = 0;
  nextFundingTime = 0;
  oi = 0;
  oiChangePct = 0;
  lastMsgAt = 0;
  lastLiq: { t: number; liquidated: "longs" | "shorts"; notional: number; price: number } | null = null;
  closes: { m: number; c: number }[] = [];
  volBps = 0;

  readonly bucketSampler = new RollingPercentile(6000);
  readonly tradeSampler = new RollingPercentile(4000);
  readonly orderSampler = new RollingPercentile(2000);
  readonly trackers = { bid: new SideTracker("bid"), ask: new SideTracker("ask") };
  readonly tape = new TapePipeline();
  readonly walls = createWalls();
  readonly phase = new PhaseMachine();

  // counters (debug + verification)
  counts: Record<string, number> = {};
  tradesReceived = 0;
  tradesVisualized = 0;
  tracersSpawned = 0;
  sunkNotional = { bid: 0, ask: 0 };
  ghostTimes: number[] = [];
  orderTimes: number[] = [];
  flow: { t: number; buy: number; sell: number }[] = [];
  recentTrades: RecentTrade[] = [];

  private events: BattleEvent[] = [];
  private filled = { bid: new Map<number, number>(), ask: new Map<number, number>() };
  private open = new Map<string, OpenOrder>();
  private lastSampleAt = 0;
  private lastTickAt = 0;
  private oiHist: { t: number; oi: number }[] = [];
  private oiBase: { t: number; oi: number } | null = null;
  private tradeId = 0;
  private listeners = new Set<(e: BattleEvent) => void>();
  private fighterQueue: { taker: "buy" | "sell"; target: BookSide; notional: number; buckets: Set<number>; orders: number }[] = [];
  private lastFighterWave = -Infinity;

  drain(): BattleEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
  onEvent(fn: (e: BattleEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  /** big walls near price and what happened to them (eaten vs pulled), last 30 min */
  wallLog: { t: number; side: BookSide; outcome: "eaten" | "pulled" }[] = [];
  /** liquidations, last hour */
  liqLog: { t: number; liquidated: "longs" | "shorts"; notional: number }[] = [];

  /** per price-bucket history for the ship info card (last 10 min of pulls) */
  bucketStats = new Map<string, { filled: number; hits: number; pulls: number[] }>();
  statFor(side: BookSide, b: number) {
    const k = side + b;
    let st = this.bucketStats.get(k);
    if (!st) {
      st = { filled: 0, hits: 0, pulls: [] };
      this.bucketStats.set(k, st);
      if (this.bucketStats.size > 4000) this.bucketStats.delete(this.bucketStats.keys().next().value!);
    }
    return st;
  }

  private emit(e: BattleEvent) {
    this.counts[e.type] = (this.counts[e.type] ?? 0) + 1;
    if (e.type === "damage") {
      const st = this.statFor(e.side, e.b);
      st.filled += e.filled * e.price;
      st.hits++;
    } else if (e.type === "dive" || e.type === "fled" || e.type === "pulled" || e.type === "cancel") {
      const st = this.statFor(e.side, e.b);
      st.pulls.push(e.t);
      if (st.pulls.length > 50) st.pulls.shift();
    }
    if ((e.type === "sink" || e.type === "dive" || e.type === "fled") && e.notional >= WALL_STAT_MIN && this.ref > 0 && Math.abs(e.price - this.ref) / this.ref <= WALL_STAT_NEAR) {
      this.wallLog.push({ t: e.t, side: e.side, outcome: e.type === "sink" ? "eaten" : "pulled" });
      if (this.wallLog.length > 2000) this.wallLog = this.wallLog.filter((w) => e.t - w.t <= 30 * 60_000);
    }
    if (e.type === "liquidation") {
      this.liqLog.push({ t: e.t, liquidated: e.liquidated, notional: e.notional });
      if (this.liqLog.length > 5000) this.liqLog = this.liqLog.filter((l) => e.t - l.t <= 3_600_000);
    }
    for (const l of this.listeners) l(e);
    this.events.push(e);
    // never drop fire events; cap only if the scene is not draining (tab hidden)
    if (this.events.length > 6000) this.events.splice(0, this.events.length - 6000);
  }

  get bestBid() {
    return this.book.bestBid();
  }
  get bestAsk() {
    return this.book.bestAsk();
  }
  get mid() {
    const b = this.bestBid;
    const a = this.bestAsk;
    return b && a ? (b + a) / 2 : this.mark;
  }
  get spread() {
    const b = this.bestBid;
    const a = this.bestAsk;
    return b && a ? a - b : 0;
  }
  get ref() {
    return this.last || this.mark || this.mid;
  }
  get ships() {
    return this.trackers;
  }
  get hasBook() {
    return this.book.bids.size > 0 && this.book.asks.size > 0;
  }

  /** Flagship (battleship) of a side, if any. */
  flagship(side: BookSide) {
    for (const s of this.trackers[side].ships.values()) if (s.tier === "battleship") return s;
    return null;
  }

  // ───────────────── depth ─────────────────
  handleDiff(d: DepthDiff, now: number) {
    this.lastMsgAt = now;
    if (this.partial) return;
    const r = this.book.push(d);
    if (r === "gap") this.needSnapshot = true;
    if (r === "applied") this.tick(now);
  }

  /** REST cross-check of the local book (every 15 s from binance.ts). */
  bookCheck = { checks: 0, ok: 0, skipped: 0, mismatchChecks: 0, mismatches: 0, lastAt: 0, lastOk: false, lastLevels: 0 };
  verifyBook(s: Snapshot, now: number) {
    const r = this.book.verify(s);
    const c = this.bookCheck;
    if (!r) { c.skipped++; return; }
    c.checks++;
    c.lastAt = now;
    c.lastLevels = r.levels;
    c.lastOk = r.mismatches === 0;
    if (r.mismatches) { c.mismatchChecks++; c.mismatches += r.mismatches; this.needSnapshot = true; }
    else c.ok++;
  }
  handleSnapshot(s: Snapshot, now: number) {
    const r = this.book.loadSnapshot(s);
    this.needSnapshot = r === "gap";
    this.partial = false;
    if (r === "applied") this.tick(now);
  }

  /** Fallback when the REST snapshot is unavailable. */
  handlePartial(b: [string, string][], a: [string, string][], now: number) {
    this.lastMsgAt = now;
    this.partial = true;
    this.book.setPartial(b, a);
    this.tick(now);
  }

  private ensureWidth() {
    if (!this.width && this.ref > 0) this.width = bucketWidth(this.ref);
    return this.width;
  }

  tick(now: number) {
    this.lastTickAt = now;
    const ref = this.ref;
    const w = this.ensureWidth();
    if (!w || !ref) return;
    const bids = bucketize("bid", this.book.bids, ref, w);
    const asks = bucketize("ask", this.book.asks, ref, w);
    const sample = now - this.lastSampleAt >= 1000 || this.bucketSampler.size < 60;
    if (sample) {
      this.lastSampleAt = now;
      for (const b of bids.values()) this.bucketSampler.push(b.notional);
      for (const b of asks.values()) this.bucketSampler.push(b.notional);
    }
    const tierFn = (list: Bucket[]) => assignTiers(list.map((b) => b.notional), this.bucketSampler);
    for (const side of ["bid", "ask"] as const) {
      const evs = this.trackers[side].tick(side === "bid" ? bids : asks, this.filled[side], now, ref, tierFn, this.bucketSampler.quantile(0.9));
      this.filled[side].clear();
      for (const e of evs) this.onOrderEvent(e, now);
    }
    const toLevels = (m: Map<number, Bucket>) => [...m.values()].map((b) => ({ px: b.price, sz: b.qty }));
    this.walls.update(toLevels(bids), toLevels(asks), now);
    this.flush(now);
    this.prune(now);
  }

  private onOrderEvent(e: OrderEvent, now: number) {
    if (e.type === "sink") this.sunkNotional[e.side] += e.notional;
    if (e.type === "dive" || e.type === "fled") this.ghostTimes.push(now);
    this.emit(e);
  }

  // ───────────────── trades ─────────────────
  handleTrade(d: { a?: number; p: string; q: string; m: boolean; T?: number; f?: number; l?: number }, now: number) {
    this.lastMsgAt = now;
    this.tradesReceived++;
    const price = +d.p;
    const qty = +d.q;
    const notional = price * qty;
    this.last = price;
    const fills = fillsOf(d.f, d.l);
    this.tradeSampler.push(notional);
    const dir = tradeDirection(d.m);
    const aggId = d.a ?? ++this.tradeId;
    this.recentTrades.unshift({ aggId, time: d.T ?? now, price, qty, notional, taker: dir.taker });
    if (this.recentTrades.length > 120) this.recentTrades.length = 120;
    const w = this.ensureWidth();
    const b = w ? bucketOf(price, w) : 0;
    const f = this.filled[dir.target];
    f.set(b, (f.get(b) ?? 0) + qty);
    this.walls.erode(dir.taker === "buy" ? 1 : -1, price, qty, now);
    this.phase.trade(now, notional);
    const at = d.T ?? now;
    const key = this.tape.aggregate({ a: dir.taker === "buy" ? "taker-buy" : "taker-sell", orderSide: dir.taker === "buy" ? 1 : -1, hash: undefined, trade: notional, sz: qty, fills, at });
    let o = this.open.get(key);
    if (!o) {
      o = { key, first: now, taker: dir.taker, buckets: new Set(), firstAggId: aggId, lastAggId: aggId };
      this.open.set(key, o);
    }
    o.firstAggId = Math.min(o.firstAggId, aggId);
    o.lastAggId = Math.max(o.lastAggId, aggId);
    o.buckets.add(b);
    const last = this.flow[this.flow.length - 1];
    const sec = Math.floor(now / 1000);
    if (last && last.t === sec) last[dir.taker] += notional;
    else this.flow.push({ t: sec, buy: dir.taker === "buy" ? notional : 0, sell: dir.taker === "sell" ? notional : 0 });
    this.emit({ type: "fire", t: now, taker: dir.taker, target: dir.target, b, price, qty, notional, fills, weapon: weaponFor(notional, this.tradeSampler), id: ++this.tradeId, aggId });
    if (now - this.lastTickAt > 250) this.flush(now);
  }

  /** Close taker orders whose 300 ms aggregation window has passed. */
  flush(now: number) {
    for (const o of this.open.values()) {
      if (now - o.first < ORDER_WINDOW + 50) continue;
      this.open.delete(o.key);
      const p = this.tape.take(o.key);
      if (!p || !this.tape.accept(o.key, now, 1000)) continue;
      this.orderTimes.push(now);
      const big = fighterEligible(p.trade, o.buckets.size);
      this.orderSampler.push(p.trade);
      const sides = o.taker === "buy" ? 1 : -1;
      const buckets = [...o.buckets].sort((a, b) => (a - b) * sides);
      this.phase.order(now, p.trade);
      this.emit({ type: "order", t: now, taker: o.taker, notional: p.trade, qty: p.sz, fills: p.fills, avg: p.trade / Math.max(p.sz, 1e-12), buckets, firstAggId: o.firstAggId, lastAggId: o.lastAggId });
      if (big) {
        const target = o.taker === "buy" ? "ask" : "bid";
        const queued = this.fighterQueue.find((wave) => wave.taker === o.taker);
        if (queued) {
          queued.notional += p.trade;
          queued.orders++;
          for (const bucket of buckets) queued.buckets.add(bucket);
        } else this.fighterQueue.push({ taker: o.taker, target, notional: p.trade, buckets: new Set(buckets), orders: 1 });
      }
    }
    if (this.fighterQueue.length && now - this.lastFighterWave >= FIGHTER_WAVE_COOLDOWN) this.releaseFighter(now);
  }

  private releaseFighter(now: number) {
    const q = this.fighterQueue[0];
    if (!q || now - this.lastFighterWave < FIGHTER_WAVE_COOLDOWN) return;
    const formation = fighterFormationSize(q.notional) as 2 | 3 | 4;
    this.emit({ type: "fighter", t: now, taker: q.taker, target: q.target, notional: q.notional, buckets: [...q.buckets], formation, queuedOrders: q.orders });
    this.lastFighterWave = now;
    this.fighterQueue.shift();
  }

  /** Called every ~250 ms by the app clock: phase machine + order flush. */
  heartbeat(now: number) {
    this.flush(now);
    this.phase.tick(now);
    for (const c of this.phase.drain()) this.emit({ type: "phase", ...c });
  }

  // ───────────────── liquidations ─────────────────
  handleForce(o: { S: string; p: string; q: string; ap?: string; z?: string }, now: number) {
    this.lastMsgAt = now;
    const price = +(o.ap && +o.ap > 0 ? o.ap : o.p);
    const qty = +(o.z && +o.z > 0 ? o.z : o.q);
    const liquidated = liquidatedSide(o.S);
    this.lastLiq = { t: now, liquidated, notional: price * qty, price };
    this.phase.liquidation(now, price * qty);
    this.emit({ type: "liquidation", t: now, liquidated, price, qty, notional: price * qty });
  }

  // ───────────────── mark / funding ─────────────────
  handleMark(d: { p: string; i?: string; r: string; T: number; E?: number }, now: number) {
    this.lastMsgAt = now;
    this.mark = +d.p;
    if (d.i) this.indexPrice = +d.i;
    this.funding = +d.r;
    this.nextFundingTime = d.T;
    this.phase.price(now, this.mark);
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
    if (this.oiChangePct > OI_THRESHOLD_PCT) return "in";
    if (this.oiChangePct < -OI_THRESHOLD_PCT) return "out";
    return "none";
  }

  /** Taker buy / sell notional over the last `sec` seconds. */
  flowWindow(now: number, sec = 60) {
    const s = Math.floor(now / 1000) - sec;
    let buy = 0;
    let sell = 0;
    for (const f of this.flow) if (f.t > s) {
      buy += f.buy;
      sell += f.sell;
    }
    return { buy, sell };
  }
  /** Resting $ within ±pct of the last price, per side (from the synced local book). */
  depthWithin(pct: number) {
    const ref = this.ref;
    let bid = 0;
    let ask = 0;
    if (!ref) return { bid, ask };
    const lo = ref * (1 - pct);
    const hi = ref * (1 + pct);
    for (const [p, q] of this.book.bids) if (p >= lo) bid += p * q;
    for (const [p, q] of this.book.asks) if (p <= hi) ask += p * q;
    return { bid, ask };
  }
  /** Cumulative volume delta (taker buy − taker sell, $) over the last `sec` seconds (max 300). */
  cvd(now: number, sec: number) {
    const f = this.flowWindow(now, Math.min(sec, 300));
    return f.buy - f.sell;
  }
  liquidations1h(now: number) {
    let longs = 0;
    let shorts = 0;
    for (const l of this.liqLog) if (now - l.t <= 3_600_000) l.liquidated === "longs" ? (longs += l.notional) : (shorts += l.notional);
    return { longs, shorts };
  }
  /** Walls ≥ $1M within 0.2% of price: how many were eaten vs pulled (30 min) and how many stand now. */
  wallStats(now: number) {
    const out = { bid: { eaten: 0, pulled: 0, standing: 0 }, ask: { eaten: 0, pulled: 0, standing: 0 } };
    for (const w of this.wallLog) if (now - w.t <= 30 * 60_000) out[w.side][w.outcome]++;
    const ref = this.ref;
    if (ref) for (const side of ["bid", "ask"] as const) for (const s of this.trackers[side].ships.values()) if (s.notional >= WALL_STAT_MIN && Math.abs(s.price - ref) / ref <= WALL_STAT_NEAR) out[side].standing++;
    return out;
  }
  ordersPerMinute(now: number) {
    return countInWindow(this.orderTimes, now, 60_000);
  }
  ghostsPerHour(now: number) {
    return countInWindow(this.ghostTimes, now, 3_600_000);
  }

  private prune(now: number) {
    if (this.orderTimes.length > 4000) this.orderTimes = this.orderTimes.filter((t) => now - t <= 60_000);
    if (this.ghostTimes.length > 4000) this.ghostTimes = this.ghostTimes.filter((t) => now - t <= 3_600_000);
    const cut = Math.floor(now / 1000) - 310;
    while (this.flow.length && this.flow[0]!.t < cut) this.flow.shift();
  }
}
