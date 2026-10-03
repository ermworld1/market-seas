import { useEffect, useRef } from "react";
import { engineRef, loadProgress, saveProgress, useBattle } from "@/lib/market/store";
import {
  DURATION,
  ROTATION,
  type Round,
  holdBroken,
  resolveHold,
  resolveStorm,
  resolveWater,
  xpFor,
} from "@/lib/market/predictions";
import type { MarketEngine } from "@/lib/market/engine";

let toastId = 0;
const toast = (text: string, tone: "win" | "loss" | "neutral") =>
  useBattle.setState({ toast: { id: ++toastId, text, tone } });

function startRound(engine: MarketEngine, idx: number, id: number): Round | null {
  const now = Date.now();
  for (let k = 0; k < ROTATION.length; k++) {
    const kind = ROTATION[(idx + k) % ROTATION.length]!;
    const base = { id, kind, startedAt: now, endsAt: now + DURATION[kind] };
    if (kind === "hold") {
      const side = id % 2 === 0 ? "bid" : "ask";
      const list = side === "bid" ? engine.bids : engine.asks;
      const b = list.find((l) => l.tier === "battleship");
      if (!b) continue;
      return { ...base, side, price: b.price };
    }
    if (kind === "water") {
      if (!engine.mark) continue;
      return { ...base, startMark: engine.mark };
    }
    if (engine.closes.length < 3) continue;
    return { ...base, startVol: engine.volBps };
  }
  return null;
}

/** Drives rotating XP-only prediction rounds from real market outcomes. */
export function usePredictionRounds() {
  const idx = useRef(0);
  const nextAt = useRef(0);
  const symbol = useBattle((s) => s.symbol);

  useEffect(() => {
    loadProgress();
  }, []);

  // hold-breaker listener per engine
  useEffect(() => {
    let off: (() => void) | undefined;
    const t = setInterval(() => {
      const e = engineRef.current;
      if (!e || off) return;
      off = e.onEvent((ev) => {
        const r = useBattle.getState().round;
        if (r?.kind === "hold" && !r.failed && r.side && r.price !== undefined && holdBroken(ev, r.side, r.price))
          useBattle.setState({ round: { ...r, failed: true } });
      });
    }, 200);
    return () => {
      clearInterval(t);
      off?.();
    };
  }, [symbol]);

  useEffect(() => {
    nextAt.current = Date.now() + 2500;
    const iv = setInterval(() => {
      const st = useBattle.getState();
      const e = engineRef.current;
      const now = Date.now();
      const r = st.round;
      if (st.status !== "live" || !e) {
        if (r) {
          useBattle.setState({ round: null });
          toast("Round void: market stream interrupted", "neutral");
        }
        return;
      }
      if (!r) {
        if (now < nextAt.current || !st.hud.hasBook) return;
        const nr = startRound(e, idx.current, idx.current + 1);
        idx.current++;
        if (nr) useBattle.setState({ round: nr });
        return;
      }
      if (now < r.endsAt) return;
      let outcome: "a" | "b" | null;
      if (r.kind === "hold") outcome = resolveHold(!!r.failed);
      else if (r.kind === "water") outcome = resolveWater(r.startMark ?? 0, e.mark);
      else outcome = resolveStorm(r.startVol ?? 0, e.volBps);
      const label =
        r.kind === "hold"
          ? outcome === "a" ? "Battleship held" : "Battleship fell"
          : r.kind === "water"
            ? outcome === "a" ? "Bulls gained water" : outcome === "b" ? "Bears gained water" : "No change in the line"
            : outcome === "a" ? "Storm rising" : "Sea stayed calmer";
      if (!r.choice) toast(`${label}. Pick a side next round to earn XP.`, "neutral");
      else if (outcome === null) toast(`${label}. Push, no XP change.`, "neutral");
      else if (outcome === r.choice) {
        const streak = st.streak + 1;
        const gain = xpFor(st.streak);
        useBattle.setState({ xp: st.xp + gain, streak, best: Math.max(st.best, streak) });
        toast(`${label}. +${gain} XP`, "win");
      } else {
        useBattle.setState({ streak: 0 });
        toast(`${label}. Streak reset.`, "loss");
      }
      saveProgress();
      useBattle.setState({ round: null });
      nextAt.current = now + 3000;
    }, 250);
    return () => clearInterval(iv);
  }, [symbol]);
}

export function choose(c: "a" | "b") {
  const r = useBattle.getState().round;
  if (!r || r.choice) return;
  useBattle.setState({ round: { ...r, choice: c } });
}
