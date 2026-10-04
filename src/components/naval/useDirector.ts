import { useEffect } from "react";
import { engineRef, fx, nextId, safeSet, saveProgress, toast, useBattle, type FlagSnap, type TapeLine } from "@/lib/market/store";
import { FLAG_ROUND_MS, PICK_WINDOW_MS, fmtPrice, usd, xpFor, type Choice, type Round } from "@/lib/market/predictions";
import type { BattleEvent, BookSide } from "@/lib/market/types";
import { FLEET_NAME } from "@/lib/market/types";
import { battleWindow, battleWinner, recordResult } from "@/lib/battle/round";
import { audio } from "@/lib/audio/engine";
import { track } from "@/lib/analytics";
import { recordClip } from "@/lib/clips";
import { view } from "./layout";

export const RADIO: Record<string, string[]> = {
  P1: ["All quiet on the line. Hold position."],
  P2: ["Contact, bearing zero-niner-zero.", "Contact! Enemy ships on the move."],
  P3: ["All guns, fire at will!"],
  P4: ["Capital ship on the surface!"],
  P5: ["Brace, brace, brace!"],
  P6push: ["Push forward!"],
  P6fall: ["Fall back! Fall back!"],
  P7: ["Cease fire. Damage report."],
  dive: ["Dive, dive, dive!"],
  surface: ["Sub surfacing, starboard side!"],
  flagsunk: ["Flagship is going down!"],
  liq: ["Bombers overhead! Take cover!"],
};

const pageStart = Date.now();
let firstKill = false;
let lastClip = 0;
const flagState: Record<BookSide, { b: number; since: number; gone: null | { status: FlagSnap["status"]; t: number; snap: FlagSnap } }> = {
  bid: { b: NaN, since: 0, gone: null },
  ask: { b: NaN, since: 0, gone: null },
};
const flagEvents: { type: string; b: number; side: string }[] = [];

function pushTape(kind: string, text: string, tone: TapeLine["tone"], notional = 0) {
  const line: TapeLine = { id: nextId(), t: Date.now(), kind, text, tone, notional };
  useBattle.setState((s) => ({ tape: [line, ...s.tape].slice(0, 120) }));
}
function callout(text: string, tone: "buy" | "sell" | "liq" | "info", slow = false) {
  useBattle.setState({ callout: { id: nextId(), text, tone, slow } });
}
function radio(key: string) {
  const lines = RADIO[key];
  if (!lines) return;
  const text = lines[Math.floor(Math.random() * lines.length)]!;
  useBattle.setState({ radio: { id: nextId(), text } });
  if (key !== "P1") void audio.voice(key, text); // P1 is subtitle-only
}

export function triggerClip(title: string) {
  const now = Date.now();
  if (now - lastClip < 60_000) return;
  lastClip = now;
  const canvas = document.querySelector<HTMLCanvasElement>("#battle-canvas canvas");
  if (!canvas) return;
  const vertical = view.frameMs < 40; // skip 9:16 when frame time is degraded
  void recordClip({
    source: canvas,
    audio: audio.recordDest?.stream ?? null,
    vertical,
    banner: () => {
      const m = engineRef.current?.mark ?? 0;
      return `${title} · BTC ${fmtPrice(m)} · ${new Date().toISOString().slice(11, 19)} UTC`;
    },
  }).then((files) => {
    if (files) useBattle.setState({ clip: { id: nextId(), title, files } });
  });
}

