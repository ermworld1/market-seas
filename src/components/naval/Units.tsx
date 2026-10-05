import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AIRCRAFT, EVENTS, RULES_FACTS, SCENERY, SHIPS, WEAPONS, type UnitDef } from "@/lib/battle/units";
import { engineRef, useBattle } from "@/lib/market/store";
import { cn } from "@/lib/utils";

let legendPromise: Promise<Record<string, string>> | null = null;
const legendCache: Record<string, string> = {};
function loadLegend() {
  legendPromise ??= new Promise((resolve) => {
    const start = () => { void import("@/lib/dev/renderLegend").then(({ renderLegend }) => renderLegend()).then((r) => resolve(Object.assign(legendCache, r))); };
    const idle = window.requestIdleCallback;
    if (idle) idle(start, { timeout: 4_000 });
    else window.setTimeout(start, 2_000);
  });
  return legendPromise;
}

/** Generated once at startup by an offscreen renderer using the battle's exact geometry and materials. */
export function UnitIcon({ u, small = false }: { u: UnitDef; small?: boolean }) {
  const key = u.icon;
  // Existing side render is only a loading fallback; the offscreen neutral
  // render replaces it as soon as the exact live geometry is ready.
  const staticSrc = `/legend/${u.icon}-bid.png`;
  const [src, setSrc] = useState(legendCache[key] ?? staticSrc);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { void loadLegend().then((r) => setSrc(r[key] ?? "")); }, [key]);
  return (
    <button type="button" aria-label={`Preview ${u.name}`} onPointerEnter={() => setPlaying(true)} onPointerLeave={() => setPlaying(false)} onClick={() => setPlaying((v) => !v)} className={cn("unit-preview relative shrink-0 overflow-hidden bg-transparent", small ? "h-[18px] w-[36px]" : "h-[55px] w-[110px]", playing && "is-playing")}>
      <img src={src} alt="" width={small ? 36 : 110} height={small ? 18 : 55} className="h-full w-full object-contain" />
      {playing && <span className={cn("unit-preview-fx", u.id)} aria-hidden />}
    </button>
  );
}

