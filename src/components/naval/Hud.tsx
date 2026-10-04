import { AIRCRAFT, RULES_FACTS, SHIPS, WEAPONS } from "@/lib/battle/units";
import { HowItWorks, UnitIcon, UnitList } from "./Units";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Crosshair, Download, HelpCircle, Map, RotateCw, Share2, Volume2, VolumeX, X } from "lucide-react";
import { savePrefs, useBattle, type TapeLine } from "@/lib/market/store";
import { fmtPrice, questionText, usd, type Round } from "@/lib/market/predictions";
import { PHASE_NAME, intensityOf } from "@/lib/battle/phase";
import { regimeOf } from "@/lib/market/rules";
import { audio } from "@/lib/audio/engine";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { choose, radioCheck } from "./useDirector";
import { startFleetIntro, view } from "./layout";
import { Labels } from "./Labels";
import { Tour } from "./Tour";
import { DebugPanel } from "./DebugPanel";
import { Guard } from "./Guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GuidePanel, OrderBookPanel, RecentTradesPanel, TapePanel } from "./LivePanels";
import { CommunityPanel } from "./CommunityPanel";

function useNow(ms = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="hud-label">{label}</div>
      <div className="hud-num truncate text-xs text-foreground md:text-sm">{children}</div>
    </div>
  );
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function TugOfWar() {
  const { flowBuy, flowSell } = useBattle((s) => s.hud);
  const total = flowBuy + flowSell;
  const p = total ? flowBuy / total : 0.5;
  return (
    <div className="min-w-0 flex-1" data-tour="flow">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest">
        <span className="text-bull">Buyers {usd(flowBuy)}</span>
        <span className="text-muted-foreground">Order flow 60s</span>
        <span className="text-bear">{usd(flowSell)} Sellers</span>
      </div>
      <div className="relative mt-1 h-3 overflow-hidden rounded-sm bg-secondary">
        <div className="absolute inset-y-0 left-0 bg-bull transition-[width] duration-300" style={{ width: `${p * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-bear transition-[width] duration-300" style={{ width: `${(1 - p) * 100}%` }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/70" />
      </div>
    </div>
  );
}

function SoundControl() {
  const { soundOn, volume } = useBattle(useShallow((s) => ({ soundOn: s.soundOn, volume: s.volume })));
  const toggle = async () => {
    try {
      await audio.unlock();
      const on = !soundOn;
      audio.setVolume(volume);
      audio.setEnabled(on);
      if (on) radioCheck();
      useBattle.setState({ soundOn: on });
      if (on) track("sound_on");
    } catch (err) {
      console.error("[audio]", err);
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={toggle} aria-label={soundOn ? "Mute sound" : "Turn sound on"} className="rounded bg-secondary p-1.5 text-foreground hover:bg-accent">
        {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>
      {soundOn && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume"
          onChange={(e) => {
            const v = +e.target.value;
            audio.setVolume(v);
            useBattle.setState({ volume: v });
            savePrefs();
          }}
          className="w-16 accent-[var(--primary)] md:w-20"
        />
      )}
    </div>
  );
}

function Header({ now }: { now: number }) {
  const { status, hud, scoreboard, presentation, alertsOn } = useBattle(useShallow((s) => ({ status: s.status, hud: s.hud, scoreboard: s.scoreboard, presentation: s.presentation, alertsOn: s.alertsOn })));
  const lat = hud.latency;
  const latTone = status !== "live" ? "text-muted-foreground" : lat > 10_000 ? "text-danger" : lat > 2000 ? "text-warn" : "text-ok";
  const intensity = intensityOf(hud.phase);
  const left = hud.battle.end && now ? hud.battle.end - now : 0;
  return (
    <header className="hud-panel pointer-events-auto p-2 md:p-2.5" data-tour="header">
      <div className="flex items-center gap-2 md:gap-4">
        <div className="flex min-w-0 shrink items-center gap-2">
          <h1 className="whitespace-nowrap font-display text-sm font-bold uppercase leading-none tracking-[0.1em] text-primary md:text-lg md:tracking-[0.16em]">No Man's Sea</h1>
          <span className={cn("hud-num flex items-center gap-1 text-[11px]", latTone)} title="Milliseconds since the last market message">
            <span className={cn("inline-block h-2 w-2 rounded-full", status === "live" ? "live-dot bg-ok" : "bg-muted-foreground")} />
            {status === "live" ? <>LIVE<span className="hidden md:inline"> · data {lat}ms</span></> : status === "connecting" ? "connecting" : "offline"}
          </span>
          {hud.partial && <span className="rounded bg-warn/20 px-1 text-[10px] font-semibold uppercase text-warn">partial book</span>}
        </div>
        <div className="hidden min-w-0 flex-1 md:block">
          <TugOfWar />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2" data-tour="clock">
          <div className="text-right">
            <div className="hud-label">Battle ends in</div>
            <div className="hud-num text-sm font-semibold text-foreground">{left > 0 ? mmss(left) : "—"}</div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="hud-label">Today</div>
            <div className="hud-num text-xs">
              <span className="text-bull">Buyers {scoreboard?.buyers ?? 0}</span> – <span className="text-bear">{scoreboard?.sellers ?? 0} Sellers</span>
            </div>
          </div>
          <button onClick={() => useBattle.setState({ helpOpen: true })} aria-label="How it works" className="rounded bg-secondary p-1.5 text-foreground hover:bg-accent">
            <HelpCircle className="h-4 w-4" />
          </button>
          <button onClick={() => { const next = presentation === "cinema" ? "map" : "cinema"; useBattle.setState({ presentation: next }); view.presentation = next; startFleetIntro(); audio.openingAdvance(); savePrefs(); }} aria-label={`Switch to ${presentation === "cinema" ? "map" : "cinema"} view`} className="flex items-center gap-1 rounded bg-secondary px-2 py-1.5 text-[10px] font-semibold uppercase text-foreground hover:bg-accent">
            <Map className="h-4 w-4" /> {presentation}
          </button>
          <button onClick={async () => { const on = !alertsOn; if (on && "Notification" in window) await Notification.requestPermission(); useBattle.setState({ alertsOn: on }); savePrefs(); }} aria-label={alertsOn ? "Disable alerts" : "Enable alerts"} className="rounded bg-secondary p-1.5 text-foreground hover:bg-accent">
            {alertsOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
          <SoundControl />
        </div>
      </div>
      <div className="mt-2 md:hidden">
        <TugOfWar />
      </div>
      <div className={cn("mt-1.5 grid grid-cols-4 gap-x-3 gap-y-1 md:grid-cols-9", presentation === "cinema" && "hidden")}>
        <Stat label="Last / mark">
          {hud.last ? fmtPrice(hud.last) : "—"}
          <span className="ml-1 text-muted-foreground">{hud.mark ? fmtPrice(hud.mark) : ""}</span>
        </Stat>
        <Stat label="Funding">
          <span className={hud.funding > 0 ? "text-bull" : hud.funding < 0 ? "text-bear" : ""}>{hud.mark ? `${(hud.funding * 100).toFixed(4)}%` : "—"}</span>
        </Stat>
        <Stat label="Open interest" className="hidden md:block">
          {hud.oi ? hud.oi.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : "—"}
          {hud.oi ? <span className={cn("ml-1", hud.oiChangePct >= 0 ? "text-ok" : "text-bear")}>{hud.oiChangePct >= 0 ? "+" : ""}{hud.oiChangePct.toFixed(2)}%</span> : null}
        </Stat>
        <Stat label="Orders/min" className="hidden md:block">{hud.ordersMin}</Stat>
        <Stat label="Intensity">
          <span className={intensity === "Extreme" ? "text-danger" : intensity === "Heavy" ? "text-warn" : ""}>{intensity}</span>
        </Stat>
        <Stat label="Sunk B / S" className="hidden md:block">
          <span className="text-bull">{usd(hud.sunk.bid)}</span> / <span className="text-bear">{usd(hud.sunk.ask)}</span>
        </Stat>
        <Stat label="Ships on map">{hud.ships.bid + hud.ships.ask}</Stat>
        <Stat label="Ghosts 1h" className="hidden md:block">{hud.ghostsHour}</Stat>
      </div>
    </header>
  );
}

const DATA_TABS = [["read", "How to read"], ["book", "Book"], ["trades", "Trades"], ["tape", "Tape"], ["guide", "Guide"], ["rankings", "Ranks"]] as const;
function DataPanels() {
  const tab = useBattle((s) => s.panelTab);
  return <Tabs value={tab} onValueChange={(v) => useBattle.setState({ panelTab: v as typeof tab })} className="hud-panel flex h-full min-h-0 flex-col p-1.5">
    <TabsList className="grid h-8 shrink-0 grid-cols-[1.7fr_repeat(5,1fr)] rounded bg-secondary/70 p-0.5">{DATA_TABS.map(([id, label]) => <TabsTrigger key={id} value={id} className="px-1 text-[10px] uppercase">{label}</TabsTrigger>)}</TabsList>
    <TabsContent value="read" className="min-h-0 flex-1 overflow-hidden"><HowToRead /></TabsContent>
    <TabsContent value="book" className="min-h-0 flex-1 overflow-hidden"><OrderBookPanel /></TabsContent>
    <TabsContent value="trades" className="min-h-0 flex-1 overflow-hidden"><RecentTradesPanel /></TabsContent>
    <TabsContent value="tape" className="min-h-0 flex-1 overflow-hidden"><TapePanel /></TabsContent>
    <TabsContent value="guide" className="min-h-0 flex-1 overflow-hidden"><GuidePanel /></TabsContent>
    <TabsContent value="rankings" className="min-h-0 flex-1 overflow-hidden"><CommunityPanel /></TabsContent>
  </Tabs>;
}

function Filters() {
  const { viewMode, filter } = useBattle(useShallow((s) => ({ viewMode: s.viewMode, filter: s.filter })));
  const set = (p: Partial<{ viewMode: typeof viewMode; filter: typeof filter }>) => {
    useBattle.setState(p);
    if (p.viewMode) view.viewMode = p.viewMode;
    if (p.filter) view.filter = p.filter;
    savePrefs();
  };
  useEffect(() => {
    view.viewMode = viewMode;
    view.filter = filter;
  }, [viewMode, filter]);
  const btn = (on: boolean) => cn("rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wider", on ? "bg-primary text-primary-foreground" : "bg-secondary/80 text-secondary-foreground hover:bg-accent");
  return (
    <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap">
      <button className={btn(viewMode === "capital")} onClick={() => set({ viewMode: "capital" })}>Capital ships</button>
      <button className={btn(viewMode === "all")} onClick={() => set({ viewMode: "all" })}>All ships</button>
      <span className="mx-1 hud-label">Show</span>
      {([["all", "All"], ["1m", "$1M+"], ["near", "Within 0.1%"], ["subs", "Subs only"]] as const).map(([k, l]) => (
        <button key={k} className={btn(filter === k)} onClick={() => set({ filter: k })}>{l}</button>
      ))}
    </div>
  );
}

function BossBar({ side, now }: { side: "bid" | "ask"; now: number }) {
  const f = useBattle((s) => s.hud.flags[side]);
  if (!f) return null;
  const name = side === "bid" ? "Buyers'" : "Sellers'";
  const hp = f.status === "on station" ? Math.max(0, Math.min(1, f.hp / Math.max(f.peak, 1e-12))) : 0;
  const mins = now && f.since ? Math.max(0, Math.floor((now - f.since) / 60_000)) : 0;
  return (
    <div className="hud-panel pointer-events-auto px-2.5 py-1.5" data-tour={side === "ask" ? "boss" : undefined}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={cn("truncate font-display font-semibold uppercase tracking-wider", side === "bid" ? "text-bull" : "text-bear")}>
          {name} flagship {f.price ? fmtPrice(f.price) : ""}
          {f.status === "on station" && <span className="hud-num hidden font-normal normal-case text-muted-foreground sm:inline"> · {usd(f.notional)} · {(f.away * 100).toFixed(2)}% away · on station {mins}m</span>}
        </span>
        {f.status !== "on station" && <span className="rounded bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{f.status}</span>}
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-sm bg-secondary">
        <div className={cn("h-full transition-[width] duration-300", side === "bid" ? "bg-bull" : "bg-bear")} style={{ width: `${hp * 100}%` }} />
      </div>
    </div>
  );
}

function Banners() {
  const { hud, callout, radio } = useBattle(useShallow((s) => ({ hud: s.hud, callout: s.callout, radio: s.radio })));
  const regime = regimeOf(hud.priceChange5m, hud.oiChangePct);
  const [show, setShow] = useState<typeof callout>(null);
  const [rad, setRad] = useState<typeof radio>(null);
  useEffect(() => {
    if (!callout) return;
    setShow(callout);
    const t = setTimeout(() => setShow(null), callout.slow ? 3200 : 2200);
    return () => clearTimeout(t);
  }, [callout]);
  useEffect(() => {
    if (!radio) return;
    setRad(radio);
    const t = setTimeout(() => setRad(null), 4000);
    return () => clearTimeout(t);
  }, [radio]);
  const nt = hud.nextTarget;
  return (
    <>
      <div className="pointer-events-none flex flex-wrap items-center justify-center gap-2 text-center">
        {regime && <span className="regime-banner">{regime}</span>}
        <span className="phase-chip">{PHASE_NAME[hud.phase]}</span>
        {nt && (
          <span className="hud-num rounded bg-background/70 px-2 py-0.5 text-[10px] text-foreground md:text-[11px]">
            NEXT TARGET {nt.side === "ask" ? "Sellers'" : "Buyers'"} flagship {fmtPrice(nt.price)} · {usd(nt.depth)} to eat
          </span>
        )}
      </div>
      {show && (
        <div key={show.id} className={cn("callout", `callout-${show.tone}`, show.slow && "callout-slow")} role="status">
          {show.text}
        </div>
      )}
      {rad && (
        <div key={rad.id} className="radio-panel" role="status">
          <div className="radio-portrait" aria-hidden><span /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className={cn("radio-name", rad.speaker === "captain" ? "text-bull" : rad.speaker === "admiral" ? "text-bear" : "text-primary")}>{rad.speaker === "captain" ? "CAPTAIN · BUYERS" : rad.speaker === "admiral" ? "ADMIRAL · SELLERS" : "SPOTTER"}</span><span className="radio-wave" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span></div>
            <div className="radio-line">{rad.text}</div>
            {rad.detail && <div className="radio-detail">{rad.detail}</div>}
          </div>
        </div>
      )}
    </>
  );
}

const GUIDE = [
  "The vertical line in the middle is the live BTC price on Binance Futures. Buy orders wait on the left; sell orders wait on the right.",
  "Left/right = price. Front/back = how long the order has been waiting: new orders arrive from the back and move forward as they stay. Bigger ship = bigger order.",
  "Every shot is a real trade. The taker fires; the ship at that price is hit and loses the amount filled. A ship that is fully filled sinks and the front line moves.",
  "A big order that disappears before anyone trades into it dives as a submarine. If it pops up at another price, the submarine surfaces there. If more trades hit a price than was showing, a hidden submarine was there (possible iceberg).",
  "Bombers are liquidations (sampled by Binance: max 1 per second).",
  `Each battle lasts ${RULES_FACTS.battleMinutes} minutes. Sink the enemy flagship and push the line to win.`,
];
const DETAILS = [
  `Ships group the full order book into price buckets of ${RULES_FACTS.bucket} of the price, within ±${RULES_FACTS.range}.`,
  `Tiers by rolling percentile of bucket size: ${SHIPS.map((u) => `${u.name} ${u.rule}`).join("; ")}.`,
  `Weapons by trade-size rank: ${WEAPONS.map((u) => `${u.name} ${u.rule}`).join("; ")}. Fighter: ${AIRCRAFT[0]!.rule}.`,
  "Inferred events (repair, relocate, hidden) are guesses from book changes; Binance does not publish order identities.",
  "Data: Binance USD-M public streams (diff depth 100ms + REST snapshot, aggTrade, forceOrder, markPrice) and open interest polled every 30s.",
  "Longs/shorts in the banner come from open interest change with price direction, never from the order book.",
];

export function HowToRead() {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(localStorage.getItem("nms-more") === "1"), []);
  return (
    <section id="how-to-read" className="h-full min-h-0 overflow-auto p-2">
      <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-primary">How to read it</h2>
      <ul className="mt-1.5 space-y-1.5 text-xs leading-snug text-foreground/90">
        {GUIDE.map((g) => <li key={g}>{g}</li>)}
      </ul>
      <button
        className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-primary"
        onClick={() => {
          setMore((v) => {
            localStorage.setItem("nms-more", v ? "0" : "1");
            return !v;
          });
        }}
      >
        {more ? "Fewer details −" : "More details +"}
      </button>
      {more && (
        <ul className="mt-1.5 space-y-1 text-[11px] leading-snug text-muted-foreground">
          {DETAILS.map((g) => <li key={g}>{g}</li>)}
        </ul>
      )}
      <h3 className="mt-3 font-display text-xs font-semibold uppercase tracking-widest text-primary">Units</h3>
      <UnitList items={[...SHIPS, ...WEAPONS, ...AIRCRAFT]} compact />
      <p className="mt-2 text-[11px] text-muted-foreground"><span className="text-bull">Green markings identify Buyers</span> (left), <span className="text-bear">red markings identify Sellers</span> (right). Every event is in the Guide tab and the "?" panel.</p>
    </section>
  );
}

const SUBS = new Set(["GHOST", "FLED", "RELOCATE", "HIDDEN"]);
function tapeFilter(f: string) {
  return (l: TapeLine) => (f === "all" ? true : f === "1m" ? l.notional >= 1e6 : f === "subs" ? SUBS.has(l.kind) : l.kind === "AIR STRIKE");
}
const toneCls: Record<TapeLine["tone"], string> = { buy: "text-bull", sell: "text-bear", sub: "text-sub", liq: "text-danger", info: "text-ok" };

function ActionTape({ compact = false }: { compact?: boolean }) {
  const tape = useBattle((s) => s.tape);
  const [f, setF] = useState("all");
  const lines = useMemo(() => tape.filter(tapeFilter(f)).slice(0, compact ? 30 : 60), [tape, f, compact]);
  return (
    <section className="hud-panel flex min-h-0 flex-col p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-primary">Action tape</h2>
        <div className="flex gap-1">
          {([["all", "All"], ["1m", "$1M+"], ["subs", "Subs"], ["liq", "Liquidations"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setF(k)} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", f === k ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>{l}</button>
          ))}
        </div>
      </div>
      <ol className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-snug">
        {lines.length === 0 && <li className="text-muted-foreground">Waiting for real events…</li>}
        {lines.map((l) => (
          <li key={l.id} className={toneCls[l.tone]}>
            <span className="text-muted-foreground">{new Date(l.t).toISOString().slice(11, 19)}</span> {l.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Ticker() {
  const tape = useBattle((s) => s.tape);
  const items = tape.slice(0, 14);
  return (
    <div className="pointer-events-auto flex items-center gap-2 overflow-hidden border-t border-border/60 bg-background/80 px-2 py-1">
      <span className="shrink-0 rounded bg-danger px-1.5 text-[10px] font-bold uppercase text-primary-foreground">Live tape</span>
      <div className="ticker-track min-w-0 flex-1 overflow-hidden whitespace-nowrap font-mono text-[11px]">
        <div className="ticker-inner inline-block">
          {items.map((l) => (
            <span key={l.id} className={cn("mr-6", toneCls[l.tone])}>{l.text}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegendStrip() {
  return (
    <div className="pointer-events-auto flex items-center gap-3 overflow-x-auto px-1 text-[10px] text-foreground/80" data-tour="legend">
      {SHIPS.map((u) => (
        <span key={u.id} className="flex shrink-0 items-center gap-1">
          <UnitIcon u={u} side="bid" />
          <UnitIcon u={u} side="ask" />
          <span className="font-semibold">{u.name}</span>
          <span className="text-muted-foreground">{u.rule.replace("smallest ", "<").replace(" of price buckets", "")}</span>
        </span>
      ))}
      <span className="shrink-0 text-muted-foreground"><span className="text-bull">Buyers left</span> · <span className="text-bear">Sellers right</span> · Bomber = liquidation · Sub = pulled big order</span>
    </div>
  );
}

function RoundCard({ r, kind, now }: { r: Round; kind: "round" | "flagRound"; now: number }) {
  const q = questionText(r);
  const locked = !!r.lockAt && now > r.lockAt;
  const left = Math.max(0, r.endsAt - now);
  return (
    <div className="hud-panel pointer-events-auto p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-xs font-semibold leading-tight text-foreground md:text-sm">{q.q}</p>
        <span className="hud-num shrink-0 text-xs text-primary">{mmss(left)}</span>
      </div>
      <div className={cn("mt-2 grid gap-1.5", q.options.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {q.options.map((o) => (
          <button
            key={o.id}
            disabled={!!r.choice || locked}
            onClick={() => choose(kind, o.id)}
            className={cn(
              "rounded py-1.5 font-display text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-60",
              r.choice === o.id ? "bg-primary text-primary-foreground" : o.id === "buyers" ? "bg-bull/20 text-bull hover:bg-bull/30" : o.id === "sellers" ? "bg-bear/25 text-bear hover:bg-bear/35" : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {locked && !r.choice && <p className="mt-1 text-[10px] text-muted-foreground">Picks closed for this one.</p>}
    </div>
  );
}

function Predictions({ now }: { now: number }) {
  const { round, flagRound, xp, streak } = useBattle(useShallow((s) => ({ round: s.round, flagRound: s.flagRound, xp: s.xp, streak: s.streak })));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="hud-label">Predictions · XP only</span>
        <span className="hud-num text-xs text-primary">{xp} XP · streak {streak}</span>
      </div>
      {flagRound ? <RoundCard r={flagRound} kind="flagRound" now={now} /> : round ? <RoundCard r={round} kind="round" now={now} /> : null}
    </div>
  );
}

function ResultCard() {
  const { result, scoreboard } = useBattle(useShallow((s) => ({ result: s.result, scoreboard: s.scoreboard })));
  const [open, setOpen] = useState<typeof result>(null);
  useEffect(() => {
    if (!result) return;
    setOpen(result);
    const t = setTimeout(() => setOpen(null), 20000);
    return () => clearTimeout(t);
  }, [result]);
  if (!open) return null;
  const move = ((open.endMark - open.startMark) / open.startMark) * 100;
  const downloadCard = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#0d222b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e8bc4a";
    context.font = "bold 76px sans-serif";
    context.fillText("NO MAN'S SEA", 70, 110);
    context.fillStyle = "#f3f0df";
    context.font = "bold 110px sans-serif";
    context.fillText(open.winner === "draw" ? "DRAW" : `${open.winner.toUpperCase()} WIN`, 70, 285);
    context.font = "36px monospace";
    context.fillText(`BTC ${fmtPrice(open.startMark)} → ${fmtPrice(open.endMark)} (${move >= 0 ? "+" : ""}${move.toFixed(3)}%)`, 70, 380);
    context.font = "30px sans-serif";
    context.fillText(`Your pick: ${open.pick ? open.pick.toUpperCase() : "none"} · Streak ${open.streak ?? 0}`, 70, 440);
    if (open.biggest) context.fillText(`Biggest event: ${open.biggest}`, 70, 490);
    context.font = "28px sans-serif";
    context.fillText("Live Binance Futures data · XP only · No prizes", 70, 540);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `no-mans-sea-${open.id}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  };
  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/3 z-30 w-[min(92vw,360px)] -translate-x-1/2" role="dialog" aria-label="Battle result">
      <div className="hud-panel p-4 text-center">
        <div className="hud-label">Battle over</div>
        <div className={cn("font-display text-3xl font-bold uppercase tracking-widest", open.winner === "buyers" ? "text-bull" : open.winner === "sellers" ? "text-bear" : "text-foreground")}>
          {open.winner === "draw" ? "Draw" : `${open.winner === "buyers" ? "Buyers" : "Sellers"} win`}
        </div>
        <p className="hud-num mt-1 text-xs text-muted-foreground">
          {fmtPrice(open.startMark)} → {fmtPrice(open.endMark)} ({move >= 0 ? "+" : ""}{move.toFixed(3)}%)
        </p>
        <p className="mt-2 text-sm">
          Today: <span className="text-bull">Buyers {scoreboard?.buyers ?? 0}</span> – <span className="text-bear">{scoreboard?.sellers ?? 0} Sellers</span>
        </p>
        <div className="mt-3 flex justify-center gap-2"><button onClick={downloadCard} className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs uppercase text-primary-foreground"><Download className="h-3 w-3" /> Share card</button><button onClick={() => setOpen(null)} className="rounded bg-secondary px-3 py-1 text-xs uppercase">Close</button></div>
      </div>
    </div>
  );
}

function ClipToast() {
  const clip = useBattle((s) => s.clip);
  if (!clip) return null;
  const share = async () => {
    try {
      const files = clip.files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
      if (navigator.canShare?.({ files })) await navigator.share({ files, title: clip.title });
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="pointer-events-auto absolute bottom-24 left-1/2 z-30 w-[min(92vw,380px)] -translate-x-1/2">
      <div className="hud-panel flex items-center gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Clip ready</div>
          <div className="truncate text-xs text-muted-foreground">{clip.title} · stays on your device</div>
        </div>
        {clip.files.map((f) => (
          <a key={f.name} href={f.url} download={f.name} className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">
            <Download className="h-3 w-3" /> {f.name.includes("9x16") ? "9:16" : "16:9"}
          </a>
        ))}
        <button onClick={share} aria-label="Share clip" className="rounded bg-secondary p-1.5"><Share2 className="h-4 w-4" /></button>
        <button onClick={() => useBattle.setState({ clip: null })} aria-label="Dismiss" className="rounded p-1"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Toast() {
  const t = useBattle((s) => s.toast);
  const [show, setShow] = useState<typeof t>(null);
  useEffect(() => {
    if (!t) return;
    setShow(t);
    const h = setTimeout(() => setShow(null), 3200);
    return () => clearTimeout(h);
  }, [t]);
  if (!show) return null;
  return (
    <div key={show.id} className={cn("hud-panel absolute left-1/2 top-[42%] z-30 -translate-x-1/2 px-4 py-2 text-sm font-semibold", show.tone === "win" ? "text-ok" : show.tone === "loss" ? "text-danger" : "text-foreground")} role="status">
      {show.text}
    </div>
  );
}

function EnterGate() {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(localStorage.getItem("nms-entered") !== "1"), []);
  // unlock the audio context on the very first tap anywhere (phones need a gesture)
  useEffect(() => {
    const once = () => {
      void audio.unlock().catch((err) => console.error("[audio]", err));
      window.removeEventListener("pointerdown", once, true);
    };
    window.addEventListener("pointerdown", once, true);
    return () => window.removeEventListener("pointerdown", once, true);
  }, []);
  if (!open) return null;
  const enter = async (sound: boolean) => {
    localStorage.setItem("nms-entered", "1");
    setOpen(false);
    if (sound) {
      try {
        await audio.unlock();
        audio.setVolume(useBattle.getState().volume);
        audio.setEnabled(true);
        radioCheck();
        useBattle.setState({ soundOn: true });
        track("sound_on");
      } catch (err) {
        console.error("[audio]", err);
      }
    }
    useBattle.setState({ tourOpen: localStorage.getItem("nms-tour-done") !== "1" });
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-background/70 backdrop-blur-sm">
      <div className="hud-panel w-[min(92vw,380px)] p-5 text-center">
        <div className="font-display text-2xl font-bold uppercase tracking-[0.2em] text-primary">No Man's Sea</div>
        <p className="mt-2 text-sm text-muted-foreground">Every ship is a real resting order on Binance BTC futures. Every shot is a real trade.</p>
        <button onClick={() => enter(true)} className="mt-4 w-full rounded bg-primary py-3 font-display text-lg font-bold uppercase tracking-widest text-primary-foreground">Enter battle</button>
        <button onClick={() => enter(false)} className="mt-2 text-xs text-muted-foreground underline">Enter without sound</button>
      </div>
    </div>
  );
}

export function Hud() {
  const { status, statusDetail, hud, presentation, lesson } = useBattle(useShallow((s) => ({ status: s.status, statusDetail: s.statusDetail, hud: s.hud, presentation: s.presentation, lesson: s.lesson })));
  const now = useNow(500);
  const [drawer, setDrawer] = useState(false);
  const war = hud.phase === "P5";
  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col">
      {war && <div className="war-vignette absolute inset-0" aria-hidden />}
      <Labels />
       <div className="relative z-10 flex flex-col gap-1.5 p-1.5 md:p-2 lg:pr-[352px]">
        <Header now={now} />
        <div className="flex items-center justify-between gap-1.5">
          {presentation === "map" && <Filters />}
          <button id="how-to-read-chip" onClick={() => { useBattle.setState({ panelTab: "read" }); setDrawer(true); }} className="pointer-events-auto ml-auto rounded border border-primary/60 bg-background/80 px-2 py-1 text-[11px] font-semibold uppercase text-primary lg:hidden">How to read</button>
          <button onClick={() => setDrawer((v) => !v)} className="pointer-events-auto rounded bg-secondary px-2 py-1 text-[11px] font-semibold uppercase lg:hidden">
            {drawer ? "Close data" : "Live data"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 lg:pr-0">
          <BossBar side="bid" now={now} />
          <BossBar side="ask" now={now} />
        </div>
        <Banners />
      </div>

      {/* desktop sidebar */}
      <aside className="pointer-events-auto absolute bottom-[34px] right-2 top-2 z-10 hidden w-[336px] flex-col gap-2 lg:flex">
        <Guard name="live-data"><DataPanels /></Guard>
      </aside>
      {drawer && (
        <div className="pointer-events-auto absolute inset-x-1.5 bottom-[34px] top-[45%] z-20 flex flex-col lg:hidden">
          <DataPanels />
        </div>
      )}

      {status === "unavailable" && (
        <div className="pointer-events-auto absolute inset-x-4 top-1/2 z-20 mx-auto max-w-sm -translate-y-1/2" role="alert">
          <div className="hud-panel p-5 text-center">
            <div className="font-display text-xl font-bold uppercase tracking-widest text-danger">Binance stream unavailable</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Could not receive live market data{statusDetail ? ` (${statusDetail})` : ""}. Binance may be blocked in your region or network. No data is simulated, so the battle is paused.
            </p>
            <button
              onClick={() => useBattle.setState((s) => ({ status: "connecting", nonce: s.nonce + 1 }))}
              className="mt-4 inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-display font-semibold uppercase tracking-wider text-primary-foreground"
            >
              <RotateCw className="h-4 w-4" /> Retry
            </button>
          </div>
        </div>
      )}
      {status === "connecting" && !hud.hasBook && (
        <div className="absolute inset-x-0 top-1/2 text-center font-display text-sm uppercase tracking-[0.3em] text-foreground/80">Raising the fleet…</div>
      )}
      <button
        onClick={() => {
          view.cameraX = view.frontX;
          view.zoomScale = 1;
        }}
        aria-label="Recenter battlefield"
        title="Recenter"
        className="pointer-events-auto absolute right-2 top-[42%] z-20 rounded bg-secondary/90 p-2 text-foreground shadow-hud md:hidden"
      >
        <Crosshair className="h-4 w-4" />
      </button>

      <div className="flex-1" />

      <div className="relative z-10 flex flex-col gap-1.5 p-1.5 md:p-2 lg:pr-[352px]">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-end md:justify-between">
           <div className={cn("w-full md:w-[360px]", presentation === "cinema" && "hidden")}>
            <Guard name="predictions"><Predictions now={now} /></Guard>
          </div>
        </div>
        {presentation === "map" && <LegendStrip />}
        <p className="truncate px-1 text-[9px] leading-tight text-foreground/70 md:text-[10px]">Live Binance Futures public market data · Not financial advice · Not affiliated with Binance</p>
      </div>
      <Ticker />
      {lesson && <div key={lesson.id} className="lesson-spotlight pointer-events-auto absolute bottom-28 left-1/2 z-30 w-[min(90vw,520px)] -translate-x-1/2 rounded border border-primary bg-background/90 p-3 text-center text-sm"><button className="absolute right-1 top-1 p-1 text-muted-foreground" aria-label="Skip lesson" onClick={() => useBattle.setState({ lesson: null })}><X className="h-4 w-4" /></button>{lesson.text}</div>}

      <ResultCard />
      <ClipToast />
      <Toast />
      <Guard name="tour"><Tour /></Guard>
      <Guard name="help"><HowItWorks /></Guard>
      <Guard name="enter"><EnterGate /></Guard>
      <Guard name="debug"><DebugPanel /></Guard>
    </div>
  );
}
