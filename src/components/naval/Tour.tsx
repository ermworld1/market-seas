import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBattle } from "@/lib/market/store";
import { track } from "@/lib/analytics";
import { screen } from "./screen";

type Rect = { x: number; y: number; w: number; h: number };
interface Step {
  title: string;
  text: string;
  rect: () => Rect | null;
}

const box = (sel: string) => {
  const n = document.querySelector(sel);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};
const el = (sel: string) => (): Rect | null => {
  const r = box(sel);
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};

/** The price line runs from under the header to above the bottom legend, like a front line. */
function priceLine(): Rect | null {
  if (!screen.strait) return null;
  const top = (box('[data-tour="header"]')?.bottom ?? 0) + 8;
  const bottom = (box('[data-tour="legend"]')?.top ?? window.innerHeight - 40) - 8;
  return bottom - top > 80 ? { x: screen.strait.x - 24, y: top, w: 48, h: bottom - top } : null;
}

const STEPS: Step[] = [
  {
    title: "The price line",
    text: "This line is the last traded BTC price on Binance Futures. When buyers lift the price it moves right into the Sellers' fleet; when sellers hit it, it moves left into the Buyers'.",
    rect: priceLine,
  },
  {
    title: "Ships are resting orders",
    text: "Each ship is real buy (green) or sell (red) liquidity waiting at one price, usually many orders together. Bigger hull means more money. The further back a ship sits, the longer it has been resting.",
    rect: () => {
      const c = screen.showcase;
      if (c) {
        const r = Math.min(90, Math.max(30, c.r * 1.25));
        return { x: c.x - r, y: c.y - r * 0.7, w: r * 2, h: r * 1.4 };
      }
      return null;
    },
  },
  {
    title: "Every shot is a real trade",
    text: "Takers fire at the ship resting at the price they trade. Bigger trade, bigger weapon: machine gun, deck gun, torpedo, broadside. Liquidations arrive as bombers. Each one is logged on this tape.",
    rect: el('[data-tour="tape"]'),
  },
  {
    title: "Win the battle",
    text: "Each battle lasts 5 minutes. The side that pushes the line its way and sinks the enemy flagship wins. Anything unclear? Open Ask the map and type your question.",
    rect: el('[data-tour="clock"]'),
  },
];

const PAD = 6;
const GAP = 14;
const MARGIN = 12;

/** Put the card next to the highlight: centred over tall targets, otherwise below or above. */
function place(r: Rect | null, cw: number, ch: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(W - cw - MARGIN, x));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(H - ch - MARGIN, y));
  if (!r) return { left: clampX((W - cw) / 2), top: clampY((H - ch) / 2) };
  const cx = r.x + r.w / 2;
  if (r.h > H * 0.45) return { left: clampX(cx - cw / 2), top: clampY(r.y + r.h / 2 - ch / 2) };
  const below = r.y + r.h + PAD + GAP;
  const above = r.y - PAD - GAP - ch;
  const top = below + ch <= H - MARGIN ? below : above >= MARGIN ? above : clampY(below);
  return { left: clampX(cx - cw / 2), top };
}

export function Tour() {
  const open = useBattle((s) => s.tourOpen);
  const [i, setI] = useState(0);
  const [, force] = useState(0);
  const card = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 400, h: 190 });

  useEffect(() => {
    if (!open) return;
    setI(0);
    // targets move (ships, the price line), so re-measure a few times a second
    const t = setInterval(() => force((n) => n + 1), 200);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" || e.key === "Enter")
        setI((v) => Math.min(STEPS.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // "?" anywhere (outside a text field) replays the tour
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key === "?" && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement))
        useBattle.setState({ tourOpen: true, helpOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // measure the card after every render (text changes per step); the guard stops update loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const c = card.current;
    if (c && (Math.abs(c.offsetWidth - size.w) > 1 || Math.abs(c.offsetHeight - size.h) > 1))
      setSize({ w: c.offsetWidth, h: c.offsetHeight });
  });

  if (!open) return null;
  const step = STEPS[i]!;
  const r = step.rect();
  const pos = place(r, size.w, size.h);
  const last = i + 1 >= STEPS.length;
  function close(done = false) {
    localStorage.setItem("nms-tour-done", "1");
    if (done) track("tour_done");
    useBattle.setState({ tourOpen: false });
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Tour step ${i + 1} of ${STEPS.length}: ${step.title}`}
    >
      {r ? (
        <div
          className="tour-spot absolute"
          style={{ left: r.x - PAD, top: r.y - PAD, width: r.w + PAD * 2, height: r.h + PAD * 2 }}
        />
      ) : (
        <div className="absolute inset-0 bg-[oklch(0.08_0.02_230/0.72)]" />
      )}
      <div
        ref={card}
        className="tour-card absolute w-[min(calc(100vw-24px),400px)]"
        style={{ left: pos.left, top: pos.top }}
      >
        <div className="text-xs tabular-nums text-muted-foreground">
          {i + 1} / {STEPS.length}
        </div>
        <div className="mt-1.5 text-lg font-bold text-primary">{step.title}</div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/90">{step.text}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => close()}
            className="rounded-md border border-border bg-secondary/50 px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            Skip
          </button>
          <button
            onClick={() => (last ? close(true) : setI(i + 1))}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-105"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
