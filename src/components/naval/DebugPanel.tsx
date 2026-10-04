import { useEffect, useState } from "react";
import { engineRef } from "@/lib/market/store";
import type { Phase } from "@/lib/battle/phase";
import { audio, SFX } from "@/lib/audio/engine";
import { triggerClip } from "./useDirector";
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
    <div id="debug-panel" className="pointer-events-auto absolute bottom-24 left-2 z-30 max-h-[35vh] w-64 overflow-y-auto rounded bg-background/90 p-2 font-mono text-[10px] text-foreground">
      <div className="font-bold">DEBUG</div>
      <div>phase {e?.phase.current} · frame {view.frameMs.toFixed(1)}ms</div>
      <div>tris {info?.triangles ?? "?"} · calls {info?.calls ?? "?"}</div>
      <div>trades rx {e?.tradesReceived ?? 0} · viz {e?.tradesVisualized ?? 0} · tracers {e?.tracersSpawned ?? 0}</div>
      <div>book {e?.book.bids.size ?? 0}/{e?.book.asks.size ?? 0} lvls · {e?.partial ? "partial" : "full"} · u={e?.book.lastU}</div>
      <div>ships {view.visible.bid.length}/{view.visible.ask.length} · audio played {audio.played} dropped {audio.dropped}</div>
      <div>AudioContext <span id="debug-actx">{audio.state}</span> · enabled {String(audio.enabled)} · max fire gap {(fireStats.maxGap / 1000).toFixed(2)}s</div>
      <pre id="debug-sfx" className="whitespace-pre-wrap">sfx {JSON.stringify(audio.byCat)}</pre>
      <div id="debug-vo">voice {audio.voPlayed.length}: {audio.voPlayed.slice(-6).join(", ")}</div>
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
      </div>
      <button className="mt-1 rounded bg-primary px-1 text-primary-foreground" onClick={() => triggerClip("Test clip")}>test clip</button>
    </div>
  );
}
