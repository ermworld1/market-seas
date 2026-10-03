import { describe, expect, it } from "vitest";
import { MarketEngine } from "./engine";
import { RollingPercentile } from "./percentile";
import { assignTiers, isFullWar, liquidatedSide, realizedVolBps, tradeDirection, weaponFor } from "./rules";
import { holdBroken, resolveStorm, resolveWater } from "./predictions";

const lv = (p: number, q: number): [string, string] => [String(p), String(q)];

function book(e: MarketEngine, bids: [string, string][], asks: [string, string][], t: number) {
  e.handleDepth(bids, asks, t);
}

describe("rules", () => {
  it("maps taker direction from isBuyerMaker", () => {
    expect(tradeDirection(false)).toEqual({ shooter: "bulls", target: "ask" });
    expect(tradeDirection(true)).toEqual({ shooter: "bears", target: "bid" });
  });
  it("maps liquidation side", () => {
    expect(liquidatedSide("SELL")).toBe("longs");
    expect(liquidatedSide("BUY")).toBe("shorts");
  });
  it("percentile ranks and weapons", () => {
    const s = new RollingPercentile(100);
    for (let i = 1; i <= 100; i++) s.push(i);
    expect(s.quantile(0.5)).toBe(50);
    expect(weaponFor(10, s)).toBe("mg");
    expect(weaponFor(70, s)).toBe("gun");
    expect(weaponFor(95, s)).toBe("torpedo");
    expect(weaponFor(1000, s)).toBe("broadside");
  });
  it("relative tiers give a single battleship", () => {
    const s = new RollingPercentile(100);
    for (let i = 1; i <= 100; i++) s.push(i);
    const t = assignTiers([10, 60, 95, 99, 200], s).map((x) => x.tier);
    expect(t).toEqual(["patrol", "frigate", "cruiser", "cruiser", "battleship"]);
  });
  it("full war needs 3 liquidations within 10s", () => {
    expect(isFullWar([0, 4000, 9000], 9500)).toBe(true);
    expect(isFullWar([0, 4000, 12000], 12500)).toBe(false);
  });
  it("realized vol is zero for flat prices", () => {
    expect(realizedVolBps([100, 100, 100, 100])).toBe(0);
    expect(realizedVolBps([100, 101, 100, 101])).toBeGreaterThan(50);
  });
});

describe("engine events", () => {
  const asks = [lv(101, 1), lv(102, 50), lv(103, 1), lv(104, 1)];
  const bids = [lv(99, 1), lv(98, 1), lv(97, 1)];

  it("ghost: big level disappears without trades", () => {
    const e = new MarketEngine("BTCUSDT");
    book(e, bids, asks, 0);
    expect(e.asks.find((l) => l.price === 102)?.tier).toBe("battleship");
    e.drain();
    book(e, bids, [lv(101, 1), lv(103, 1), lv(104, 1)], 100);
    const ev = e.drain();
    expect(ev.find((x) => x.type === "ghost")).toMatchObject({ side: "ask", price: 102 });
    expect(e.ghostsPerMinute(200)).toBe(1);
  });

  it("sink: level disappears after trades printed at that price", () => {
    const e = new MarketEngine("BTCUSDT");
    book(e, bids, asks, 0);
    e.handleTrade({ p: "101", q: "1", m: false }, 50);
    book(e, bids, [lv(102, 50), lv(103, 1), lv(104, 1)], 100);
    const ev = e.drain();
    expect(ev.find((x) => x.type === "fire")).toMatchObject({ shooter: "bulls", target: "ask", hitFrac: 1 });
    expect(ev.find((x) => x.type === "sink")).toMatchObject({ side: "ask", price: 101 });
  });

  it("scrolling out of the top levels is not an event", () => {
    const e = new MarketEngine("BTCUSDT");
    book(e, bids, asks, 0);
    e.drain();
    book(e, bids, [lv(100.5, 1), lv(101, 1), lv(102, 50), lv(103, 1)], 100);
    expect(e.drain().filter((x) => x.type !== "fire")).toEqual([]);
  });

  it("repair: hit and refilled twice within 10s", () => {
    const e = new MarketEngine("BTCUSDT");
    book(e, bids, asks, 0);
    e.handleTrade({ p: "99", q: "0.5", m: true }, 10);
    book(e, [lv(99, 0.5), lv(98, 1), lv(97, 1)], asks, 100);
    book(e, [lv(99, 1), lv(98, 1), lv(97, 1)], asks, 200);
    e.handleTrade({ p: "99", q: "0.5", m: true }, 300);
    book(e, [lv(99, 0.5), lv(98, 1), lv(97, 1)], asks, 400);
    book(e, [lv(99, 1), lv(98, 1), lv(97, 1)], asks, 500);
    expect(e.drain().some((x) => x.type === "repair" && x.price === 99)).toBe(true);
    expect(e.bids[0]!.repairUntil).toBeGreaterThan(500);
  });
});

describe("predictions", () => {
  it("resolves", () => {
    expect(resolveWater(100, 101)).toBe("a");
    expect(resolveWater(100, 99)).toBe("b");
    expect(resolveWater(100, 100)).toBeNull();
    expect(resolveStorm(3, 4)).toBe("a");
    expect(holdBroken({ type: "sink", t: 0, side: "bid", price: 5, tier: "battleship" }, "bid", 5)).toBe(true);
    expect(holdBroken({ type: "sink", t: 0, side: "ask", price: 5, tier: "battleship" }, "bid", 5)).toBe(false);
  });
});
