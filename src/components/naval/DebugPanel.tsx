import { useEffect, useState } from "react";
import { engineRef } from "@/lib/market/store";
import type { Phase } from "@/lib/battle/phase";
import { audio, SFX } from "@/lib/audio/engine";
import { triggerClip, verifyNavalReadouts } from "./useDirector";
import { fireStats, view } from "./layout";

const PHASES: Phase[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];

/** ?debug=1 panel: force phase, test clip, event counters. */
export function DebugPanel() {
  const [on, setOn] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    setOn(new URLSearchParams(window.location.search).get("debug") === "1");
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  if (!on) return null;
  const e = engineRef.current;
  const info = (window as unknown as { __nmsInfo?: { triangles: number; calls: number } }).__nmsInfo;
  return (
    <div id="debug-panel" className="pointer-events-auto absolute bottom-24 left-2 z-[5] max-h-[35vh] w-64 overflow-y-auto rounded bg-background/90 p-2 font-mono text-[10px] text-foreground">
      <div className="font-bold">DEBUG</div>
      <div>phase {e?.phase.current} · frame {view.frameMs.toFixed(1)}ms</div>
      <div>view {view.presentation} · shot {view.shot?.kind ?? "wide"} · quality {view.quality}</div>
      <div id="debug-cuts">cuts {JSON.stringify(view.cuts)} · fighter waves {view.fighterWaves} · tape {view.tapeTotal}</div>
      <div>tris {info?.triangles ?? "?"} · calls {info?.calls ?? "?"}</div>
      <div>trades rx {e?.tradesReceived ?? 0} · viz {e?.tradesVisualized ?? 0} · tracers {e?.tracersSpawned ?? 0}</div>
      <div>book {e?.book.bids.size ?? 0}/{e?.book.asks.size ?? 0} lvls · {e?.partial ? "partial" : "full"} · u={e?.book.lastU}</div>
      <div id="debug-book">bookcheck {JSON.stringify(e?.bookCheck ?? {})}</div>
      <div>ships {view.visible.bid.length}/{view.visible.ask.length} · audio played {audio.played} dropped {audio.dropped}</div>
      <div>AudioContext <span id="debug-actx">{audio.state}</span> · enabled {String(audio.enabled)} · max fire gap {(fireStats.maxGap / 1000).toFixed(2)}s</div>
      <div id="debug-gap">gap active {(fireStats.maxGapActive / 1000).toFixed(2)}s · market gap {(fireStats.maxRecvGap / 1000).toFixed(2)}s · max lag {(fireStats.maxLag / 1000).toFixed(2)}s</div>
      <pre id="debug-sfx" className="whitespace-pre-wrap">sfx {JSON.stringify(audio.byCat)}</pre>
      <pre id="debug-var" className="whitespace-pre-wrap">variants {JSON.stringify(Object.fromEntries(Object.entries(audio.variants).map(([k, v]) => [k, v.length])))} · recorded {JSON.stringify(audio.recorded)} · merged {audio.merged}</pre>
      <div id="debug-amb">ambience {JSON.stringify(audio.ambience)} · intensity {audio.intensity.toFixed(2)}</div>
      <div id="debug-vo">voice {audio.voPlayed.length} {JSON.stringify(audio.voByCharacter)}: {audio.voPlayed.join(", ")}</div>
      <pre id="debug-voice-chains" className="whitespace-pre-wrap">chains {JSON.stringify(audio.voiceChainLog.slice(-8), null, 0)}</pre>
      <pre id="debug-counts" className="mt-1 whitespace-pre-wrap">{JSON.stringify(e?.counts ?? {}, null, 0)}</pre>
      <div className="mt-1 flex flex-wrap gap-1">
        {PHASES.map((p) => (
          <button key={p} className="rounded bg-secondary px-1" onClick={() => e?.phase.force(p, 8000, Date.now())}>{p}</button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {SFX.map((c) => (
          <button key={c} className="rounded bg-secondary px-1" onClick={() => audio.play(c)}>{c}</button>
        ))}
        {(["fighter", "bomber"] as const).map((k) => (
          <button key={`air-${k}`} className="rounded bg-secondary px-1" onClick={() => {
            // sound check only: sweeps an aircraft voice left to right over its normal lifetime
            const life = k === "fighter" ? 3.1 : 3.8;
            const v = audio.aircraftStart(k, life, true);
            if (!v) return;
            const t0 = performance.now();
            const iv = window.setInterval(() => {
              const u = Math.min(1, (performance.now() - t0) / (life * 1000));
              v.update(-1 + 2 * u, 1 - Math.abs(u - 0.5) * 2, 1 + (0.5 - u) * 0.15, 0);
              if (k === "fighter" && u > 0.1 && u < 0.12) v.guns(life * 0.75, -1 + 2 * u);
              if (k === "bomber" && u > 0.4 && u < 0.42) v.bomb(0.75);
              if (u >= 1) { window.clearInterval(iv); v.stop(); }
            }, 50);
          }}>pass:{k}</button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-1" id="debug-shots">
        {(["wide", "trade", "broadside", "fighter", "bomber", "cascade", "flagship"] as const).map((k) => (
          <button key={k} className="rounded bg-secondary px-1" onClick={() => {
            // camera preview only (debug): points the cinema camera at current real scene state, creates no market event
            const f = e?.flagship(k === "flagship" ? "ask" : "bid");
            const now = performance.now();
            view.shot = k === "wide" ? null : { kind: k, at: now, until: now + 5000, side: k === "flagship" ? "ask" : "bid", ...(f ? { bucket: f.b } : {}) };
            if (k === "flagship" && f) { const d = view.displays.get("ask" + f.b); if (d && !d.departing) d.departing = { kind: "sink", t0: view.time }; }
          }}>cam:{k}</button>
        ))}
      </div>
      <button id="debug-readouts" className="mt-1 rounded bg-secondary px-1" onClick={() => {
        if (!e?.mark) return;
        const trades = e.recentTrades.slice(-3);
        const prices = trades.length === 3 ? trades.map((trade) => trade.price) : [e.mark, e.bestBid, e.bestAsk].filter((price): price is number => typeof price === "number" && price > 0);
        const notionals = trades.length === 3 ? trades.map((trade) => trade.notional) : [e.mark * 3, e.mark * 8, e.mark * 25];
        verifyNavalReadouts(prices, notionals);
      }}>audit 3 live readouts</button>
      <button className="mt-1 rounded bg-primary px-1 text-primary-foreground" onClick={() => triggerClip("Test clip")}>test clip</button>
    </div>
  );
}