function onEvent(ev: BattleEvent) {
  const side = "side" in ev ? ev.side : null;
  const fleet = side ? FLEET_NAME[side] : "";
  switch (ev.type) {
    case "order":
      if (ev.notional >= 50_000)
        pushTape("SHOT", `SHOT taker ${ev.taker} ${usd(ev.notional)} · ${ev.fills} fills · avg ${fmtPrice(ev.avg)}`, ev.taker === "buy" ? "buy" : "sell", ev.notional);
      if (ev.notional >= 1_000_000) callout(`${usd(ev.notional)} ${ev.taker.toUpperCase()} · BROADSIDE`, ev.taker === "buy" ? "buy" : "sell");
      break;
    case "fighter":
      pushTape("FIGHTER", `FIGHTER strafing run · taker ${ev.taker} ${usd(ev.notional)} · ${ev.buckets.length} rows`, ev.taker === "buy" ? "buy" : "sell", ev.notional);
      break;
    case "sink":
      pushTape("SUNK", `SUNK ${fleet} ${ev.tier} ${usd(ev.notional)} at ${fmtPrice(ev.price)}`, side === "bid" ? "buy" : "sell", ev.notional);
      if (!firstKill) {
        firstKill = true;
        track("first_kill_seen", Math.round((Date.now() - pageStart) / 1000));
      }
      flagEvents.push(ev);
      if (ev.tier === "battleship") {
        fx.slowmo = 1.2;
        callout(`${fleet.toUpperCase()}' FLAGSHIP SUNK`, side === "bid" ? "sell" : "buy", true);
        radio("flagsunk");
        triggerClip(`${fleet}' flagship sunk`);
      }
      break;
    case "dive":
    case "fled": {
      const label = ev.type === "dive" ? "GHOST" : "FLED";
      pushTape(label, `${label} ${usd(ev.notional)} at ${fmtPrice(ev.price)} · lived ${(ev.lived / 1000).toFixed(1)}s${ev.neverHit ? " · never hit" : ""}`, "sub", ev.notional);
      flagEvents.push(ev);
      if (ev.tier === "battleship") callout(`${fleet.toUpperCase()}' FLAGSHIP ${ev.type === "dive" ? "DIVED" : "FLED"}`, "info");
      if (ev.tier === "battleship" || ev.tier === "cruiser") radio("dive");
      break;
    }
    case "pulled":
      flagEvents.push(ev);
      break;
    case "relocate":
      if (ev.notional >= 1_000_000) radio("surface");
      pushTape("RELOCATE", `RELOCATE (inferred) ${usd(ev.notional)} ${fmtPrice(ev.fromPrice)} → ${fmtPrice(ev.price)}`, "sub", ev.notional);
      break;
    case "hidden":
      pushTape("HIDDEN", `HIDDEN (inferred, possible iceberg) ${usd(ev.notional)} at ${fmtPrice(ev.price)}`, "sub", ev.notional);
      break;
    case "reinforce":
      if (ev.notional >= (ev.fresh ? 3_000_000 : 5_000_000)) pushTape("REINFORCE", `REINFORCE ${fleet} +${usd(ev.notional)} at ${fmtPrice(ev.price)}`, side === "bid" ? "buy" : "sell", ev.notional);
      break;
    case "repair":
      pushTape("REPAIR", `REPAIR (inferred) ${fleet} at ${fmtPrice(ev.price)}`, "info");
      break;
    case "liquidation": {
      const what = ev.liquidated === "longs" ? "LONG" : "SHORT";
      pushTape("AIR STRIKE", `AIR STRIKE · ${what} LIQUIDATED ${usd(ev.notional)} at ${fmtPrice(ev.price)}`, "liq", ev.notional);
      callout(`AIR STRIKE · ${what} LIQUIDATED ${usd(ev.notional)}`, "liq");
      radio("liq");
      break;
    }
    case "phase":
      audio.setPhase(ev.phase);
      if (ev.phase === "P6") radio(ev.detail === "fall back" ? "P6fall" : "P6push");
      else radio(ev.phase);
      if (ev.phase === "P5") triggerClip("Liquidation cascade");
      break;
  }
}

function flagSnap(side: BookSide, now: number): FlagSnap | null {
  const e = engineRef.current!;
  const f = e.flagship(side);
  const st = flagState[side];
  if (f) {
    if (f.b !== st.b) {
      st.b = f.b;
      st.since = f.bornAt;
    }
    const snap: FlagSnap = { side, b: f.b, price: f.price, notional: f.notional, hp: f.qty, peak: f.peak, away: e.ref ? Math.abs(f.price - e.ref) / e.ref : 0, since: st.since, status: "on station" };
    st.gone = null;
    return snap;
  }
  return st.gone && now - st.gone.t < 6000 ? { ...st.gone.snap, status: st.gone.status, hp: 0 } : null;
}

function settle(r: Round, outcome: Choice | null, label: string) {
  const st = useBattle.getState();
  if (!r.choice) toast(`${label}. Pick next time to earn XP.`, "neutral");
  else if (outcome === null) toast(`${label}. Push, no XP change.`, "neutral");
  else if (outcome === r.choice) {
    const gain = xpFor(st.streak);
    const streak = st.streak + 1;
    useBattle.setState({ xp: st.xp + gain, streak, best: Math.max(st.best, streak) });
    toast(`${label}. +${gain} XP`, "win");
  } else {
    useBattle.setState({ streak: 0 });
    toast(`${label}. Streak reset.`, "loss");
  }
  saveProgress();
}

