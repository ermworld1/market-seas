import { create } from "zustand";
import type { MarketEngine } from "./engine";
import type { ConvoyState, StreamStatus } from "./types";
import type { Round } from "./predictions";
import type { Phase } from "@/lib/battle/phase";
import type { Scoreboard, Winner } from "@/lib/battle/round";
import type { RecentTrade } from "./engine";

export interface FlagSnap {
  side: "bid" | "ask";
  b: number;
  price: number;
  notional: number;
  hp: number;
  peak: number;
  away: number;
  since: number;
  status: "on station" | "DIVED" | "FLED" | "SUNK";
}

export interface HudSnapshot {
  mark: number;
  last: number;
  spread: number;
  bestBid: number;
  bestAsk: number;
  funding: number;
  oi: number;
  oiChangePct: number;
  priceChange5m: number;
  latency: number;
  ghostsHour: number;
  ordersMin: number;
  lastLiq: MarketEngine["lastLiq"];
  volBps: number;
  convoy: ConvoyState;
  hasBook: boolean;
  partial: boolean;
  flowBuy: number;
  flowSell: number;
  phase: Phase | "P0";
  ships: { bid: number; ask: number };
  sunk: { bid: number; ask: number };
  flags: { bid: FlagSnap | null; ask: FlagSnap | null };
  nextTarget: { side: "bid" | "ask"; price: number; depth: number } | null;
  battle: { id: number; end: number; startMark: number };
}

export interface Toast {
  id: number;
  text: string;
  tone: "win" | "loss" | "neutral";
}
export interface TapeLine {
  id: number;
  t: number;
  kind: string;
  text: string;
  tone: "buy" | "sell" | "sub" | "liq" | "info";
  notional: number;
  firstAggId?: number;
  lastAggId?: number;
}
export interface LadderLevel { side: "bid" | "ask"; price: number; qty: number; notional: number; cumulative: number; bucket: number }
export interface Callout {
  id: number;
  text: string;
  tone: "buy" | "sell" | "liq" | "info";
  slow?: boolean;
}
export interface ClipReady {
  id: number;
  title: string;
  files: { name: string; url: string; blob: Blob }[];
}

interface BattleStore {
  status: StreamStatus;
  statusDetail?: string | undefined;
  hud: HudSnapshot;
  round: Round | null;
  flagRound: Round | null;
  xp: number;
  streak: number;
  best: number;
  toast: Toast | null;
  nonce: number;
  tape: TapeLine[];
  callout: Callout | null;
  radio: { id: number; text: string } | null;
  result: { id: number; winner: Winner; startMark: number; endMark: number } | null;
  scoreboard: Scoreboard | null;
  viewMode: "capital" | "all";
  filter: "all" | "1m" | "near" | "subs";
  soundOn: boolean;
  volume: number;
  clip: ClipReady | null;
  tourOpen: boolean;
  presentation: "cinema" | "map";
  panelTab: "book" | "trades" | "tape" | "guide" | "rankings";
  ladder: { bids: LadderLevel[]; asks: LadderLevel[] };
  recentTrades: RecentTrade[];
  selectedBucket: { side: "bid" | "ask"; b: number } | null;
  lesson: { id: number; kind: string; text: string } | null;
  alertsOn: boolean;
}

export const EMPTY_HUD: HudSnapshot = {
  mark: 0,
  last: 0,
  spread: 0,
  bestBid: 0,
  bestAsk: 0,
  funding: 0,
  oi: 0,
  oiChangePct: 0,
  priceChange5m: 0,
  latency: 0,
  ghostsHour: 0,
  ordersMin: 0,
  lastLiq: null,
  volBps: 0,
  convoy: "none",
  hasBook: false,
  partial: false,
  flowBuy: 0,
  flowSell: 0,
  phase: "P0",
  ships: { bid: 0, ask: 0 },
  sunk: { bid: 0, ask: 0 },
  flags: { bid: null, ask: null },
  nextTarget: null,
  battle: { id: 0, end: 0, startMark: 0 },
};

export const useBattle = create<BattleStore>(() => ({
  status: "connecting",
  hud: EMPTY_HUD,
  round: null,
  flagRound: null,
  xp: 0,
  streak: 0,
  best: 0,
  toast: null,
  nonce: 0,
  tape: [],
  callout: null,
  radio: null,
  result: null,
  scoreboard: null,
  viewMode: "all",
  filter: "all",
  soundOn: false,
  volume: 0.7,
  clip: null,
  tourOpen: false,
  presentation: "cinema",
  panelTab: "book",
  ladder: { bids: [], asks: [] },
  recentTrades: [],
  selectedBucket: null,
  lesson: null,
  alertsOn: false,
}));

/** The active engine, read by the 3D scene every frame (no React re-render). */
export const engineRef: { current: MarketEngine | null } = { current: null };

/** Transient camera shake / slow-mo impulses written by effects. */
export const fx = { shake: 0, slowmo: 0 };

let ids = 0;
export const nextId = () => ++ids;
export function toast(text: string, tone: Toast["tone"] = "neutral") {
  useBattle.setState({ toast: { id: nextId(), text, tone } });
}

export function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function safeSet(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

const XP_KEY = "nms-xp-v1";
export function loadProgress() {
  const p = safeGet<{ xp?: number; streak?: number; best?: number }>(XP_KEY, {});
  const sb = safeGet<Scoreboard | null>("nms-scoreboard-v1", null);
  const prefs = safeGet<{ viewMode?: "capital" | "all"; filter?: BattleStore["filter"]; volume?: number; presentation?: BattleStore["presentation"]; alertsOn?: boolean }>("nms-prefs-v1", {});
  useBattle.setState({
    xp: p.xp ?? 0,
    streak: p.streak ?? 0,
    best: p.best ?? 0,
    scoreboard: sb,
    viewMode: prefs.viewMode ?? "all",
    filter: prefs.filter ?? "all",
    volume: prefs.volume ?? 0.7,
    presentation: prefs.presentation ?? "cinema",
    alertsOn: prefs.alertsOn ?? false,
  });
}
export function saveProgress() {
  const { xp, streak, best } = useBattle.getState();
  safeSet(XP_KEY, { xp, streak, best });
}
export function savePrefs() {
  const { viewMode, filter, volume, presentation, alertsOn } = useBattle.getState();
  safeSet("nms-prefs-v1", { viewMode, filter, volume, presentation, alertsOn });
}
