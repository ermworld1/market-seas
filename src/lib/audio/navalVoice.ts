export type VoiceChannel = "phone" | "tbs" | "1mc";
export type NavalRole = "Captain" | "Gunnery Officer" | "Fire Control" | "Lookout/Spotter" | "Radar/CIC" | "Sonar" | "Damage Control" | "1MC";
export type FleetCallsign = "Bull Fleet" | "Bear Fleet";

export interface VoicePart { clip: string; word: string }
export interface VoiceLine { role: NavalRole; parts: VoicePart[] }
export interface VoiceChain {
  id: string;
  priority: number;
  channel: VoiceChannel;
  fleet?: FleetCallsign;
  lines: VoiceLine[];
  detail?: string;
}

const DIGIT: Record<string, string> = { "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "niner", ".": "point" };
export const words = (...items: string[]): VoicePart[] => items.map((word) => ({ clip: word.toLowerCase().replace(/[^a-z0-9]+/g, "_"), word }));
export const phrase = (clip: string, spoken: string): VoicePart => ({ clip, word: spoken });

/** Navy ranges are read as individual digits, preserving a meaningful decimal point when present. */
export function navyPriceParts(price: number): VoicePart[] {
  const rounded = Math.abs(price - Math.round(price)) < 0.05 ? String(Math.round(price)) : price.toFixed(1);
  return [...rounded].map((digit) => ({ clip: `digit_${DIGIT[digit]}`, word: DIGIT[digit] }));
}

/** Size readout: one decimal for thousands/millions, with digit clips plus the unit word. */
export function navySizeParts(notional: number): VoicePart[] {
  const unit = notional >= 1_000_000 ? "million" : "thousand";
  const scaled = notional / (unit === "million" ? 1_000_000 : 1_000);
  const spoken = scaled >= 10 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, "");
  return [...spoken].map((digit) => ({ clip: `digit_${DIGIT[digit]}`, word: DIGIT[digit] })).concat({ clip: `unit_${unit}`, word: unit });
}

export function line(role: NavalRole, ...parts: VoicePart[]): VoiceLine { return { role, parts }; }
export const chainText = (chain: VoiceChain) => chain.lines.map((entry) => `${entry.role}: ${entry.parts.map((p) => p.word).join(" ")}`).join(" → ");
