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
import { canNarrateRelocate, lessonForEvent, lessonText, selectShot, tapeEligible } from "@/lib/market/presentation";
import { makeLadder } from "./LivePanels";
import { settleMine, submitPrediction } from "@/lib/market/community.functions";
import { supabase } from "@/integrations/supabase/client";
import { line, navyPriceParts, navySizeParts, phrase, words, type FleetCallsign, type NavalRole, type VoiceChain, type VoiceChannel } from "@/lib/audio/navalVoice";

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
  flaghit: ["All guns, fire at will! The flagship is hit!"],
  fighter: ["Fighter inbound, strafing the line!"],
  capital: ["Capital ship on the surface!"],
  start: ["Contact! New battle, all stations report."],
  warn: ["Thirty seconds! Push forward!"],
  end: ["Cease fire. Damage report."],
  surface: ["Sub surfacing, starboard side!"],
  flagsunk: ["Flagship is going down!"],
  liq: ["Bombers overhead! Take cover!"],
  cap_commence: ["Main battery, commence firing!"],
  cap_holdline: ["Hold the line! Do not give them an inch!"],
  cap_stations: ["Battle stations! All hands to battle stations!"],
  adm_openfire: ["All ships, open fire! Sink them!"],
  adm_break: ["Break their line! Full speed ahead!"],
  adm_withdraw: ["Withdraw! Lay smoke and fall back!"],
  spot_hit: ["Direct hit! Direct hit!"],
  spot_splash: ["Splash! Short. Add two hundred!"],
  spot_aircraft: ["Enemy aircraft, two o'clock high!"],
  spot_sonar: ["Sonar contact! She's diving!"],
  spot_fire: ["Fire on the main deck! Damage control, move!"],
  spot_breaking: ["She's breaking apart! She's going under!"],
};

const pageStart = Date.now();
let firstKill = false;
let lastClip = 0;
let lastRelocateTape = 0;
let lastCut = 0;
const flagState: Record<BookSide, { b: number; since: number; gone: null | { status: FlagSnap["status"]; t: number; snap: FlagSnap } }> = {
  bid: { b: NaN, since: 0, gone: null },
  ask: { b: NaN, since: 0, gone: null },
};
const flagEvents: { type: string; b: number; side: string }[] = [];
const damageCalled = new Set<string>();

