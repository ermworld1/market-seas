import { useEffect, useRef, useState } from "react";
import { Wrench, X } from "lucide-react";
import { engineRef, useBattle } from "@/lib/market/store";
import { fmtPrice, usd } from "@/lib/market/predictions";
import { FLEET_NAME } from "@/lib/market/types";
import { screen } from "./screen";

const FLOATERS = 10;
const TICKS = 24;

/**
 * DOM label layer: fixed set of nodes positioned every animation frame from
 * projected anchors. Nothing mounts/unmounts during render (replaces drei Html).
 */
export function Labels() {
  const flag = useRef<Record<"bid" | "ask", HTMLDivElement | null>>({ bid: null, ask: null });
  const reps = useRef<(HTMLDivElement | null)[]>([]);
  const fl = useRef<(HTMLDivElement | null)[]>([]);
  const line = useRef<HTMLDivElement | null>(null);
  const ring = useRef<HTMLDivElement | null>(null);
  const tk = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const place = (el: HTMLElement | null, p: { x: number; y: number } | null, dy = 0) => {
      if (!el) return;
      if (!p) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      el.style.transform = `translate(${p.x}px, ${p.y + dy}px) translate(-50%, -100%)`;
    };
    const loop = () => {
      const flags = useBattle.getState().hud.flags;
      for (const side of ["bid", "ask"] as const) {
        const el = flag.current[side];
        const f = flags[side];
        place(el, f && f.status === "on station" ? screen.flag[side] : null);
        if (el && f) {
          const txt = `${side === "bid" ? "Buyers'" : "Sellers'"} flagship ${fmtPrice(f.price)}`;
          if (el.textContent !== txt) el.textContent = txt;
        }
      }
      reps.current.forEach((el, i) => place(el, screen.repairs[i] ?? null, -10));
      tk.current.forEach((el, i) => {
        const t = screen.ticks[i];
        if (!el) return;
        if (!t) { el.style.display = "none"; return; }
        el.style.display = "";
        el.style.transform = `translate(${t.x}px, ${Math.min(t.y, window.innerHeight - 28)}px) translate(-50%, 0)`;
        if (el.textContent !== t.label) el.textContent = t.label;
      });
      fl.current.forEach((el, i) => {
        const f = screen.floaters[i];
        if (!el) return;
        if (!f) {
          el.style.display = "none";
          return;
        }
        place(el, f, -f.age * 26 - i * 16);
        el.style.opacity = String(Math.max(0, 1 - f.age / 1.8));
        if (el.textContent !== f.text) el.textContent = f.text;
        el.dataset["tone"] = f.tone;
      });
      const rg = ring.current;
      if (rg) { const lp = useBattle.getState().lesson ? screen.lesson : null; if (lp) { rg.style.display = ""; rg.style.transform = `translate(${lp.x}px, ${lp.y}px) translate(-50%, -50%)`; } else rg.style.display = "none"; }
      const l = line.current;
      const selected = screen.selected;
      if (l && selected) {
        const startX = window.innerWidth >= 1024 ? window.innerWidth - 340 : window.innerWidth;
        const startY = window.innerHeight * 0.5;
        const dx = selected.x - startX;
        const dy = selected.y - startY;
        l.style.display = "";
        l.style.width = `${Math.hypot(dx, dy)}px`;
        l.style.transform = `translate(${startX}px, ${startY}px) rotate(${Math.atan2(dy, dx)}rad)`;
      } else if (l) l.style.display = "none";
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden>
      <div ref={ring} data-testid="lesson-ring" className="lesson-ring absolute left-0 top-0 h-24 w-24 rounded-full border-2 border-primary" style={{ display: "none" }} />
      <div ref={line} className="absolute left-0 top-0 h-px origin-left bg-primary/70" style={{ display: "none" }} />
      {(["bid", "ask"] as const).map((side) => (
        <div
          key={side}
          ref={(el) => {
            flag.current[side] = el;
          }}
          className={`ship-tag absolute left-0 top-0 ${side === "bid" ? "text-bull" : "text-bear"}`}
          style={{ display: "none" }}
        />
      ))}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          ref={(el) => {
            reps.current[i] = el;
          }}
          className="absolute left-0 top-0 grid h-3.5 w-3.5 place-items-center rounded-full border border-ok/60 bg-background/70 text-ok"
          style={{ display: "none" }}
          title="Repair inferred from repeated refills"
        >
          <Wrench className="h-2 w-2" />
        </div>
      ))}
      {Array.from({ length: TICKS }, (_, i) => (
        <div
          key={`t${i}`}
          ref={(el) => {
            tk.current[i] = el;
          }}
          className="price-tick absolute left-0 top-0 font-mono text-[10px] text-foreground/70"
          style={{ display: "none" }}
        />
      ))}
      {Array.from({ length: FLOATERS }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            fl.current[i] = el;
          }}
          className="floater absolute left-0 top-0"
          style={{ display: "none" }}
        />
      ))}
    </div>
  );
}

