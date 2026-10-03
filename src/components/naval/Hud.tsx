import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RotateCw } from "lucide-react";
import { useBattle } from "@/lib/market/store";
import { FRONTS } from "@/lib/market/types";
import { fmtPrice, questionText } from "@/lib/market/predictions";
import { choose } from "./usePredictionRounds";
import { cn } from "@/lib/utils";

const LEGEND: [string, string][] = [
  ["Bears fleet (north)", "Resting sell limit orders (asks), farther = higher price."],
  ["Bulls fleet (south)", "Resting buy limit orders (bids), farther = lower price."],
  ["No-man's sea", "The spread. Glowing buoys mark the mark price."],
  ["Patrol / Frigate / Cruiser", "Level notional percentile on this front: <50%, 50–90%, top 10%."],
  ["Battleship", "The single largest resting level on each side."],
  ["Ghost ship", "A cruiser or battleship pulled before any trade printed at its price."],
  ["Repair (inferred)", "Level hit and refilled 2+ times in 10s: iceberg or market maker."],
  ["Tracers / Gun / Torpedo / Broadside", "Taker trade size percentile: <60%, 60–90%, 90–99%, top 1%."],
  ["Sinking", "The last order at a price consumed by trades."],
  ["Bomber", "A liquidation: bombs fall on the liquidated side's rear."],
  ["FULL WAR", "3+ liquidations within 10s on this front."],
  ["Convoy", "Open interest moved more than ±0.3% over 5 minutes."],
  ["Leaking tanker", "The side paying funding (positive = longs pay)."],
  ["Sea state", "Realized volatility of 1-minute returns over the last 15 minutes."],
];

function compact(n: number) {
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
}

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
      <div className="hud-num truncate text-sm text-foreground">{children}</div>
    </div>
  );
}

