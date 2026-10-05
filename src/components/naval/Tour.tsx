import { useEffect, useState } from "react";
import { useBattle } from "@/lib/market/store";
import { track } from "@/lib/analytics";
import { screen } from "./screen";

interface Step {
  title: string;
  text: string;
  rect: () => { x: number; y: number; w: number; h: number } | null;
}
const el = (sel: string) => () => {
  const n = document.querySelector(sel);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
const STEPS: Step[] = [
  {
    title: "The strait = live price",
    text: "The vertical glowing line in the middle is the live BTC price on Binance Futures. Resting buy liquidity waits left; sell liquidity waits right.",
    rect: () => (screen.strait ? { x: screen.strait.x - 26, y: 0, w: 52, h: window.innerHeight } : null),
  },
  {
    title: "Real liquidity",
    text: "This ship is real resting liquidity on Binance (many orders in one price bucket). Left/right is its price; its front/back lane is fixed. Green decks are Buyers, red decks are Sellers.",
    rect: () => (screen.near ? { x: screen.near.x - 40, y: screen.near.y - 40, w: 80, h: 80 } : null),
  },
  { title: "Ship size = liquidity", text: "Bigger ships hold more resting liquidity, ranked against the rest of the book. The largest on each side is the flagship.", rect: el('[data-tour="legend"]') },
  { title: "Battle clock and flagships", text: "Each battle lasts 5 minutes. Push the price toward the other fleet and sink its flagship to win.", rect: el('[data-tour="clock"]') },
];

export function Tour() {
  const open = useBattle((s) => s.tourOpen);
  const [i, setI] = useState(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (!open) return;
    setI(0);
    const t = setInterval(() => force((n) => n + 1), 200);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !(e.target instanceof HTMLInputElement)) useBattle.setState({ helpOpen: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  const step = STEPS[i]!;
  const r = step.rect();
  function close(done = false) {
    localStorage.setItem("nms-tour-done", "1");
    if (done) track("tour_done");
    useBattle.setState({ tourOpen: false });
  }
  const pad = 6;
  const below = r ? r.y + r.h + 12 < window.innerHeight - 170 : true;
  return (
    <div className="pointer-events-auto absolute inset-0 z-50" role="dialog" aria-label="Tour">
      {r ? (
        <div className="tour-spot absolute rounded-md" style={{ left: r.x - pad, top: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2 }} />
      ) : (
        <div className="absolute inset-0 bg-background/70" />
      )}
      <div
        className="hud-panel absolute left-1/2 w-[min(92vw,340px)] -translate-x-1/2 p-4"
        style={r ? (below ? { top: Math.min(window.innerHeight - 180, r.y + r.h + 14) } : { top: Math.max(8, r.y - 170) }) : { top: "40%" }}
      >
        <div className="hud-label">Step {i + 1} of {STEPS.length}</div>
        <div className="font-display text-lg font-bold uppercase tracking-wider text-primary">{step.title}</div>
        <p className="mt-1 text-sm text-foreground/90">{step.text}</p>
        <div className="mt-3 flex justify-between">
          <button onClick={() => close()} className="text-xs text-muted-foreground underline">Skip</button>
          <button
            onClick={() => (i + 1 < STEPS.length ? setI(i + 1) : close(true))}
            className="rounded bg-primary px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wider text-primary-foreground"
          >
            {i + 1 < STEPS.length ? "Next" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
