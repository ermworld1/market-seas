import { describe, expect, it } from "vitest";
import { LocalBook } from "./book";
import { bucketize, bucketOf, bucketWidth } from "./buckets";
import { SideTracker, type OrderEvent } from "./orderRules";
import { PhaseMachine, T } from "./phase";
import { battleWindow, battleWinner, flagshipOutcome, recordResult } from "./round";
import { TapePipeline } from "./tape";
import { MarketEngine } from "@/lib/market/engine";
import { regimeOf, tracersFor, fillsOf } from "@/lib/market/rules";
import type { Bucket } from "./buckets";
import { canNarrateRelocate, fighterEligible, lessonForEvent, nextQuality, selectShot, tapeEligible } from "@/lib/market/presentation";
import { validatePredictionWindow } from "@/lib/market/community.functions";
import { PICK_WINDOW_MS } from "@/lib/market/predictions";

const diff = (U: number, u: number, pu: number, b: [string, string][] = [], a: [string, string][] = []) => ({ U, u, pu, b, a });

describe("book sync", () => {
  it("drops stale events, bridges the snapshot and applies in order", () => {
    const bk = new LocalBook();
    expect(bk.push(diff(90, 95, 89, [["100", "1"]]))).toBe("buffered");
    expect(bk.push(diff(96, 102, 95, [["100", "2"]]))).toBe("buffered");
    expect(bk.loadSnapshot({ lastUpdateId: 100, bids: [["100", "5"]], asks: [["101", "1"]] })).toBe("applied");
    expect(bk.bids.get(100)).toBe(2);
    expect(bk.push(diff(103, 104, 102, [["100", "0"]]))).toBe("applied");
    expect(bk.bids.has(100)).toBe(false);
  });
  it("detects a gap via pu and asks for a re-snapshot", () => {
    const bk = new LocalBook();
    bk.push(diff(99, 101, 98));
    bk.loadSnapshot({ lastUpdateId: 100, bids: [], asks: [] });
    expect(bk.synced).toBe(true);
    expect(bk.push(diff(110, 112, 109))).toBe("gap");
    expect(bk.synced).toBe(false);
  });
  it("needs a new snapshot when buffered events start after it", () => {
    const bk = new LocalBook();
    bk.push(diff(200, 205, 199));
    expect(bk.loadSnapshot({ lastUpdateId: 100, bids: [], asks: [] })).toBe("gap");
  });
});

describe("bucketing", () => {
  it("aggregates into 0.01% buckets within ±1% of mark", () => {
    const w = bucketWidth(100_000);
    expect(w).toBeCloseTo(10);
    const bids = new Map<number, number>([[99_995, 1], [99_991, 2], [99_985, 1], [98_000, 9]]);
    const out = bucketize("bid", bids, 100_000, w);
    expect(out.size).toBe(2);
    expect(out.get(bucketOf(99_995, w))!.qty).toBe(3);
    expect([...out.values()].some((b) => b.price < 99_000)).toBe(false);
  });
});

const B = (b: number, qty: number, price = 100 + b): [number, Bucket] => [b, { side: "ask", idx: b, price, qty, notional: qty * price }];
const tiers = (big = false) => (l: Bucket[]) => l.map(() => ({ tier: big ? ("cruiser" as const) : ("patrol" as const), frac: 0.5 }));
const types = (e: OrderEvent[]) => e.map((x) => x.type);

