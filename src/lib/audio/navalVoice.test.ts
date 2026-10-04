import { describe, expect, it } from "vitest";
import { navyPriceParts, navySizeParts } from "./navalVoice";

describe("naval number readouts", () => {
  it("reads prices digit by digit with Navy niner", () => {
    expect(navyPriceParts(85120).map((p) => p.word)).toEqual(["eight", "five", "one", "two", "zero"]);
    expect(navyPriceParts(85129.5).map((p) => p.word)).toContain("niner");
  });
  it("reads compact order sizes with units", () => {
    expect(navySizeParts(2_400_000).map((p) => p.word)).toEqual(["two", "point", "four", "million"]);
    expect(navySizeParts(850_000).map((p) => p.word)).toEqual(["eight", "five", "zero", "thousand"]);
  });
});
