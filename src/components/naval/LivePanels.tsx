import { useMemo, useState } from "react";
import { UnitSections } from "./Units";
import { ExternalLink } from "lucide-react";
import { bucketOf, bucketWidth } from "@/lib/battle/buckets";
import { fmtPrice, usd } from "@/lib/market/predictions";
import { useBattle, type TapeLine } from "@/lib/market/store";
import { view } from "./layout";
import { cn } from "@/lib/utils";

const tone: Record<TapeLine["tone"], string> = { buy: "text-bull", sell: "text-bear", sub: "text-sub", liq: "text-danger", info: "text-ok" };

const GROUPS = [0.1, 1, 10, 50, 100];
const btc = (n: number) => n.toFixed(3);
type BookView = "both" | "bids" | "asks";
function ViewIcon({ v }: { v: BookView }) {
  const bar = (c: string) => <span className={cn("block h-[3px] w-full rounded-[1px]", c)} />;
  return <span className="grid w-3 gap-[1px]">{v !== "bids" && <>{bar("bg-bear")}{bar("bg-bear")}</>}{v !== "asks" && <>{bar("bg-bull")}{bar("bg-bull")}</>}{v !== "both" && <>{bar(v === "bids" ? "bg-bull" : "bg-bear")}{bar(v === "bids" ? "bg-bull" : "bg-bear")}</>}</span>;
}
/** Raw Binance levels from the synced local book, styled like the Binance Futures order book widget. */
export function OrderBookPanel() {
  const ladder = useBattle((s) => s.ladder);
  const selectedBucket = useBattle((s) => s.selectedBucket);
  const mark = useBattle((s) => s.hud.mark);
  const group = useBattle((s) => s.bookGroup);
  const sync = useBattle((s) => s.bookSync);
  const last = useBattle((s) => s.recentTrades[0]);
  const prev = useBattle((s) => s.recentTrades.find((t) => t.price !== s.recentTrades[0]?.price));
  const [mode, setMode] = useState<BookView>("both");
  const asks = useMemo(() => [...ladder.asks].reverse(), [ladder]);
  const maxSum = Math.max(ladder.bids[ladder.bids.length - 1]?.sum ?? 0, ladder.asks[ladder.asks.length - 1]?.sum ?? 0, 1e-9);
  const bidTot = ladder.bids[ladder.bids.length - 1]?.sum ?? 0;
  const askTot = ladder.asks[ladder.asks.length - 1]?.sum ?? 0;
  const bPct = bidTot + askTot > 0 ? Math.round((bidTot / (bidTot + askTot)) * 100) : 50;
  const up = !prev || !last || last.price >= prev.price;
  const synced = !!sync && sync.ok && Date.now() - sync.at < 40_000;
  const row = (r: (typeof ladder.bids)[number], i: number) => {
    const selected = selectedBucket?.side === r.side && selectedBucket.b === r.bucket;
    const ask = r.side === "ask";
    return <button key={`${r.side}-${r.price}-${i}`} data-side={r.side} className={cn("relative grid w-full grid-cols-3 px-3 py-[1.5px] text-right tabular-nums hover:bg-bn-hover", selected && "bg-bn-hover ring-1 ring-inset ring-primary")}
      onClick={() => { const pick = { side: r.side, b: r.bucket }; useBattle.setState({ selectedBucket: pick }); view.selectedBucket = pick; }}>
      <span aria-hidden className={cn("absolute inset-y-0 right-0", ask ? "bg-bear/15" : "bg-bull/15")} style={{ width: `${(r.sum / maxSum) * 100}%` }} />
      <span className={cn("relative text-left", ask ? "text-bear" : "text-bull")}>{r.price.toFixed(1)}</span><span className="relative text-bn-text">{btc(r.qty)}</span><span className="relative text-bn-text">{btc(r.sum)}</span>
    </button>;
  };
  return <div id="book-panel" className="bn-book flex h-full min-h-0 flex-col font-mono text-[11px]">
    <div className="flex items-center justify-between gap-1 border-b border-bn-line px-3 py-2 font-sans">
      <span className="text-sm font-semibold text-bn-text">Order Book</span>
      <span className="flex items-center gap-1.5">
        {(["both", "bids", "asks"] as BookView[]).map((v) => <button key={v} aria-label={`Show ${v === "both" ? "bids and asks" : v + " only"}`} aria-pressed={mode === v} onClick={() => setMode(v)} className={cn("rounded p-1", mode === v ? "bg-bn-hover" : "opacity-50 hover:opacity-100")}><ViewIcon v={v} /></button>)}
        <select aria-label="Price grouping" value={group} onChange={(e) => useBattle.setState({ bookGroup: Number(e.target.value) })} className="rounded bg-bn-hover px-1 py-0.5 text-[11px] text-bn-text outline-none">
          {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </span>
    </div>
    <div className="grid grid-cols-3 px-3 py-1 text-right font-sans text-[10px] text-bn-muted"><span className="text-left">Price (USDT)</span><span>Size (BTC)</span><span>Sum (BTC)</span></div>
    <div className="min-h-0 flex-1 overflow-auto">
      {mode !== "bids" && asks.map(row)}
      <div id="book-spread" className="flex items-baseline gap-2 px-3 py-1.5">
        <span className={cn("text-lg font-bold tabular-nums", up ? "text-bull" : "text-bear")}>{last ? last.price.toFixed(1) : "—"} {last ? (up ? "↑" : "↓") : ""}</span>
        <span className="text-bn-muted underline decoration-dotted">{mark ? mark.toFixed(1) : "—"}</span>
        <span id="book-sync" className={cn("ml-auto font-sans text-[10px]", synced ? "text-bull" : "text-bn-muted")}>{synced ? "Synced with Binance ✓" : "Resyncing…"}</span>
      </div>
      {mode !== "asks" && ladder.bids.map(row)}
      {!ladder.bids.length && <div className="p-3 text-bn-muted">Waiting for live book…</div>}
    </div>
    <div id="book-ratio" className="flex items-center gap-2 border-t border-bn-line px-3 py-1.5 text-[10px]">
      <span className="text-bull">B <span className="text-bn-text">{bPct}%</span></span>
      <span className="flex h-1 flex-1 overflow-hidden rounded"><span className="bg-bull" style={{ width: `${bPct}%` }} /><span className="flex-1 bg-bear" /></span>
      <span className="text-bn-text">{100 - bPct}% <span className="text-bear">S</span></span>
    </div>
  </div>;
}

export function RecentTradesPanel() {
  const trades = useBattle((s) => s.recentTrades);
  return <div className="min-h-0 overflow-auto font-mono text-[10px]">
    <div className="sticky top-0 grid grid-cols-[1.2fr_1fr_1fr_1fr] bg-background/95 px-2 py-1 text-muted-foreground"><span>ID · time</span><span>Price</span><span>BTC</span><span>Notional</span></div>
    {trades.map((t) => <div key={`${t.aggId}-${t.time}`} className={cn("grid grid-cols-[1.2fr_1fr_1fr_1fr] px-2 py-0.5", t.taker === "buy" ? "text-bull" : "text-bear")}>
      <span>#{t.aggId} · {new Date(t.time).toISOString().slice(11, 23)}</span><span>{fmtPrice(t.price)}</span><span>{t.qty.toFixed(4)}</span><span>{usd(t.notional)}</span>
    </div>)}
    {!trades.length && <div className="p-3 text-muted-foreground">Waiting for real trades…</div>}
  </div>;
}

export function TapePanel() {
  const tape = useBattle((s) => s.tape);
  return <ol className="min-h-0 space-y-1 overflow-auto p-2 font-mono text-[10px]">{tape.map((l) => <li key={l.id} className={tone[l.tone]}><span className="text-muted-foreground">{new Date(l.t).toISOString().slice(11, 19)}</span> {l.text}</li>)}</ol>;
}

export function GuidePanel() {
  return <div className="min-h-0 overflow-auto p-2"><p className="text-xs text-foreground/90">The middle vertical line is the live BTC price. <span className="text-bull">Buyers</span> wait left; <span className="text-bear">Sellers</span> wait right.</p><UnitSections /><a className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary" href="https://www.binance.com/en/futures/BTCUSDT" target="_blank" rel="noreferrer">Open BTCUSDT on Binance <ExternalLink className="h-3 w-3" /></a></div>;
}

/** Raw Binance levels (not ship buckets), grouped like the Binance DOM: bids floor, asks ceil to the step. */
export function makeLadder(levels: Map<number, number>, side: "bid" | "ask", mark: number, group = 0.1, n = 20) {
  const sorted = [...levels].sort((a, b) => (side === "bid" ? b[0] - a[0] : a[0] - b[0]));
  const out: { side: "bid" | "ask"; price: number; qty: number; notional: number; cumulative: number; sum: number; bucket: number }[] = [];
  const w = bucketWidth(mark);
  const k = Math.round(1 / Math.min(group, 1)) || 1;
  let sum = 0;
  let cumulative = 0;
  for (const [price, qty] of sorted) {
    const g = group <= 0.1 ? price : (side === "bid" ? Math.floor(price / group + 1e-9) : Math.ceil(price / group - 1e-9)) * group;
    const gp = Math.round(g * k) / k;
    const last = out[out.length - 1];
    sum += qty;
    cumulative += price * qty;
    if (last && Math.abs(last.price - gp) < 1e-9) { last.qty += qty; last.notional += price * qty; last.sum = sum; last.cumulative = cumulative; continue; }
    if (out.length >= n) break;
    out.push({ side, price: gp, qty, notional: price * qty, cumulative, sum, bucket: bucketOf(price, w) });
  }
  return out;
}
