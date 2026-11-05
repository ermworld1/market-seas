export const SOUND_KEY = "donotdie:sound";
export const HINT_KEY = "nms:hint-seen";
export const HINT_DURATION_MS = 8000;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

// Call only from effects or event handlers; denied storage is non-fatal.
export function soundPreferred(storage: PreferenceStorage): boolean {
  try {
    return storage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSoundPreference(storage: PreferenceStorage, on: boolean) {
  try {
    storage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    // Private browsing or storage restrictions must not block the battle.
  }
}

export function claimFirstVisitHint(storage: PreferenceStorage): boolean {
  try {
    if (storage.getItem(HINT_KEY) === "1") return false;
    storage.setItem(HINT_KEY, "1");
  } catch {
    // Still show the hint when persistence is unavailable.
  }
  return true;
}

export function armSoundGesture(target: EventTarget, activate: (event: Event) => void) {
  const remove = () => {
    target.removeEventListener("pointerdown", first, true);
    target.removeEventListener("keydown", first, true);
  };
  const first = (event: Event) => {
    remove();
    activate(event);
  };
  target.addEventListener("pointerdown", first, true);
  target.addEventListener("keydown", first, true);
  return remove;
}