const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 10e6 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`;
function liveRule(u: UnitDef) {
  const e = engineRef.current;
  if (!e) return u.rule;
  const q = e.bucketSampler;
  const tq = e.tradeSampler;
  if (u.id === "patrol") return `buckets under ${money(q.quantile(0.4))} right now`;
  if (u.id === "destroyer") return `${money(q.quantile(0.4))}–${money(q.quantile(0.7))} right now`;
  if (u.id === "frigate") return `${money(q.quantile(0.7))}–${money(q.quantile(0.9))} right now`;
  if (u.id === "cruiser") return `${money(q.quantile(0.9))}–${money(q.quantile(1))} right now`;
  if (u.id === "battleship") return `largest resting bucket on that side right now`;
  if (u.id === "mg") return `trades under ${money(tq.quantile(0.6))} right now`;
  if (u.id === "gun") return `${money(tq.quantile(0.6))}–${money(tq.quantile(0.9))} right now`;
  if (u.id === "torpedo") return `${money(tq.quantile(0.9))}–${money(tq.quantile(0.99))} right now`;
  if (u.id === "broadside") return `trades of ${money(tq.quantile(0.99))} or more right now`;
  return u.rule;
}

/** Short live range for the legend strip, e.g. "$190K to $1.2M" (same quantiles as the fleet). */
export function shortRange(id: string): string {
  const e = engineRef.current;
  const q = e?.bucketSampler;
  if (id === "fighter") return "$200K+ burst";
  if (id === "bomber") return "liquidation";
  if (id === "battleship") return "largest wall";
  if (!q) return "";
  const a = q.quantile(0.4), b = q.quantile(0.7), c = q.quantile(0.9);
  if (id === "patrol") return `under ${money(a)}`;
  if (id === "destroyer") return `${money(a)} to ${money(b)}`;
  if (id === "frigate") return `${money(b)} to ${money(c)}`;
  if (id === "cruiser") return `${money(c)}+`;
  return "";
}

export function UnitList({ items, compact = false, explainSides = false }: { items: UnitDef[]; compact?: boolean; explainSides?: boolean }) {
  const nonce = useBattle((s) => s.nonce);
  const [, refresh] = useState(0);
  useEffect(() => { const id = window.setInterval(() => refresh((v) => v + 1), 2_000); return () => clearInterval(id); }, [nonce]);
  return (
    <ul className="grid gap-2">
      {items.map((u) => (
        <li key={u.id} className="text-[11px] leading-snug" data-unit={u.id}>
          <span className="flex min-w-0 items-center gap-2">
            <UnitIcon u={u} />
          <span className="block min-w-0">
            <strong className="text-foreground">{u.name}</strong> <span className="text-muted-foreground">· {liveRule(u)}</span>
            {!compact && <span className="block text-foreground/75">{u.text}</span>}
          </span>
          </span>
        </li>
      ))}
      {explainSides && <li className="text-[11px] leading-snug text-muted-foreground">Green-decked ships are resting buy liquidity (Buyers), red-decked ships are resting sell liquidity (Sellers).</li>}
    </ul>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h3 className="mt-3 font-display text-xs font-semibold uppercase tracking-widest text-primary">{children}</h3>;

export function UnitSections({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <H>Ships (resting liquidity)</H>
      <UnitList items={SHIPS} compact={compact} explainSides />
      <H>Weapons (real trades)</H>
      <UnitList items={WEAPONS} compact={compact} />
      <H>Aircraft</H>
      <UnitList items={AIRCRAFT} compact={compact} />
      <H>Events</H>
      <UnitList items={EVENTS} compact={compact} />
      <H>Scenery</H>
      <UnitList items={SCENERY} compact={compact} />
    </>
  );
}

/** "?" panel: how the game works + full legend + Replay tour. */
export function HowItWorks() {
  const open = useBattle((s) => s.helpOpen);
  if (!open) return null;
  const close = () => useBattle.setState({ helpOpen: false });
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-background/70 p-2" role="dialog" aria-label="How it works" onClick={close}>
      <div id="how-it-works" className="hud-panel flex max-h-[92vh] w-[min(96vw,620px)] flex-col p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold uppercase tracking-widest text-primary">How it works</h2>
          <button onClick={close} aria-label="Close how it works" className="rounded bg-secondary p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 text-xs leading-relaxed text-foreground/90">
          <p>
            No Man's Sea turns the live Binance BTCUSDT futures market into a naval battle. Nothing is simulated: every ship is real resting liquidity on the Binance book (many orders at one price bucket), every shot a real trade.
          </p>
          <H>The battle</H>
          <ul className="list-disc space-y-1 pl-4">
            <li><span className="font-semibold text-bull">Buyers</span> (green, left) are resting buy liquidity below the price. <span className="font-semibold text-bear">Sellers</span> (red, right) are resting sell liquidity above it.</li>
            <li>The vertical line of buoys is the last traded price. When price rises the line pushes right into the Sellers; when it falls it pushes left.</li>
            <li>Left/right = price. Front/back is only the ship's lane in the formation: it is fixed, so ships move left and right with price and never drift forward or back.</li>
            <li>Each battle lasts {RULES_FACTS.battleMinutes} minutes. The side that moved the price its way wins. Sinking the enemy flagship is the big prize.</li>
          </ul>
          <H>Ships, shots, submarines, aircraft</H>
          <ul className="list-disc space-y-1 pl-4">
            <li>Ships group the book into {RULES_FACTS.bucket} price buckets within ±{RULES_FACTS.range}. Distance from the line = distance from the price; size = resting liquidity.</li>
            <li>A trade is a shot from the taker's fleet into the ship at that price. The ship loses what was filled and sinks when fully filled.</li>
            <li>Ships are makers (resting liquidity). Gunfire is takers (aggressive trades) launched from the attacking side's fleet.</li>
            <li>Big liquidity pulled before contact dives like a submarine; if similar size reappears elsewhere it surfaces there.</li>
            <li>Fighters are bursts of $200K+ aggressive buying or selling within 0.3 s. Bombers are real liquidations, labelled long or short.</li>
          </ul>
          <H>Predictions</H>
          <ul className="list-disc space-y-1 pl-4">
            <li>Before a battle starts, pick which side wins. Flagship rounds ask whether the flagship sinks, dives or holds within 60s.</li>
            <li>Picks lock when the window starts and are scored on the server from Binance prices. XP only: no money, no prizes. Sign in from the Ranks tab to appear on the leaderboard.</li>
          </ul>
          <UnitSections />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => useBattle.setState({ helpOpen: false, tourOpen: true })} className={cn("rounded bg-primary px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wider text-primary-foreground")}>Replay tour</button>
        </div>
      </div>
    </div>
  );
}
