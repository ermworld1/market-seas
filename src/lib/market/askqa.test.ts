import { describe, expect, it } from "vitest";
import { answerQuestion, SUGGESTIONS, type QaLive } from "./askqa";

const live: QaLive = {
  now: 1_000_000,
  last: 84_512.4,
  mark: 84_520.1,
  spread: 0.1,
  funding: 0.0001,
  nextFundingTime: 1_000_000 + 95 * 60_000,
  oiChangePct: 0.42,
  cvd5m: -1_250_000,
  depth1: { bid: 41_000_000, ask: 38_000_000 },
  liq1h: { longs: 2_400_000, shorts: 610_000 },
  walls: { bid: { eaten: 3, pulled: 5, standing: 2 }, ask: { eaten: 1, pulled: 7, standing: 4 } },
  flags: {
    bid: { price: 84_300, notional: 6_200_000 },
    ask: { price: 84_900, notional: 4_100_000 },
  },
  range: (id) =>
    ({
      patrol: "under $40K",
      destroyer: "$40K to $120K",
      frigate: "$120K to $400K",
      cruiser: "$400K+",
      mg: "under $5K",
      gun: "$5K–$40K",
      torpedo: "$40K–$250K",
      broadside: "$250K+",
    })[id] ?? "",
};
const ask = (q: string) => answerQuestion(q, live);

describe("ask the map questions", () => {
  it("answers every starter question with a real topic", () => {
    for (const q of SUGGESTIONS) expect(ask(q).topic).not.toBe("fallback");
  });

  it("routes questions to the right topic", () => {
    expect(ask("How do I read this map?").topic).toBe("read");
    expect(ask("What is the flagship?").topic).toBe("flagship");
    expect(ask("What do smoke and fire mean?").topic).toBe("damage");
    expect(ask("Why did a ship dive like a submarine?").topic).toBe("submarine");
    expect(ask("what are the bombers").topic).toBe("bomber");
    expect(ask("oil tanker?").topic).toBe("funding");
    expect(ask("is this data real?").topic).toBe("data");
  });

  it("uses a named unit's own rule and live range", () => {
    const a = ask("what is a torpedo");
    expect(a.topic).toBe("unit:torpedo");
    expect(a.text).toContain("Right now that means $40K–$250K.");
    expect(ask("frigate").text).toContain("$120K to $400K");
  });

  it("fills answers with the live numbers on screen", () => {
    expect(ask("where is the flagship").text).toContain("$6.20M at 84,300");
    expect(ask("liquidations last hour").text).toContain("longs $2.40M, shorts $610K");
    expect(ask("funding?").text).toContain("0.0100% (longs pay shorts), next payment in 1h 35m");
    expect(ask("spoofing walls pulled").text).toContain("Sellers 1 eaten, 7 pulled");
    expect(ask("what is the price line").text).toContain("84,512");
  });

  it("does not forecast price or give advice", () => {
    const a = ask("should I long now?");
    expect(a.topic).toBe("advice");
    expect(a.text).toContain("nothing here is financial advice");
    expect(a.text).toContain("net selling ($1.25M)");
  });

  it("omits numbers that are not known yet instead of printing zeros", () => {
    const empty: QaLive = {
      ...live,
      last: 0,
      mark: 0,
      flags: { bid: null, ask: null },
      liq1h: { longs: 0, shorts: 0 },
      range: () => "",
    };
    expect(answerQuestion("flagship", empty).text).not.toContain("$0");
    expect(answerQuestion("price line", empty).text).not.toContain("Last trade");
    expect(answerQuestion("bombers", empty).text).not.toContain("Last hour");
  });

  it("says so when it has no answer", () => {
    expect(ask("tank").topic).toBe("fallback");
    expect(ask("   ").topic).toBe("empty");
  });
});
