import { describe, expect, it } from "vitest";
import { audio } from "./engine";

describe("radio variety", () => {
  it("never repeats a take while fresh takes of the same line remain", () => {
    const pick = (k: string) => (audio as unknown as { pickVariant(k: string): string }).pickVariant(k);
    const takes = [pick("s_hit"), pick("s_hit"), pick("s_hit")];
    expect(new Set(takes).size).toBe(3);
    const aa = [pick("c_aa"), pick("c_aa"), pick("c_aa")];
    expect(new Set(aa).size).toBe(3);
  });
});