const ago = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** Info card for the selected ship (tap a ship or a Book row). All numbers come from the live Binance book and trades. */
export function ShipCard() {
  const sel = useBattle((s) => s.selectedBucket);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sel) return;
    const id = window.setInterval(() => tick((v) => v + 1), 500);
    return () => clearInterval(id);
  }, [sel]);
  if (!sel) return null;
  const e = engineRef.current;
  const ship = e?.trackers[sel.side].ships.get(sel.b) ?? null;
  const close = () => useBattle.setState({ selectedBucket: null });
  const st = e?.bucketStats.get(sel.side + sel.b);
  const now = Date.now();
  const visible = e ? [...e.trackers[sel.side].ships.values()].reduce((a, s) => a + s.notional, 0) : 0;
  const w = e?.width ?? 0;
  const ref = e?.ref ?? 0;
  return (
    <div id="ship-card" className="hud-panel pointer-events-auto fixed bottom-24 left-1/2 z-40 w-[min(92vw,320px)] -translate-x-1/2 p-3 text-xs">
      <div className="flex items-center justify-between">
        <strong className={sel.side === "bid" ? "text-bull" : "text-bear"}>{FLEET_NAME[sel.side]} · {ship ? ship.tier : "gone"}</strong>
        <button onClick={close} aria-label="Close ship info" className="rounded bg-secondary p-1"><X className="h-3 w-3" /></button>
      </div>
      {ship ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Price range</dt><dd className="font-mono">{fmtPrice(ship.price)}{w ? `–${fmtPrice(ship.price + w)}` : ""}</dd>
          <dt className="text-muted-foreground">Resting liquidity</dt><dd className="font-mono">{ship.qty.toFixed(3)} BTC · {usd(ship.notional)}</dd>
          <dt className="text-muted-foreground">Share of visible {sel.side === "bid" ? "bids" : "asks"}</dt><dd className="font-mono">{visible ? `${((ship.notional / visible) * 100).toFixed(1)}%` : "—"}</dd>
          <dt className="text-muted-foreground">Distance to last price</dt><dd className="font-mono">{ref ? `${((Math.abs(ship.price - ref) / ref) * 100).toFixed(3)}%` : "—"}</dd>
          <dt className="text-muted-foreground">On station</dt><dd className="font-mono">{ago(now - ship.bornAt)}</dd>
          <dt className="text-muted-foreground">Hits / traded here</dt><dd className="font-mono">{st?.hits ?? 0} · {usd(st?.filled ?? 0)}</dd>
          <dt className="text-muted-foreground">Refills (10s window)</dt><dd className="font-mono">{ship.refills.length}</dd>
          <dt className="text-muted-foreground">Liquidity pulled here (10m)</dt><dd className="font-mono">{st ? st.pulls.filter((t) => now - t <= 600_000).length : 0}×</dd>
        </dl>
      ) : (
        <p className="mt-2 text-muted-foreground">This liquidity is no longer resting at that price (traded through or pulled).</p>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">A ship is the total resting liquidity of many orders in a price bucket on Binance BTCUSDT perp, not a single order.</p>
    </div>
  );
}
