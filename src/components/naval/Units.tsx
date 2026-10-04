import { X } from "lucide-react";
import { AIRCRAFT, EVENTS, RULES_FACTS, SCENERY, SHIPS, WEAPONS, type UnitDef } from "@/lib/battle/units";
import { useBattle } from "@/lib/market/store";
import { cn } from "@/lib/utils";

/** Rendered from the scene's own models/effects (see scripts/render-legend). */
export function UnitIcon({ u, side }: { u: UnitDef; side?: "bid" | "ask" }) {
  const src = u.sided ? `/legend/${u.icon}-${side ?? "bid"}.png` : `/legend/${u.icon}.png`;
  return <img src={src} alt="" width={64} height={28} loading="lazy" className="h-7 w-16 shrink-0 object-contain" />;
}

export function UnitList({ items, both = true, compact = false }: { items: UnitDef[]; both?: boolean; compact?: boolean }) {
  return (
    <ul className="grid gap-1">
      {items.map((u) => (
        <li key={u.id} className="flex items-center gap-2 text-[11px] leading-snug" data-unit={u.id}>
          <span className="flex shrink-0 gap-0.5">
            <UnitIcon u={u} side="bid" />
            {both && u.sided && <UnitIcon u={u} side="ask" />}
          </span>
          <span className="min-w-0">
            <strong className="text-foreground">{u.name}</strong> <span className="text-muted-foreground">· {u.rule}</span>
            {!compact && <span className="block text-foreground/75">{u.text}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h3 className="mt-3 font-display text-xs font-semibold uppercase tracking-widest text-primary">{children}</h3>;

export function UnitSections({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <H>Ships (resting orders)</H>
      <UnitList items={SHIPS} compact={compact} />
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
            No Man's Sea turns the live Binance BTCUSDT futures market into a naval battle. Nothing is simulated: every ship is a real resting order, every shot a real trade.
          </p>
          <H>The battle</H>
          <ul className="list-disc space-y-1 pl-4">
            <li><span className="font-semibold text-bull">Buyers</span> (green, left) are buy orders waiting below the price. <span className="font-semibold text-bear">Sellers</span> (red, right) are sell orders waiting above it.</li>
            <li>The vertical line of buoys is the live mark price. When price rises the line pushes right into the Sellers; when it falls it pushes left.</li>
            <li>Each battle lasts {RULES_FACTS.battleMinutes} minutes. The side that moved the price its way wins. Sinking the enemy flagship is the big prize.</li>
          </ul>
          <H>Ships, shots, submarines, aircraft</H>
          <ul className="list-disc space-y-1 pl-4">
            <li>Ships group the book into {RULES_FACTS.bucket} price buckets within ±{RULES_FACTS.range}. Distance from the line = distance from the price; size = order size.</li>
            <li>A trade is a shot from the taker's fleet into the ship at that price. The ship loses what was filled and sinks when fully filled.</li>
            <li>A big order cancelled before contact dives like a submarine; if similar size reappears elsewhere it surfaces there.</li>
            <li>Fighters are single very large taker orders. Bombers are real liquidations.</li>
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