describe("order-change rules", () => {
  it("damage when decrease ≈ filled", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(1, 10)]), new Map(), 0, 100, tiers());
    const e = t.tick(new Map([B(1, 6)]), new Map([[1, 4]]), 100, 100, tiers());
    expect(types(e)).toEqual(["damage"]);
  });
  it("cancel (smoke) when decrease > filled", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(1, 10)]), new Map(), 0, 100, tiers());
    const e = t.tick(new Map([B(1, 4)]), new Map([[1, 2]]), 100, 100, tiers());
    expect(types(e)).toEqual(["damage", "cancel"]);
  });
  it("sinks when filled to zero", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(1, 10)]), new Map(), 0, 100, tiers());
    expect(types(t.tick(new Map(), new Map([[1, 10]]), 100, 100, tiers()))).toEqual(["sink"]);
  });
  it("big ship pulled far from price dives (ghost)", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(50, 10)]), new Map(), 0, 100, tiers(true));
    const e = t.tick(new Map(), new Map(), 5000, 100, tiers(true));
    expect(e[0]).toMatchObject({ type: "dive", neverHit: true, lived: 5000 });
  });
  it("big ship pulled within 0.03% of price flees", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(0, 10, 100.02)]), new Map(), 0, 100, tiers(true));
    expect(types(t.tick(new Map(), new Map(), 5000, 100, tiers(true)))).toEqual(["fled"]);
  });
  it("small ship pulled is just pulled", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(5, 1)]), new Map(), 0, 100, tiers());
    expect(types(t.tick(new Map(), new Map(), 5000, 100, tiers()))).toEqual(["pulled"]);
  });
  it("relocates when the cancelled size reappears within 300ms (±10%)", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(10, 10)]), new Map(), 0, 100, tiers(true));
    t.tick(new Map(), new Map(), 5000, 100, tiers(true));
    const e = t.tick(new Map([B(20, 10.5)]), new Map(), 5200, 100, tiers(true));
    expect(e[0]).toMatchObject({ type: "relocate", from: 10, b: 20 });
  });
  it("does not relocate after 300ms", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(10, 10)]), new Map(), 0, 100, tiers(true));
    t.tick(new Map(), new Map(), 5000, 100, tiers(true));
    expect(types(t.tick(new Map([B(20, 10)]), new Map(), 5400, 100, tiers(true)))).toEqual(["reinforce"]);
  });
  it("requires a relocation to move at least two buckets", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(10, 10)]), new Map(), 0, 100, tiers(true));
    t.tick(new Map(), new Map(), 5000, 100, tiers(true));
    expect(types(t.tick(new Map([B(11, 10)]), new Map(), 5200, 100, tiers(true)))).toEqual(["reinforce"]);
  });
  it("hidden when filled exceeds displayed size", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(1, 5)]), new Map(), 0, 100, tiers());
    const e = t.tick(new Map([B(1, 5)]), new Map([[1, 8]]), 100, 100, tiers());
    expect(e[0]).toMatchObject({ type: "hidden", extra: 3 });
  });
  it("reinforce on growth and new arrivals", () => {
    const t = new SideTracker("ask");
    expect(types(t.tick(new Map([B(1, 5)]), new Map(), 0, 100, tiers()))).toEqual(["reinforce"]);
    expect(t.tick(new Map([B(1, 7)]), new Map(), 100, 100, tiers())[0]).toMatchObject({ type: "reinforce", qty: 2, fresh: false });
  });
  it("repair after hit + 2 refills within 10s", () => {
    const t = new SideTracker("ask");
    t.tick(new Map([B(1, 10)]), new Map(), 0, 100, tiers());
    t.tick(new Map([B(1, 6)]), new Map([[1, 4]]), 100, 100, tiers());
    t.tick(new Map([B(1, 10)]), new Map(), 200, 100, tiers());
    t.tick(new Map([B(1, 6)]), new Map([[1, 4]]), 300, 100, tiers());
    expect(types(t.tick(new Map([B(1, 10)]), new Map(), 400, 100, tiers()))).toContain("repair");
  });
});

describe("tape aggregation", () => {
  it("aggregates same-side fills within 300ms and dedupes", () => {
    const tp = new TapePipeline();
    const k1 = tp.aggregate({ a: "taker-buy", orderSide: 1, trade: 100, sz: 1, fills: 3, at: 600 });
    const k2 = tp.aggregate({ a: "taker-buy", orderSide: 1, trade: 50, sz: 0.5, fills: 2, at: 800 });
    const k3 = tp.aggregate({ a: "taker-sell", orderSide: -1, trade: 10, sz: 0.1, fills: 1, at: 800 });
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
    expect(tp.take(k1)).toMatchObject({ trade: 150, fills: 5 });
    expect(tp.rawPrints).toBe(6);
    expect(tp.accept(k1, 1000, 1000)).toBe(true);
    expect(tp.accept(k1, 1500, 1000)).toBe(false);
  });
  it("tracers equal fills, capped at 24", () => {
    expect(fillsOf(10, 15)).toBe(6);
    expect(tracersFor(fillsOf(1, 100))).toBe(24);
  });
});

