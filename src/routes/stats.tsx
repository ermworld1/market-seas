import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { readAnalytics, type AnalyticsEvent } from "@/lib/analytics";

export const Route = createFileRoute("/stats")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Stats — No Man's Sea" },
      { name: "description", content: "Device-local usage stats for No Man's Sea: page views, tours, sound, first kill and battles watched." },
      { property: "og:title", content: "Stats — No Man's Sea" },
      { property: "og:description", content: "Device-local usage stats for the live order-flow naval battle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Stats,
});

function Stats() {
  const [ev, setEv] = useState<AnalyticsEvent[]>([]);
  useEffect(() => setEv(readAnalytics()), []);
  const count = (n: string) => ev.filter((e) => e.n === n).length;
  const nums = (n: string) => ev.filter((e) => e.n === n && typeof e.v === "number").map((e) => e.v as number);
  const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);
  const views = count("page_view");
  const rows: [string, string | number][] = [
    ["Page views", views],
    ["Tours completed", count("tour_done")],
    ["Sound turned on", count("sound_on")],
    ["Median seconds to first kill", med(nums("first_kill_seen")) ?? "—"],
    ["Battles watched to the end", count("battle_watched_to_end")],
    ["Predictions made", count("prediction_made")],
    ["Median session length (s)", med(nums("session_end")) ?? "—"],
  ];
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-3xl font-bold uppercase tracking-widest text-primary">Stats</h1>
        <p className="mt-1 text-sm text-muted-foreground">Recorded on this device only. Nothing is sent anywhere.</p>
        <table className="mt-6 w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-border/60">
                <td className="py-2">{k}</td>
                <td className="hud-num py-2 text-right">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 className="mt-8 font-display text-lg uppercase tracking-wider">Recent events</h2>
        <ol className="mt-2 max-h-80 overflow-y-auto font-mono text-xs text-muted-foreground">
          {ev.slice(-80).reverse().map((e, i) => (
            <li key={i}>{new Date(e.t).toISOString().replace("T", " ").slice(0, 19)} {e.n}{e.v !== undefined ? ` ${e.v}` : ""}</li>
          ))}
        </ol>
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline">Back to the battle</Link>
      </div>
    </main>
  );
}
