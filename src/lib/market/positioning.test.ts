import { describe, expect, it } from "vitest";
import { INTRO_MS, introArrived, introProgress, separateStationDepth, stationDepth } from "./positioning";

describe("data-derived fleet positioning", () => {
  it("maps new and thirty-minute orders from far to camera-side lanes logarithmically", () => {
    expect(stationDepth(10_000, 10_000, 8)).toBe(-8);
    expect(stationDepth(0, 30 * 60_000, 8)).toBeCloseTo(8);
    expect(stationDepth(0, 60_000, 8)).toBeGreaterThan(0);
  });
  it("stages capital ships before smaller ships and finishes within three seconds", () => {
    expect(introProgress("battleship", 500)).toBeGreaterThan(introProgress("patrol", 500));
    expect(introArrived("battleship", INTRO_MS)).toBe(true);
    expect(introArrived("patrol", INTRO_MS)).toBe(true);
  });
  it("nudges collisions only along depth and preserves exact X", () => {
    const result = separateStationDepth([{ key: "a", x: 4.25, z: 2, radius: 2 }, { key: "b", x: 4.25, z: 2, radius: 2 }], 8);
    expect(result.get("a")?.x).toBe(4.25);
    expect(result.get("b")?.x).toBe(4.25);
    expect(result.get("a")?.z).not.toBe(result.get("b")?.z);
  });
});
