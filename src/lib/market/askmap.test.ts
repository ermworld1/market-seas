import { describe, expect, it } from "vitest";
import { ago, askCard, sizeClass } from "./askmap";

const base = { width: 0.85, mark: 85_000, now: 100_000 };

describe("ask the map", () => {
  it("names the size class straight from the tier percentiles", () => {
    expect(sizeClass("patrol")).toBe("smallest 40% of resting liquidity this side");
    expect(sizeClass("destroyer")).toBe("40–70% of it");
    expect(sizeClass("frigate")).toBe("70–90% of it");
    expect(sizeClass("cruiser")).toBe("top 10% of it");
    expect(sizeClass("battleship")).toBe("the largest single wall this side");
  });

  it("describes a buyers' ship with only live numbers", () => {
    const card = askCard({
      ...base,
      kind: "ship",
      side: "bid",
      price: 84_900,
      ship: { tier: "cruiser", notional: 2_400_000, qty: 28.2, bornAt: 100_000 - 42_000, members: 1 },
      stats: { hits: 3, filled: 410_000, pulls: 1 },
    });
    expect(card.tone).toBe("buy");
    expect(card.title).toBe("Buyers' ship");
    expect(card.rows.map((r) => r.v)).toEqual(["$2.40M · 28.200 BTC", "84,900–84,901", "top 10% of it", "42s", "3 · $410K filled", "1×"]);
    expect(card.note).toContain("not one order");
    expect(card.note).toContain("resting longer");
  });

  it("says when one ship stands for several buckets", () => {
    const card = askCard({
      ...base,
      kind: "ship",
      side: "ask",
      price: 85_100,
      ship: { tier: "patrol", notional: 120_000, qty: 1.4, bornAt: 96_000, members: 3 },
    });
    expect(card.title).toBe("Sellers' ship");
    expect(card.tone).toBe("sell");
    expect(card.rows.find((r) => r.k === "Price range")!.v).toBe("85,100–85,103");
    expect(card.note).toContain("3 neighbouring price buckets together");
  });

  it("explains empty water without pretending there is a ship", () => {
    const card = askCard({ ...base, kind: "water", side: "ask", price: 85_850 });
    expect(card.rows).toEqual([
      { k: "Price here", v: "85,850" },
      { k: "Away from the line", v: "1.000%" },
      { k: "Resting liquidity", v: "none showing" },
    ]);
    expect(card.note).toContain("No sell orders are showing");
  });

  it("explains the price line", () => {
    const card = askCard({ ...base, kind: "line", side: "bid", price: 85_000 });
    expect(card.tone).toBe("info");
    expect(card.title).toBe("The price line");
    expect(card.rows[0]!.v).toBe("85,000");
  });

  it("never calls a ship a long or a short", () => {
    for (const side of ["bid", "ask"] as const) {
      const card = askCard({
        ...base,
        kind: "ship",
        side,
        price: 85_000,
        ship: { tier: "battleship", notional: 9_000_000, qty: 105, bornAt: 0, members: 2 },
      });
      const all = card.title + card.note + card.rows.map((r) => r.k + r.v).join(" ");
      expect(all).not.toMatch(/long|short/i);
    }
  });

  it("formats resting time", () => {
    expect(ago(400)).toBe("just now");
    expect(ago(9_000)).toBe("9s");
    expect(ago(260_000)).toBe("4m 20s");
  });
});
