import { useEffect, useRef } from "react";
import { askCard } from "@/lib/market/askmap";
import { engineRef } from "@/lib/market/store";
import { displayFor, view } from "./layout";
import { screen } from "./screen";

const ROWS = 6;

/**
 * "Ask the map": one matte card that follows the pointer over the Map battlefield
 * and says what is under it — a ship, open water or the price line.
 * Like the other labels it is a fixed DOM node moved from rAF; nothing mounts or
 * unmounts while the pointer travels, and the numbers are re-read twice a second.
 */
export function AskMap() {
  const box = useRef<HTMLDivElement | null>(null);
  const ttl = useRef<HTMLDivElement | null>(null);
  const nte = useRef<HTMLDivElement | null>(null);
  const ks = useRef<(HTMLDivElement | null)[]>([]);
  const vs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    let lastText = 0;
    let sig = "";
    let size = { w: 250, h: 130 };
    const loop = () => {
      const el = box.current;
      const ask = view.presentation === "map" ? view.ask : null;
      const at = screen.ask;
      if (el) {
        if (!ask || !at) {
          if (el.style.display !== "none") el.style.display = "none";
          sig = "";
        } else {
          // keep the card inside the viewport: flip below the cursor when it would clip the top
          const x = Math.max(8, Math.min(window.innerWidth - size.w - 8, at.x + 18));
          const y = at.y - size.h - 16 < 8 ? Math.min(window.innerHeight - size.h - 8, at.y + 22) : at.y - size.h - 16;
          el.style.display = "";
          el.style.transform = `translate(${x}px, ${y}px)`;
          const t = performance.now();
          if (t - lastText > 200) {
            lastText = t;
            const e = engineRef.current;
            const b = ask.b;
            const d = b !== undefined ? displayFor(ask.side, b) : null;
            const ship = ask.kind === "ship" && b !== undefined ? e?.trackers[ask.side].ships.get(b) : null;
            const st = b !== undefined ? e?.bucketStats.get(ask.side + b) : undefined;
            const card = askCard({
              kind: ask.kind,
              side: ask.side,
              price: d?.price ?? ask.price,
              width: e?.width ?? 0,
              mark: view.mid,
              now: Date.now(),
              ship: ship ? { tier: ship.tier, notional: ship.notional, qty: ship.qty, bornAt: ship.bornAt, members: d?.memberCount ?? 1 } : null,
              stats: st ? { hits: st.hits, filled: st.filled, pulls: st.pulls.length } : null,
            });
            const next = `${card.tone}|${card.title}|${card.rows.map((r) => r.k + r.v).join("|")}|${card.note}`;
            if (next !== sig) {
              sig = next;
              el.dataset["tone"] = card.tone;
              if (ttl.current) ttl.current.textContent = card.title;
              if (nte.current) nte.current.textContent = card.note;
              for (let i = 0; i < ROWS; i++) {
                const k = ks.current[i];
                const v = vs.current[i];
                if (!k || !v) continue;
                const r = card.rows[i];
                k.style.display = r ? "" : "none";
                v.style.display = r ? "" : "none";
                if (r) {
                  k.textContent = r.k;
                  v.textContent = r.v;
                }
              }
              size = { w: el.offsetWidth || size.w, h: el.offsetHeight || size.h };
            }
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={box} data-testid="ask-map" aria-hidden className="ask-card absolute left-0 top-0 z-[6]" style={{ display: "none" }}>
      <div ref={ttl} className="ask-title" />
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="ask-row">
          <div
            ref={(el) => {
              ks.current[i] = el;
            }}
            className="ask-k"
            style={{ display: "none" }}
          />
          <div
            ref={(el) => {
              vs.current[i] = el;
            }}
            className="ask-v"
            style={{ display: "none" }}
          />
        </div>
      ))}
      <div ref={nte} className="ask-note" />
    </div>
  );
}