/** Event narration, battle clock, flagships, prediction rounds and the HUD snapshot. */
export function useDirector() {
  useEffect(() => {
    let off: (() => void) | undefined;
    let bound: unknown = null;
    let battle = { id: 0, end: 0, startMark: 0, watchedFrom: 0 };
    const iv = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      if (bound !== e) {
        off?.();
        bound = e;
        off = e.onEvent((ev) => {
          try {
            onEvent(ev);
          } catch (err) {
            console.error("[director]", err);
          }
        });
      }
      const now = Date.now();
      e.heartbeat(now);
      e.walls.tick(250, now);
      const st = useBattle.getState();

      // remember departing flagships for the HP bar status
      for (const side of ["bid", "ask"] as const) {
        const fs = flagState[side];
        if (!Number.isNaN(fs.b) && !e.trackers[side].ships.has(fs.b) && !fs.gone) {
          const last = [...flagEvents].reverse().find((x) => x.side === side && x.b === fs.b);
          const status: FlagSnap["status"] = last?.type === "sink" ? "SUNK" : last?.type === "fled" ? "FLED" : "DIVED";
          fs.gone = { status, t: now, snap: { side, b: fs.b, price: 0, notional: 0, hp: 0, peak: 1, away: 0, since: fs.since, status } };
          fs.b = NaN;
        }
      }
      if (flagEvents.length > 200) flagEvents.splice(0, flagEvents.length - 200);

      // battle clock
      const w = battleWindow(now);
      if (e.mark > 0 && battle.id !== w.id) {
        if (battle.id && battle.startMark) {
          const winner = battleWinner(battle.startMark, e.mark);
          const watchedAll = battle.watchedFrom <= battle.id + 5_000;
          if (now - battle.watchedFrom >= 60_000) {
            const sb = recordResult(st.scoreboard, winner, battle.id);
            safeSet("nms-scoreboard-v1", sb);
            useBattle.setState({ scoreboard: sb, result: { id: nextId(), winner, startMark: battle.startMark, endMark: e.mark } });
          }
          if (watchedAll) track("battle_watched_to_end");
          const r = st.round;
          if (r && r.kind === "winner" && r.battleId === battle.id)
            settle(r, winner === "draw" ? null : winner, winner === "draw" ? "Battle drawn" : `${winner === "buyers" ? "Buyers" : "Sellers"} won the battle`);
        }
        battle = { id: w.id, end: w.end, startMark: e.mark, watchedFrom: now };
        const r: Round = { id: nextId(), kind: "winner", startedAt: now, endsAt: w.end, battleId: w.id, lockAt: Math.min(w.end, w.start + PICK_WINDOW_MS) };
        useBattle.setState({ round: r });
      }

      // flagship SUNK / DIVE / HOLD rounds
      const fr = st.flagRound;
      if (st.status !== "live") {
        if (fr) useBattle.setState({ flagRound: null });
      } else if (!fr) {
        const side: BookSide = Math.floor(now / FLAG_ROUND_MS) % 2 ? "bid" : "ask";
        const f = e.flagship(side);
        if (f && now % FLAG_ROUND_MS < 20_000)
          useBattle.setState({ flagRound: { id: nextId(), kind: "flagship", startedAt: now, endsAt: now + FLAG_ROUND_MS, side, b: f.b, price: f.price, lockAt: now + 15_000 } });
      } else {
        const hits = flagEvents.filter((x) => x.side === fr.side && x.b === fr.b);
        const outcome = hits.some((h) => h.type === "sink") ? "sunk" : hits.some((h) => h.type !== "sink") ? "dive" : null;
        if (outcome || now >= fr.endsAt) {
          const o = outcome ?? "hold";
          const name = fr.side === "bid" ? "Buyers'" : "Sellers'";
          settle(fr, o, `${name} flagship ${o === "sunk" ? "was sunk" : o === "dive" ? "dived" : "held"}`);
          useBattle.setState({ flagRound: null });
        }
      }

      // HUD snapshot (throttled React state)
      const flow = e.flowWindow(now);
      const fb = flagSnap("bid", now);
      const fa = flagSnap("ask", now);
      // NEXT TARGET: nearest flagship and the resting depth in front of it
      let nextTarget: { side: BookSide; price: number; depth: number } | null = null;
      for (const f of [fb, fa]) {
        if (!f || f.status !== "on station") continue;
        let depth = 0;
        for (const s of e.trackers[f.side].ships.values()) if (f.side === "ask" ? s.price < f.price : s.price > f.price) depth += s.notional;
        if (!nextTarget || f.away < Math.abs(nextTarget.price - e.ref) / e.ref) nextTarget = { side: f.side, price: f.price, depth };
      }
      useBattle.setState({
        hud: {
          mark: e.mark,
          last: e.mid,
          spread: e.spread,
          bestBid: e.bestBid,
          bestAsk: e.bestAsk,
          funding: e.funding,
          oi: e.oi,
          oiChangePct: e.oiChangePct,
          priceChange5m: e.priceChange5m,
          latency: e.lastMsgAt ? now - e.lastMsgAt : 0,
          ghostsHour: e.ghostsPerHour(now),
          ordersMin: e.ordersPerMinute(now),
          lastLiq: e.lastLiq,
          volBps: e.volBps,
          convoy: e.convoy,
          hasBook: e.hasBook,
          partial: e.partial,
          flowBuy: flow.buy,
          flowSell: flow.sell,
          phase: e.phase.current,
          ships: { bid: view.visible.bid.length, ask: view.visible.ask.length },
          sunk: { ...e.sunkNotional },
          flags: { bid: fb, ask: fa },
          nextTarget,
          battle: { id: battle.id, end: battle.end, startMark: battle.startMark },
        },
      });
    }, 250);
    return () => {
      clearInterval(iv);
      off?.();
    };
  }, []);
}

export function choose(kind: "round" | "flagRound", c: Choice) {
  const r = useBattle.getState()[kind];
  if (!r || r.choice || (r.lockAt && Date.now() > r.lockAt)) return;
  useBattle.setState({ [kind]: { ...r, choice: c } } as never);
  track("prediction_made", `${r.kind}:${c}`);
}
