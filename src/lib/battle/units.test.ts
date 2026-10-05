import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { ALL_UNITS, SHIPS, WEAPONS, AIRCRAFT } from "./units";
import { LEVEL_Q, TRADE_Q } from "@/lib/market/rules";
import { FIGHTER_MIN_NOTIONAL } from "@/lib/market/presentation";

describe("unit config", () => {
  it("copy uses the live thresholds", () => {
    expect(SHIPS[0]!.rule).toContain(`${Math.round(LEVEL_Q.destroyer * 100)}%`);
    expect(WEAPONS[3]!.rule).toContain(`${Math.round((1 - TRADE_Q.broadside) * 100)}%`);
    expect(AIRCRAFT[0]!.rule).toContain(`$${FIGHTER_MIN_NOTIONAL / 1000}K`);
  });
  it("every unit has a fallback legend icon", () => {
    for (const u of ALL_UNITS) {
      // the legend shows one sample per unit; the static file is only a loading fallback
      const ok = existsSync(`public/legend/${u.icon}-bid.png`) || existsSync(`public/legend/${u.icon}.png`);
      expect(ok, u.icon).toBe(true);
    }
  });
});
