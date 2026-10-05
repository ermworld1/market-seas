/**
 * Single source for every unit, weapon and event the battlefield shows.
 * Legend, Guide, How it works and the tour read from here; thresholds come
 * straight from the rule constants so the copy cannot drift from the code.
 */
import { LEVEL_Q, TRADE_Q } from "@/lib/market/rules";
import { FIGHTER_MIN_NOTIONAL, FIGHTER_SWEEP_LEVELS, TAPE_MAX_DISTANCE } from "@/lib/market/presentation";
import { FLED_FRAC, RELOCATE_TOL, RELOCATE_WINDOW, REPAIR_MIN, REPAIR_WINDOW } from "./orderRules";
import { BUCKET_FRAC, RANGE_FRAC } from "./buckets";
import { T } from "./phase";

/** Binance Futures colours: Buyers green, Sellers red. */
export const SIDE_HEX = { bid: "#0ECB81", ask: "#F6465D" } as const;
/** Muted physical fleet paint; never use the bright UI colours on 3D units. */
export const UNIT_PAINT_HEX = { bid: "#2F8F57", ask: "#C0392B" } as const;

const pct = (q: number) => `${Math.round(q * 100)}%`;
const pctTxt = (f: number) => `${+(f * 100).toFixed(3)}%`;
const usdK = (n: number) => (n >= 1e6 ? `$${n / 1e6}M` : `$${n / 1e3}K`);

export interface UnitDef {
  id: string;
  name: string;
  /** legend render: /legend/<icon>-<bid|ask>.png (rendered from the scene model / effect) */
  icon: string;
  /** what triggers it, with the exact threshold from the code */
  rule: string;
  /** one plain-English line */
  text: string;
  sided: boolean;
}

export const SHIPS: UnitDef[] = [
  { id: "patrol", name: "Patrol boat", icon: "patrol", sided: true, rule: `smallest ${pct(LEVEL_Q.destroyer)} of price buckets`, text: "Small resting liquidity at one price bucket." },
  { id: "destroyer", name: "Destroyer", icon: "destroyer", sided: true, rule: `${pct(LEVEL_Q.destroyer)}–${pct(LEVEL_Q.frigate)}`, text: "Medium-small resting liquidity." },
  { id: "frigate", name: "Frigate", icon: "frigate", sided: true, rule: `${pct(LEVEL_Q.frigate)}–${pct(LEVEL_Q.cruiser)}`, text: "Mid-sized resting liquidity." },
  { id: "cruiser", name: "Cruiser", icon: "cruiser", sided: true, rule: `top ${pct(1 - LEVEL_Q.cruiser)}`, text: "Among the largest resting liquidity in the book." },
  { id: "battleship", name: "Flagship (battleship)", icon: "battleship", sided: true, rule: "largest bucket on each side", text: "The biggest wall. Its HP bar is its size." },
];

/** Universal ship guide item. It deliberately avoids tier claims because visible ships may merge nearby buckets. */
export const SHIP_GUIDE: UnitDef = {
  id: "ship",
  name: "Ship",
  icon: "patrol",
  sided: true,
  rule: "real resting liquidity from the live order book",
  text: "Bigger means more displayed notional. Left/right is price; front/back is how long the liquidity has rested.",
};

export const WEAPONS: UnitDef[] = [
  { id: "mg", name: "Machine gun", icon: "fx-mg", sided: true, rule: `trades below the ${pct(TRADE_Q.gun)} size rank`, text: "A small real trade; one tracer per fill (max 24)." },
  { id: "gun", name: "Deck gun", icon: "fx-gun", sided: true, rule: `${pct(TRADE_Q.gun)}–${pct(TRADE_Q.torpedo)}`, text: "A medium real trade; arcing shells." },
  { id: "torpedo", name: "Torpedo", icon: "fx-torpedo", sided: true, rule: `${pct(TRADE_Q.torpedo)}–${pct(TRADE_Q.broadside)}`, text: "A large real trade; a wake runs across the water." },
  { id: "broadside", name: "Broadside", icon: "fx-broadside", sided: true, rule: `top ${pct(1 - TRADE_Q.broadside)} of trades`, text: "A very large real trade; a full broadside from the attacking fleet." },
];

