import { create } from "zustand";
import type { MarketEngine } from "./engine";
import type { ConvoyState, MarketSymbol, StreamStatus } from "./types";
import type { Round } from "./predictions";

export interface HudSnapshot {
  mark: number;
  spread: number;
  bestBid: number;
  bestAsk: number;
  funding: number;
  oi: number;
  oiChangePct: number;
  latency: number;
  ghostsPerMin: number;
  lastLiq: MarketEngine["lastLiq"];
  fullWar: boolean;
  volBps: number;
  convoy: ConvoyState;
  hasBook: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: "win" | "loss" | "neutral";
}

interface BattleStore {
  symbol: MarketSymbol;
  status: StreamStatus;
  statusDetail?: string | undefined;
  hud: HudSnapshot;
  round: Round | null;
  xp: number;
  streak: number;
  best: number;
  toast: Toast | null;
  nonce: number;
  setSymbol: (s: MarketSymbol) => void;
}

export const EMPTY_HUD: HudSnapshot = {
  mark: 0,
  spread: 0,
  bestBid: 0,
  bestAsk: 0,
  funding: 0,
  oi: 0,
  oiChangePct: 0,
  latency: 0,
  ghostsPerMin: 0,
  lastLiq: null,
  fullWar: false,
  volBps: 0,
  convoy: "none",
  hasBook: false,
};

export const useBattle = create<BattleStore>((set) => ({
  symbol: "BTCUSDT",
  status: "connecting",
  hud: EMPTY_HUD,
  round: null,
  xp: 0,
  streak: 0,
  best: 0,
  toast: null,
  nonce: 0,
  setSymbol: (symbol) => set({ symbol, status: "connecting", hud: EMPTY_HUD, round: null }),
}));

/** The active engine, read by the 3D scene every frame (no React re-render). */
export const engineRef: { current: MarketEngine | null } = { current: null };

/** Transient camera shake impulse written by effects. */
export const fx = { shake: 0 };

const XP_KEY = "nms-xp-v1";
export function loadProgress() {
  try {
    const raw = localStorage.getItem(XP_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      useBattle.setState({ xp: p.xp ?? 0, streak: p.streak ?? 0, best: p.best ?? 0 });
    }
  } catch {
    /* ignore */
  }
}
export function saveProgress() {
  const { xp, streak, best } = useBattle.getState();
  try {
    localStorage.setItem(XP_KEY, JSON.stringify({ xp, streak, best }));
  } catch {
    /* ignore */
  }
}
