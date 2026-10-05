/**
 * Recorded sample bank: /public/sfx/<folder>/<n>.mp3 (CC0, see /public/sfx/LICENSES.md).
 * Counts must match the files on disk; a missing file just falls back to the procedural synth.
 */
export const BANK = {
  mg: 8,
  gun: 4,
  biggun: 3,
  torpedo: 3,
  explosion: 6,
  ricochet: 3,
  casing: 1,
  aircraft: 3,
  flak: 3,
  siren: 1,
  horn: 2,
  waves: 1,
  battle: 1,
  radio: 2,
  prop: 1,
  spitfire: 3,
  b25: 1,
  m2: 2,
} as const;
export type BankFolder = keyof typeof BANK;

/** Which recorded folder a one-shot category plays (others stay procedural). */
export const CAT_FOLDER: Partial<Record<string, BankFolder>> = {
  mg: "mg",
  gun: "gun",
  gun5: "gun",
  broadside: "biggun",
  torpedo: "torpedo",
  hit: "ricochet",
  sink: "explosion",
  liquidation: "explosion",
  fighter: "aircraft",
  flak: "flak",
};

export const bankUrls = (f: BankFolder) => Array.from({ length: BANK[f] }, (_, i) => `/sfx/${f}/${i + 1}.mp3`);
