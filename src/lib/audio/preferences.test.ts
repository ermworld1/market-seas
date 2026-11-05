import { describe, expect, it, vi } from "vitest";
import { armSoundGesture, claimFirstVisitHint, claimSoundNudge, HINT_DURATION_MS, saveSoundPreference, soundPreferred } from "./preferences";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("landing-page sound preference", () => {
  it("defaults off and only arms for the literal shared value 1", () => {
    expect(soundPreferred(storage())).toBe(false);
    expect(soundPreferred(storage({ "donotdie:sound": "1" }))).toBe(true);
    expect(soundPreferred(storage({ "donotdie:sound": "true" }))).toBe(false);
  });
  it("writes shared on and off values", () => {
    const s = storage();
    saveSoundPreference(s, true);
    expect(s.getItem("donotdie:sound")).toBe("1");
    saveSoundPreference(s, false);
    expect(s.getItem("donotdie:sound")).toBe("0");
  });
  it.each(["pointerdown", "keydown"])("activates only on the first %s, never on load", (kind) => {
    const target = new EventTarget();
    const activate = vi.fn();
    armSoundGesture(target, activate);
    expect(activate).not.toHaveBeenCalled();
    target.dispatchEvent(new Event(kind));
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("keydown"));
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it("removes armed listeners on cleanup", () => {
    const target = new EventTarget();
    const activate = vi.fn();
    armSoundGesture(target, activate)();
    target.dispatchEvent(new Event("pointerdown"));
    expect(activate).not.toHaveBeenCalled();
  });
  it("ignores denied storage safely", () => {
    const s = { getItem: () => { throw Error("denied"); }, setItem: () => { throw Error("denied"); } };
    expect(soundPreferred(s)).toBe(false);
    expect(() => saveSoundPreference(s, true)).not.toThrow();
    expect(claimFirstVisitHint(s)).toBe(true);
  });
});

describe("first-visit hint", () => {
  it("claims the hint once using nms:hint-seen", () => {
    const s = storage();
    expect(claimFirstVisitHint(s)).toBe(true);
    expect(s.getItem("nms:hint-seen")).toBe("1");
    expect(claimFirstVisitHint(s)).toBe(false);
  });
  it("expires after exactly eight seconds", () => {
    vi.useFakeTimers();
    try {
      const hide = vi.fn();
      setTimeout(hide, HINT_DURATION_MS);
      vi.advanceTimersByTime(7999);
      expect(hide).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hide).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("first-action sound nudge", () => {
  it("fires once for a visitor who never chose sound", () => {
    const s = storage();
    expect(claimSoundNudge(s)).toBe(true);
    expect(claimSoundNudge(s)).toBe(false);
  });
  it("never fires once a sound choice exists", () => {
    expect(claimSoundNudge(storage({ "donotdie:sound": "0" }))).toBe(false);
    expect(claimSoundNudge(storage({ "donotdie:sound": "1" }))).toBe(false);
  });
  it("stays quiet when storage throws", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(claimSoundNudge(broken)).toBe(false);
  });
});