export function Hud() {
  const { symbol, status, statusDetail, hud, setSymbol } = useBattle();
  const [legend, setLegend] = useState(false);
  const now = useNow(1000);
  const lat = hud.latency;
  const latTone = status !== "live" ? "text-muted-foreground" : lat > 10_000 ? "text-danger" : lat > 2000 ? "text-warn" : "text-ok";
  const liqAgo = hud.lastLiq && now ? Math.max(0, Math.round((now - hud.lastLiq.t) / 1000)) : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col">
      {hud.fullWar && <div className="war-vignette absolute inset-0" aria-hidden />}

      {/* header */}
      <header className="pointer-events-auto relative mx-2 mt-2 md:mx-4 md:mt-4 md:max-w-xl">
        <div className="hud-panel p-2.5 md:p-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-display text-lg font-bold uppercase leading-none tracking-[0.18em] text-primary md:text-xl">
              No Man's Sea
            </h1>
            <div className="flex items-center gap-2">
              {hud.fullWar && (
                <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-destructive-foreground">
                  Full war
                </span>
              )}
              <span className={cn("hud-num text-xs", latTone)} title="Milliseconds since the last market message">
                {status === "live" ? `● ${lat} ms` : status === "connecting" ? "○ connecting" : "× offline"}
              </span>
            </div>
          </div>

          <nav className="mt-2 grid grid-cols-3 gap-1" aria-label="Front">
            {FRONTS.map((f) => (
              <button
                key={f}
                onClick={() => f !== symbol && setSymbol(f)}
                aria-pressed={f === symbol}
                className={cn(
                  "rounded py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors",
                  f === symbol ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent",
                )}
              >
                {f.replace("USDT", "")}
              </button>
            ))}
          </nav>

          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5">
            <Stat label="Mark">{hud.mark ? fmtPrice(hud.mark) : "—"}</Stat>
            <Stat label="Spread">{hud.hasBook ? fmtPrice(hud.spread) : "—"}</Stat>
            <Stat label="Funding">
              <span className={hud.funding > 0 ? "text-bull" : hud.funding < 0 ? "text-bear" : ""}>
                {hud.mark ? `${(hud.funding * 100).toFixed(4)}%` : "—"}
              </span>
            </Stat>
            <Stat label="Open interest">
              {hud.oi ? compact(hud.oi) : "—"}
              {hud.oi ? (
                <span className={cn("ml-1 text-xs", hud.oiChangePct >= 0 ? "text-ok" : "text-bear")}>
                  {hud.oiChangePct >= 0 ? "+" : ""}
                  {hud.oiChangePct.toFixed(2)}%
                </span>
              ) : null}
            </Stat>
            <Stat label="Ghosts / min">{hud.ghostsPerMin}</Stat>
            <Stat label="Last liquidation">
              {hud.lastLiq ? (
                <span className={hud.lastLiq.liquidated === "longs" ? "text-bull" : "text-bear"}>
                  {hud.lastLiq.liquidated} ${compact(hud.lastLiq.notional)} · {liqAgo}s
                </span>
              ) : (
                "none yet"
              )}
            </Stat>
          </div>
        </div>
      </header>

      {status === "unavailable" && (
        <div className="pointer-events-auto absolute inset-x-4 top-1/2 mx-auto max-w-sm -translate-y-1/2" role="alert">
          <div className="hud-panel p-5 text-center">
            <div className="font-display text-xl font-bold uppercase tracking-widest text-danger">Binance stream unavailable</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Could not receive live market data{statusDetail ? ` (${statusDetail})` : ""}. Binance may be blocked in your region or network. No data is simulated, so the battle is paused.
            </p>
            <button
              onClick={() => useBattle.setState((s) => ({ status: "connecting", symbol: s.symbol, nonce: s.nonce + 1 }))}
              className="mt-4 inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-display font-semibold uppercase tracking-wider text-primary-foreground"
            >
              <RotateCw className="h-4 w-4" /> Retry
            </button>
          </div>
        </div>
      )}
      {status === "connecting" && !hud.hasBook && (
        <div className="absolute inset-x-0 top-1/2 text-center font-display text-sm uppercase tracking-[0.3em] text-foreground/80">
          Raising the fleet…
        </div>
      )}

      <div className="flex-1" />

      {/* bottom */}
      <div className="flex flex-col gap-2 p-2 md:flex-row md:items-end md:justify-between md:p-4">
        <div className="pointer-events-auto order-2 md:order-1 md:max-w-md">
          <div className="hud-panel">
            <button
              onClick={() => setLegend((v) => !v)}
              aria-expanded={legend}
              className="flex w-full items-center justify-between px-3 py-2 font-display text-xs font-semibold uppercase tracking-widest text-foreground"
            >
              Legend {legend ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            {legend && (
              <ul className="max-h-[38vh] space-y-1 overflow-y-auto px-3 pb-3 text-xs">
                {LEGEND.map(([k, v]) => (
                  <li key={k} className="leading-snug">
                    <span className="font-semibold text-primary">{k}:</span> <span className="text-muted-foreground">{v}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[10px] leading-tight text-foreground/70">
            Liquidations are sampled by Binance: max 1 per second per symbol.
            <br />
            Live Binance Futures public market data. Prototype. Not affiliated with Binance.
          </p>
        </div>
        <div className="order-1 md:order-2 md:w-[360px]">
          <Prediction now={now} />
        </div>
      </div>
      <Toast />
    </div>
  );
}

function Prediction({ now }: { now: number }) {
  const { round, xp, streak, status } = useBattle();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const t = tick || now;
  const header = (
    <div className="flex items-center justify-between">
      <span className="hud-label">Prediction round · XP only</span>
      <span className="hud-num text-xs text-primary">
        {xp} XP · streak {streak}
      </span>
    </div>
  );
  if (!round)
    return (
      <div className="hud-panel pointer-events-auto p-3">
        {header}
        <p className="mt-1.5 text-sm text-muted-foreground">
          {status === "live" ? "Next question incoming…" : "Rounds start once live data arrives."}
        </p>
      </div>
    );
  const q = questionText(round);
  const left = Math.max(0, Math.ceil((round.endsAt - t) / 1000));
  const pct = Math.max(0, Math.min(1, (round.endsAt - t) / (round.endsAt - round.startedAt)));
  const isFleet = round.kind === "water";
  return (
    <div className="hud-panel pointer-events-auto p-3">
      {header}
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <p className="font-display text-base font-semibold leading-tight text-foreground">{q.q}</p>
        <span className="hud-num text-lg font-semibold text-primary">{left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `${left}s`}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-secondary">
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${pct * 100}%` }} />
      </div>
      {round.kind === "hold" && round.failed && <p className="mt-1 text-xs text-danger">The battleship has fallen.</p>}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        {(["a", "b"] as const).map((c) => {
          const picked = round.choice === c;
          const tone = isFleet ? (c === "a" ? "bull" : "bear") : c === "a" ? "bull" : "bear";
          return (
            <button
              key={c}
              disabled={!!round.choice}
              onClick={() => choose(c)}
              className={cn(
                "min-h-12 rounded font-display text-base font-bold uppercase tracking-wider transition-all disabled:cursor-default",
                tone === "bull" ? "bg-bull text-bull-foreground" : "bg-bear text-bear-foreground",
                round.choice && !picked && "opacity-30",
                picked && "ring-2 ring-foreground",
              )}
            >
              {c === "a" ? q.a : q.b}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toast() {
  const toast = useBattle((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3800);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div className="absolute inset-x-0 top-[42%] flex justify-center px-4" role="status" aria-live="polite">
      <div
        className={cn(
          "hud-panel animate-scale-in px-4 py-2 font-display text-base font-semibold uppercase tracking-wider",
          toast.tone === "win" ? "text-ok" : toast.tone === "loss" ? "text-bear" : "text-foreground",
        )}
      >
        {toast.text}
      </div>
    </div>
  );
}