export const AIRCRAFT: UnitDef[] = [
  { id: "fighter", name: "Fighter", icon: "fighter", sided: true, rule: `≥ ${usdK(FIGHTER_MIN_NOTIONAL)} of aggressive buying or selling within 0.3 s, or sweeping ≥ ${FIGHTER_SWEEP_LEVELS} price levels`, text: "Two to four fighters strafe every swept price row." },
  { id: "bomber", name: "Bomber", icon: "bomber", sided: true, rule: "a real Binance liquidation (Binance sends max 1 per second)", text: "Labelled Long or Short liquidated. A long liquidation is a forced sell, so it strikes the bid side; a short liquidation strikes the ask side." },
];

export const EVENTS: UnitDef[] = [
  { id: "sink", name: "Sink", icon: "fx-sink", sided: false, rule: "displayed size fully traded", text: "The ship goes under; the price line moves through it." },
  { id: "damage", name: "Damage, fire and smoke", icon: "fx-fire", sided: false, rule: "partial fills", text: "Hit ships burn and smoke until refilled or sunk." },
  { id: "dive", name: "Submarine dive", icon: "fx-dive", sided: false, rule: "cruiser- or flagship-size liquidity pulled before any trade reached it", text: "Big resting liquidity vanished; the ship dives." },
  { id: "fled", name: "Fled", icon: "fx-dive", sided: false, rule: `big liquidity pulled within ${pctTxt(FLED_FRAC)} of the price`, text: "Big liquidity was pulled just before being hit." },
  { id: "pulled", name: "Smoke screen", icon: "fx-smoke", sided: false, rule: "smaller liquidity pulled", text: "The ship slips away behind smoke." },
  { id: "relocate", name: "Surface / relocate", icon: "fx-surface", sided: false, rule: `same size (±${pct(RELOCATE_TOL)}) reappears ≥ 2 buckets away within ${RELOCATE_WINDOW} ms`, text: "A submarine surfaces at a new price." },
  { id: "hidden", name: "Hidden submarine", icon: "fx-surface", sided: false, rule: "more traded than was displayed", text: "More traded than was showing: possible iceberg (inferred)." },
  { id: "reinforce", name: "Reinforce", icon: "fx-reinforce", sided: false, rule: "real size added to a bucket", text: "The ship grows; a +$ label floats up." },
  { id: "repair", name: "Repair", icon: "fx-repair", sided: false, rule: `${REPAIR_MIN}+ refills within ${REPAIR_WINDOW / 1000}s after damage`, text: "A \"repair (inferred)\" tag: the liquidity is being topped up." },
  { id: "splash", name: "Near miss", icon: "fx-splash", sided: false, rule: "a trade printed at a price with no ship", text: "A water splash where the shot landed." },
  { id: "flak", name: "Flak", icon: "fx-flak", sided: false, rule: "only while real aircraft are in the sky", text: "Black anti-aircraft bursts." },
  { id: "cascade", name: "Cascade (P5)", icon: "fx-cascade", sided: false, rule: `liquidations above the hourly threshold (floor ${usdK(T.cascadeFloor)} per 30s)`, text: "Air-raid siren, a wave of aircraft scaled by real liquidations." },
];

export const SCENERY: UnitDef[] = [
  { id: "strait", name: "Price line (buoys)", icon: "fx-strait", sided: false, rule: "last traded price (mark shown separately in the header)", text: "Moves left when price falls, right when it rises." },
  { id: "convoy", name: "Convoy", icon: "transport", sided: false, rule: "open interest change over 5 min (polled every 30s)", text: "Neutral: sails in along the horizon when open interest rises, out when it falls. Open interest has no side." },
  { id: "tanker", name: "Oil tanker", icon: "tanker", sided: false, rule: "funding rate", text: "Neutral supply ship. Funding is paid between longs and shorts (shown in the header), not between the buy and sell fleets." },
  { id: "storm", name: "Storm and rain", icon: "fx-storm", sided: false, rule: "realised volatility and battle phase", text: "Rougher sea when the market is wild." },
];

export const RULES_FACTS = {
  bucket: pctTxt(BUCKET_FRAC),
  range: pctTxt(RANGE_FRAC),
  tapeDistance: pctTxt(TAPE_MAX_DISTANCE),
  battleMinutes: 5,
};

export const ALL_UNITS = [...SHIPS, ...WEAPONS, ...AIRCRAFT, ...EVENTS, ...SCENERY];
