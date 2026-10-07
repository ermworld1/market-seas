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
  battle: 3,
  radio: 2,
  prop: 1,
  spitfire: 3,
  b25: 1,
  m2: 2,
  shipgun: 7,
  hullhit: 4,
  bullethit: 3,
  spray: 3,
  splash: 3,
  hull: 1,
  engine: 1,
  crew: 1,
} as const;
export type BankFolder = keyof typeof BANK;

/** Which recorded folder a one-shot category plays (others stay procedural). */
export const CAT_FOLDER: Partial<Record<string, BankFolder>> = {
  // small trades: ship-mounted heavy MG (.50 cal) and 40mm-class autocannon, not rifle-calibre fire
  mg: "shipgun",
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

/** bump when sample files are replaced in place, so browsers do not keep playing the cached old files */
export const SFX_VERSION = "21";
export const bankUrls = (f: BankFolder) => Array.from({ length: BANK[f] }, (_, i) => `/sfx/${f}/${i + 1}.mp3?v=${SFX_VERSION}`);
