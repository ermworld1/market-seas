import { useEffect, useRef } from "react";
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
      reps.current.forEach((el, i) => place(el, screen.repairs[i] ?? null, -18));
      fl.current.forEach((el, i) => {
        const f = screen.floaters[i];
        if (!el) return;
        if (!f) {
          el.style.display = "none";
          return;
        }
        place(el, f, -f.age * 26);
        el.style.opacity = String(Math.max(0, 1 - f.age / 1.8));
        if (el.textContent !== f.text) el.textContent = f.text;
        el.dataset["tone"] = f.tone;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden>
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
          className="ship-tag absolute left-0 top-0 text-ok"
          style={{ display: "none" }}
        >
          repair (inferred)
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