describe("engine fire", () => {
  it("emits exactly one fire event per aggTrade, never filtered", () => {
    const e = new MarketEngine();
    e.handleMark({ p: "100000", r: "0.0001", T: 0 }, 0);
    for (let i = 0; i < 50; i++) e.handleTrade({ p: "100000", q: "0.001", m: i % 2 === 0, f: 1, l: 1 }, i);
    expect(e.drain().filter((x) => x.type === "fire").length).toBe(50);
  });
});

describe("presentation thresholds", () => {
  const reinforce = { type: "reinforce", t: 0, side: "bid", b: 1000, price: 100, qty: 10, notional: 1000, fresh: true } as const;
  it("requires $500K and the 97th percentile for fighters", () => {
    expect(fighterEligible(499_999, 400_000, 100)).toBe(false);
    expect(fighterEligible(500_000, 490_000, 100)).toBe(true);
    expect(fighterEligible(600_000, 700_000, 100)).toBe(false);
  });
  it("filters tape events by type, distance and p90", () => {
    expect(tapeEligible(reinforce, 100, 900)).toBe(true);
    expect(tapeEligible({ ...reinforce, price: 101 }, 100, 900)).toBe(false);
    expect(tapeEligible({ ...reinforce, notional: 800 }, 100, 900)).toBe(false);
    expect(canNarrateRelocate(10_000, 0)).toBe(true);
    expect(canNarrateRelocate(9_999, 0)).toBe(false);
  });
  it("triggers lessons and chooses cinematic shots", () => {
    const fire = { type: "fire", t: 0, taker: "buy", target: "ask", b: 1, price: 100, qty: 3000, notional: 300_000, fills: 1, weapon: "torpedo", id: 1, aggId: 2 } as const;
    expect(lessonForEvent(fire)).toBe("shot");
    expect(selectShot(fire, 3000, 0)?.kind).toBe("trade");
    expect(selectShot(fire, 1000, 0)).toBe(null);
  });
  it("degrades and recovers visual quality", () => {
    expect(nextQuality("high", 24, 30, 0)).toBe("medium");
    expect(nextQuality("low", 15, 0, 180)).toBe("medium");
  });
});

describe("server prediction locking", () => {
  it("accepts only the current battle before its winner lock", () => {
    const now = 310_000;
    const w = battleWindow(now);
    const valid = { roundKey: "winner:1", roundKind: "winner" as const, battleId: w.id, choice: "buyers" as const, startsAt: now, endsAt: w.end };
    expect(validatePredictionWindow(valid, now)).toBe(true);
    expect(validatePredictionWindow({ ...valid, battleId: 0 }, now)).toBe(false);
    expect(validatePredictionWindow(valid, w.start + PICK_WINDOW_MS + 1)).toBe(false);
  });
});

describe("phase machine", () => {
  it("quiet → contact on first liquidation, firefight, reorganize", () => {
    const p = new PhaseMachine();
    for (let t = 0; t <= 70_000; t += 1000) {
      p.price(t, 100);
      p.tick(t);
    }
    expect(p.base).toBe("P1");
    p.liquidation(71_000, 10_000);
    p.tick(71_000);
    expect(p.current).toBe("P2");
    p.liquidation(72_000, 10_000);
    p.liquidation(73_000, 10_000);
    p.tick(73_000);
    expect(p.base).toBe("P3");
    p.tick(73_000 + T.reorg + 1000);
    expect(p.current).toBe("P7");
  });
  it("capital ship one-shot and cascade with $5M floor", () => {
    const p = new PhaseMachine();
    p.order(0, 2_500_000);
    expect(p.current).toBe("P4");
    p.liquidation(100, 6_000_000);
    p.tick(100);
    expect(p.base).toBe("P5");
  });
  it("maneuver push after a 0.4% move off the 2-minute low", () => {
    const p = new PhaseMachine();
    for (let i = 0; i < 10; i++) p.price(i * 1000, 100);
    p.price(11_000, 100.5);
    p.tick(11_000);
    expect(p.oneShot).toMatchObject({ phase: "P6", detail: "push" });
  });
  it("force for debug", () => {
    const p = new PhaseMachine();
    p.force("P5", 1000, 0);
    expect(p.current).toBe("P5");
    p.tick(2000);
    expect(p.current).not.toBe("P5");
  });
});