function pushTape(kind: string, text: string, tone: TapeLine["tone"], notional = 0, ids?: { first: number; last: number }) {
  const line: TapeLine = { id: nextId(), t: Date.now(), kind, text, tone, notional, ...(ids ? { firstAggId: ids.first, lastAggId: ids.last } : {}) };
  view.tapeTotal++;
  useBattle.setState((s) => ({ tape: [line, ...s.tape].slice(0, 120) }));
}
function callout(text: string, tone: "buy" | "sell" | "liq" | "info", slow = false) {
  useBattle.setState({ callout: { id: nextId(), text, tone, slow } });
}
const speakerFor = (key: string): "captain" | "admiral" | "spotter" => key.startsWith("cap_") ? "captain" : key.startsWith("adm_") ? "admiral" : "spotter";
function radio(key: string, detail?: string, afterQuietSeconds = 0) {
  const lines = RADIO[key];
  if (!lines) return;
  if (afterQuietSeconds && !audio.hasVoiceBeenQuiet(afterQuietSeconds)) return;
  const text = lines[Math.floor(Math.random() * lines.length)]!;
  useBattle.setState({ radio: { id: nextId(), text, speaker: speakerFor(key), ...(detail ? { detail } : {}) } });
  if (key !== "P1") void audio.voice(key, text); // P1 is subtitle-only
}
const callsign = (side: BookSide): FleetCallsign => side === "bid" ? "Bull Fleet" : "Bear Fleet";
function naval(id: string, priority: number, channel: VoiceChannel, fleet: FleetCallsign | undefined, detail: string, lines: VoiceChain["lines"]) {
  const chain: VoiceChain = { id: `${id}:${Date.now()}`, priority, channel, lines, ...(fleet ? { fleet } : {}), detail };
  const speaker = lines[0]?.role === "Captain" ? "captain" : fleet === "Bear Fleet" ? "admiral" : "spotter";
  useBattle.setState({ radio: { id: nextId(), text: audio.describeVoiceChain(chain), speaker, detail } });
  audio.enqueueVoiceChain(chain);
}
function orderReadout(ev: Extract<BattleEvent, { type: "fire" }>, targetTier?: string) {
  const fleet = callsign(ev.target);
  naval("flagship-target", 80, "phone", fleet, `${usd(ev.notional)} at ${fmtPrice(ev.price)}`, [
    line("Fire Control", phrase("fire_control_enemy_flagship_range", `Enemy ${targetTier ?? "ship"}, range`), ...navyPriceParts(ev.price), ...navySizeParts(ev.notional)),
    line("Captain", phrase("captain_commence_firing", "Commence firing")),
    line("Gunnery Officer", phrase("gunnery_firing", "Firing")),
  ]);
}
/** cumulative damage per flagship, announced each time another 25 % of its peak size is traded */
const flagHits: Record<string, { b: number; dmg: number; told: number }> = {};
/** First sound enable: radio check with subtitle. */
export function radioCheck() {
  useBattle.setState({ radio: { id: nextId(), text: RADIO["cap_stations"]![0]!, speaker: "captain", detail: "Radio circuit open · live BTCUSDT battle" } });
  audio.radioCheck();
  audio.openingAdvance();
  naval("battle-start", 100, "1mc", "Bull Fleet", "Opening fleet advance", [
    line("1MC", phrase("1mc_general_quarters", "General quarters, all hands man your battle stations")),
    line("Captain", phrase("captain_set_condition_zebra", "Set condition Zebra")),
  ]);
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
    case "fire": {
      const target = view.displays.get(ev.target + ev.b);
      if (target?.tier === "battleship" && ev.notional >= 250_000) orderReadout(ev, "flagship");
      if (ev.notional < 250_000) break;
      const sideName = ev.target === "bid" ? "Buyers'" : "Sellers'";
      const detail = `${usd(ev.notional)} ${ev.taker} order ${target ? `hit the ${sideName} ${target.tier}` : "splashed between levels"} at ${fmtPrice(ev.price)}`;
      radio(target ? "spot_hit" : "spot_splash", detail);
      naval(target ? "hit" : "splash", 45, "tbs", callsign(ev.target), detail, [line("Lookout/Spotter", phrase(target ? "spotter_hit" : "spotter_splash_short_up_two_hundred", target ? "Hit! Hit!" : "Splash, short. Up two hundred"))]);
      break;
    }
    case "order":
      if (ev.notional >= 250_000) pushTape("SHOT", `${ev.taker === "buy" ? "Sellers'" : "Buyers'"} line hit by ${usd(ev.notional)} ${ev.taker} · ${ev.fills} rounds · #a ${ev.firstAggId}${ev.lastAggId === ev.firstAggId ? "" : `–${ev.lastAggId}`}`, ev.taker === "buy" ? "buy" : "sell", ev.notional, { first: ev.firstAggId, last: ev.lastAggId });
      if (ev.notional >= 1_000_000) callout(`${usd(ev.notional)} ${ev.taker.toUpperCase()} · BROADSIDE`, ev.taker === "buy" ? "buy" : "sell");
      break;
    case "fighter":
      radio("spot_aircraft", `${ev.formation} aircraft launched by ${usd(ev.notional)} of ${ev.taker} orders across ${ev.buckets.length} price levels`, 30);
      pushTape("FIGHTER", `${ev.formation}-FIGHTER wave · taker ${ev.taker} ${usd(ev.notional)} · ${ev.buckets.length} rows${ev.queuedOrders > 1 ? ` · ${ev.queuedOrders} orders queued` : ""}`, ev.taker === "buy" ? "buy" : "sell", ev.notional);
      naval("fighter", 75, "tbs", callsign(ev.target), `${ev.formation} aircraft · ${usd(ev.notional)}`, [line("Radar/CIC", phrase("radar_bogeys_inbound_angels_two", "Bogeys inbound, angels two")), line("Captain", phrase("captain_aa_batteries_open_fire", "AA batteries, open fire"))]);
      break;
    case "sink":
      pushTape("SUNK", `SUNK ${fleet} ${ev.tier} ${usd(ev.notional)} at ${fmtPrice(ev.price)}`, side === "bid" ? "buy" : "sell", ev.notional);
      if (!firstKill) {
        firstKill = true;
        track("first_kill_seen", Math.round((Date.now() - pageStart) / 1000));
      }
      flagEvents.push(ev);
      if (ev.tier === "battleship") {
        fx.slowmo = 2; fx.slowScale = 0.3;
        callout(`${fleet.toUpperCase()}' FLAGSHIP SUNK`, side === "bid" ? "sell" : "buy", true);
        radio("spot_breaking", `${fleet}' flagship at ${fmtPrice(ev.price)} was fully traded`);
        triggerClip(`${fleet}' flagship sunk`);
        naval("flagship-sunk", 95, "tbs", callsign(ev.side), `${fleet} flagship at ${fmtPrice(ev.price)}`, [line("Lookout/Spotter", phrase("lookout_shes_going_under", "She's going under")), line("Captain", phrase("captain_abandon_ship", "Abandon ship"))]);
      } else radio("spot_breaking", `${fleet}' ${ev.tier} worth ${usd(ev.notional)} sank at ${fmtPrice(ev.price)}`);
      break;
    case "dive":
    case "fled": {
      const label = ev.type === "dive" ? "GHOST" : "FLED";
      pushTape(label, `${label} ${usd(ev.notional)} at ${fmtPrice(ev.price)} · lived ${(ev.lived / 1000).toFixed(1)}s${ev.neverHit ? " · never hit" : ""}`, "sub", ev.notional);
      flagEvents.push(ev);
      if (ev.tier === "battleship") callout(`${fleet.toUpperCase()}' FLAGSHIP ${ev.type === "dive" ? "DIVED" : "FLED"}`, "info");
      if (ev.tier === "battleship" || ev.tier === "cruiser") radio("spot_sonar", `${fleet}' ${ev.tier} ${ev.type === "fled" ? "withdrew" : "dived"} at ${fmtPrice(ev.price)}`);
      break;
    }
    case "damage": {
      if (!side) break;
      const f = engineRef.current?.flagship(side);
      const d = view.displays.get(side + ev.b);
      const damageKey = `${side}:${ev.b}`;
      if (d && ev.hp <= 0.5 && !damageCalled.has(damageKey)) { damageCalled.add(damageKey); const detail = `${fleet}' ${d.tier} lost ${Math.round((1 - ev.hp) * 100)}% at ${fmtPrice(ev.price)} after a ${usd(ev.notional)} hit`; radio("spot_fire", detail); naval("damage", 60, "phone", callsign(ev.side), detail, [line("Damage Control", phrase("damage_fire_main_deck_frame_forty", "Fire on the main deck, frame forty"))]); }
      if (!f || f.b !== ev.b) break;
      const h = flagHits[side]?.b === ev.b ? flagHits[side]! : (flagHits[side] = { b: ev.b, dmg: 0, told: 0 });
      h.dmg += ev.filled;
      const step = Math.floor(h.dmg / Math.max(f.peak, 1e-9) / 0.25);
      if (step > h.told) { h.told = step; radio("flaghit"); callout(`${fleet.toUpperCase()}' FLAGSHIP HIT · ${Math.min(100, step * 25)}% HP LOST`, side === "bid" ? "sell" : "buy"); }
      break;
    }
    case "pulled":
      if (side) damageCalled.delete(`${side}:${ev.b}`);
      flagEvents.push(ev);
      if (side && ev.notional >= 1_000_000) naval("contact-lost", 55, "phone", callsign(side), `${usd(ev.notional)} at ${fmtPrice(ev.price)}`, [line("Sonar", phrase("sonar_contact_diving_contact_lost", "Contact diving, contact lost"))]);
      break;
    case "relocate":
      if (ev.notional >= 1_000_000) radio("spot_sonar", `${fleet}' ${usd(ev.notional)} order relocated from ${fmtPrice(ev.fromPrice)} to ${fmtPrice(ev.price)}`);
      if (ev.notional >= 1_000_000) naval("contact-resurface", 58, "phone", callsign(ev.side), `${fmtPrice(ev.fromPrice)} → ${fmtPrice(ev.price)}`, [line("Sonar", phrase("sonar_contact_resurfacing_bearing", "Contact resurfacing, bearing"), ...navyPriceParts(ev.price))]);
      if (canNarrateRelocate(Date.now(), lastRelocateTape)) { lastRelocateTape = Date.now(); pushTape("RELOCATE", `${fleet}' ${usd(ev.notional)} surfaced ${fmtPrice(ev.fromPrice)} → ${fmtPrice(ev.price)}`, "sub", ev.notional); }
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
      radio("spot_aircraft", `${usd(ev.notional)} ${what.toLowerCase()} liquidation struck at ${fmtPrice(ev.price)}`);
      naval("liquidation", 85, "tbs", ev.liquidated === "longs" ? "Bull Fleet" : "Bear Fleet", `${what} ${usd(ev.notional)} at ${fmtPrice(ev.price)}`, [line("Lookout/Spotter", phrase("lookout_bombers_overhead", "Bombers overhead"))]);
      break;
    }
    case "phase":
      audio.setPhase(ev.phase);
      if (ev.phase === "P6") {
        const buyersPushing = (engineRef.current?.priceChange5m ?? 0) > 0;
        radio(buyersPushing ? (ev.detail === "fall back" ? "adm_withdraw" : Math.random() < 0.5 ? "cap_commence" : "cap_holdline") : (ev.detail === "fall back" ? "cap_holdline" : Math.random() < 0.5 ? "adm_openfire" : "adm_break"));
      }
      else {
        const phaseLine: Partial<Record<string, string>> = { P2: "cap_stations", P3: "adm_openfire", P4: "cap_commence", P5: "cap_holdline", P7: "adm_withdraw" };
        const key = phaseLine[ev.phase];
        if (key) radio(key);
      }
      if (ev.phase === "P5") naval("cascade", 90, "1mc", undefined, "Liquidation cascade", [line("1MC", phrase("1mc_brace_for_impact", "Brace for impact")), line("Damage Control", phrase("damage_flooding_counter_flood", "Flooding! Counter-flood"))]);
      if (ev.phase === "P7") naval("battle-end", 88, "tbs", undefined, "Battle end", [line("Captain", phrase("captain_cease_fire_secure_gq", "Cease fire. Secure from general quarters"))]);
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
    let warned = true;
    let biggest = { notional: 0, text: "" };
    const iv = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      if (bound !== e) {
        off?.();
        bound = e;
        off = e.onEvent((ev) => {
          try {
            if (ev.type === "fire" && ev.notional > biggest.notional) biggest = { notional: ev.notional, text: `${ev.taker === "buy" ? "Buyers" : "Sellers"} fired $${(ev.notional / 1e6).toFixed(2)}M (${ev.weapon})` };
            const shot = selectShot(ev, performance.now(), lastCut, view.shot);
            if (shot && useBattle.getState().presentation === "cinema") { lastCut = shot.at; view.shot = shot; }
            const bookEvent = ["reinforce", "dive", "fled", "relocate", "hidden", "repair"].includes(ev.type);
            if (!bookEvent || tapeEligible(ev, e.mark, e.bucketSampler.quantile(0.9))) onEvent(ev);
            const kind = lessonForEvent(ev);
            if (kind && Date.now() - pageStart <= 180_000 && localStorage.getItem(`nms-lesson-${kind}`) !== "1") {
              const text = lessonText(ev);
              if (text) {
                localStorage.setItem(`nms-lesson-${kind}`, "1"); fx.slowmo = 1; fx.slowScale = 0.3;
                view.lessonTarget = ev.type === "fighter" || ev.type === "liquidation" ? { kind: "plane" } : "b" in ev && "side" in ev ? { kind: "ship", side: ev.side, b: ev.b } : ev.type === "fire" ? { kind: "ship", side: ev.target, b: ev.b } : null;
                useBattle.setState({ lesson: { id: nextId(), kind, text } });
                setTimeout(() => { if (useBattle.getState().lesson?.kind === kind) { useBattle.setState({ lesson: null }); view.lessonTarget = null; } }, 5000);
              }
            }
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
            useBattle.setState({ scoreboard: sb, result: { id: nextId(), winner, startMark: battle.startMark, endMark: e.mark, pick: st.round?.kind === "winner" && st.round.battleId === battle.id ? (st.round.choice as string | undefined) : undefined, streak: st.streak, biggest: biggest.text } });
          }
          biggest = { notional: 0, text: "" };
          if (watchedAll) track("battle_watched_to_end");
          const r = st.round;
          if (r && r.kind === "winner" && r.battleId === battle.id)
            settle(r, winner === "draw" ? null : winner, winner === "draw" ? "Battle drawn" : `${winner === "buyers" ? "Buyers" : "Sellers"} won the battle`);
        }
        if (battle.id) radio("end");
        battle = { id: w.id, end: w.end, startMark: e.mark, watchedFrom: now };
        audio.play("klaxon");
        setTimeout(() => { audio.play("bosun"); radio("cap_stations", `Battle opened at BTC ${fmtPrice(e.mark)}`); }, 900);
        warned = false;
        const r: Round = { id: nextId(), kind: "winner", startedAt: now, endsAt: w.end, battleId: w.id, lockAt: Math.min(w.end, w.start + PICK_WINDOW_MS) };
        useBattle.setState({ round: r });
      }

      if (!warned && battle.end && battle.end - now <= 30_000) { warned = true; radio("warn"); }
      // war ambience density from the real trade rate and phase
      const recent = e.recentTrades.filter((t) => now - t.time < 5000).length;
      audio.setIntensity(recent / 40 + (e.phase.current === "P5" ? 0.6 : e.phase.current === "P4" || e.phase.current === "P3" ? 0.25 : 0));
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
        ladder: { bids: makeLadder(e.book.bids, "bid", e.mark, st.bookGroup), asks: makeLadder(e.book.asks, "ask", e.mark, st.bookGroup) },
        bookSync: e.bookCheck.lastAt ? { ok: e.bookCheck.lastOk && e.book.synced, at: e.bookCheck.lastAt } : null,
        recentTrades: e.recentTrades.slice(0, 80),
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
      const alerts = useBattle.getState().alertsOn && typeof Notification !== "undefined" && Notification.permission === "granted";
      if (alerts) {
        const near = [fb, fa].find((f) => f && f.status === "on station" && f.away <= 0.0005);
        const key = near ? `flag-${near.side}-${near.b}` : e.phase.current === "P5" ? `cascade-${battle.id}` : battle.end - now <= 30_000 && battle.end - now > 29_500 ? `ending-${battle.id}` : "";
        if (key && sessionStorage.getItem(`nms-alert-${key}`) !== "1") { sessionStorage.setItem(`nms-alert-${key}`, "1"); new Notification("No Man's Sea", { body: near ? `${near.side === "bid" ? "Buyers'" : "Sellers'"} flagship is within 0.05% of price.` : e.phase.current === "P5" ? "A liquidation cascade has started." : "Battle ends in 30 seconds." }); }
      }
    }, 250);
    return () => {
      clearInterval(iv);
      off?.();
    };
  }, []);
}

export async function choose(kind: "round" | "flagRound", c: Choice) {
  const r = useBattle.getState()[kind];
  if (!r || r.choice || (r.lockAt && Date.now() > r.lockAt)) return;
  useBattle.setState({ [kind]: { ...r, choice: c } } as never);
  track("prediction_made", `${r.kind}:${c}`);
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  try {
    await submitPrediction({ data: { roundKey: `${r.kind}:${r.battleId ?? r.startedAt}:${r.side ?? "battle"}:${r.b ?? 0}`, roundKind: r.kind, battleId: r.battleId ?? battleWindow(r.startedAt).id, choice: c, ...(r.side ? { side: r.side } : {}), ...(r.b !== undefined ? { bucket: r.b } : {}), ...(r.price ? { price: r.price } : {}), startsAt: r.startedAt, endsAt: r.endsAt } });
    // The observing client asks the server to settle shortly after the round ends; the server recomputes from Binance.
    const delay = Math.max(0, r.endsAt - Date.now()) + 65_000;
    setTimeout(() => void settleMine().catch(() => {}), delay);
  } catch (err) {
    toast(err instanceof Error ? err.message : "Could not lock prediction", "loss");
  }
}
