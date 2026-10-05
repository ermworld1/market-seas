import { useEffect, useRef } from "react";
import { Wrench } from "lucide-react";
import { useBattle } from "@/lib/market/store";
import { fmtPrice } from "@/lib/market/predictions";
import { screen } from "./screen";

const FLOATERS = 10;

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