describe("battle", () => {
  it("windows and winner", () => {
    const w = battleWindow(301_000);
    expect(w.start).toBe(300_000);
    expect(battleWinner(100, 101)).toBe("buyers");
    expect(battleWinner(100, 99)).toBe("sellers");
    expect(battleWinner(100, 100)).toBe("draw");
  });
  it("scoreboard counts once per battle and resets daily", () => {
    let sb = recordResult(null, "buyers", 0);
    sb = recordResult(sb, "buyers", 0);
    expect(sb.buyers).toBe(1);
    sb = recordResult(sb, "sellers", 300_000);
    expect(sb).toMatchObject({ buyers: 1, sellers: 1 });
    expect(recordResult(sb, "draw", 86_400_000).buyers).toBe(0);
  });
  it("flagship outcome", () => {
    expect(flagshipOutcome([{ type: "dive", b: 3, side: "ask" }], "ask", 3)).toBe("dive");
    expect(flagshipOutcome([{ type: "sink", b: 3, side: "ask" }], "ask", 3)).toBe("sunk");
    expect(flagshipOutcome([{ type: "sink", b: 4, side: "ask" }], "ask", 3)).toBe("hold");
  });
  it("regime wording from price + OI", () => {
    expect(regimeOf(0.2, 0.5)).toBe("LONGS CHARGING");
    expect(regimeOf(0.2, -0.5)).toBe("SHORTS RETREATING");
    expect(regimeOf(-0.2, 0.5)).toBe("SHORTS CHARGING");
    expect(regimeOf(-0.2, -0.5)).toBe("LONGS RETREATING");
  });
});

import { currentStreak, flagshipOutcome as flagshipSettle, winnerOutcome, xpFor } from "@/lib/market/settlement";
describe("settlement", () => {
  it("winner outcome from marks", () => { expect(winnerOutcome(100, 101)).toBe("buyers"); expect(winnerOutcome(100, 99)).toBe("sellers"); expect(winnerOutcome(100, 100)).toBe("draw"); });
  it("flagship sunk vs dive vs hold", () => {
    expect(flagshipSettle(10, 0.5, 99, 101, 100, 100.01)).toBe("sunk");
    expect(flagshipSettle(10, 0.5, 101, 102, 100, 100.01)).toBe("dive");
    expect(flagshipSettle(10, 5, 99, 101, 100, 100.01)).toBe("hold");
  });
  it("streak ignores void, breaks on miss", () => { expect(currentStreak([true, false, true, null, true])).toBe(2); expect(currentStreak([])).toBe(0); });
  it("xp base + streak bonus capped", () => {
    expect(xpFor("winner", true, 0)).toBe(10); expect(xpFor("flagship", true, 0)).toBe(15);
    expect(xpFor("winner", true, 2)).toBe(20); expect(xpFor("winner", true, 9)).toBe(35);
    expect(xpFor("flagship", false, 4)).toBe(0); expect(xpFor("winner", null, 4)).toBe(0);
  });
});

import { lessonText } from "@/lib/market/presentation";
describe("lesson sentences", () => {
  it("uses the real numbers for every lesson kind", () => {
    const base = { t: 0, side: "ask" as const, b: 1, price: 85320, tier: "cruiser" as const };
    expect(lessonText({ ...base, type: "sink", notional: 1_800_000 } as never)).toBe("The Sellers' $1.8M order at 85,320 was fully traded, so that ship sank and the price line moved.");
    expect(lessonText({ ...base, type: "dive", notional: 900_000, lived: 1, neverHit: true } as never)).toContain("$900K order at 85,320 was cancelled");
    expect(lessonText({ type: "fighter", t: 0, taker: "sell", target: "bid", notional: 640_000, buckets: [1, 2, 3] })).toContain("sold $640K in a single order across 3 price levels");
    expect(lessonText({ type: "liquidation", t: 0, liquidated: "longs", price: 85000, qty: 1, notional: 120_000 })).toContain("force-closed $120K of longs at 85,000");
    expect(lessonText({ ...base, side: "bid", type: "reinforce", qty: 10, notional: 2_100_000, fresh: true } as never)).toContain("added $2.1M of buy orders at 85,320");
  });
});
