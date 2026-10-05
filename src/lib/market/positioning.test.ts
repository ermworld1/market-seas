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
    const result = separateStationDepth([{ key: "a", x: 4.25, z: 2, length: 2, beam: 0.6 }, { key: "b", x: 4.25, z: 2, length: 2, beam: 0.6 }], 8);
    expect(result.get("a")?.x).toBe(4.25);
    expect(result.get("b")?.x).toBe(4.25);
    expect(result.get("a")?.z).not.toBe(result.get("b")?.z);
  });
  it("separates nearby hull footprints without moving either price X", () => {
    const result = separateStationDepth([{ key: "a", x: 4.2, z: 1, length: 3.4, beam: 0.9 }, { key: "b", x: 5.1, z: 1, length: 1.9, beam: 0.55 }], 8);
    expect(result.get("a")?.x).toBe(4.2);
    expect(result.get("b")?.x).toBe(5.1);
    expect(Math.abs((result.get("a")?.z ?? 0) - (result.get("b")?.z ?? 0))).toBeGreaterThan(0.5);
  });
});
