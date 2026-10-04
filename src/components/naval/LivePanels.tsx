import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { bucketOf, bucketWidth } from "@/lib/battle/buckets";
import { fmtPrice, usd } from "@/lib/market/predictions";
import { useBattle, type TapeLine } from "@/lib/market/store";
import { view } from "./layout";
import { cn } from "@/lib/utils";

const tone: Record<TapeLine["tone"], string> = { buy: "text-bull", sell: "text-bear", sub: "text-sub", liq: "text-danger", info: "text-ok" };

const GROUPS = [0.1, 1, 10, 50, 100];
const btc = (n: number) => n.toFixed(3);
/** Raw Binance levels from the synced local book, laid out like the Binance order book. */
export function OrderBookPanel() {
  const ladder = useBattle((s) => s.ladder);
  const selectedBucket = useBattle((s) => s.selectedBucket);
  const mark = useBattle((s) => s.hud.mark);
  const group = useBattle((s) => s.bookGroup);
  const sync = useBattle((s) => s.bookSync);
  const last = useBattle((s) => s.recentTrades[0]);
  const asks = useMemo(() => [...ladder.asks].reverse(), [ladder]);
  const now = Date.now();
  const synced = !!sync && sync.ok && now - sync.at < 40_000;
  const row = (r: (typeof ladder.bids)[number], i: number) => {
    const selected = selectedBucket?.side === r.side && selectedBucket.b === r.bucket;
    return <button key={`${r.side}-${r.price}-${i}`} className={cn("grid w-full grid-cols-3 px-2 py-[1px] text-left hover:bg-accent", selected && "bg-primary/20 ring-1 ring-inset ring-primary")}
      onClick={() => { const pick = { side: r.side, b: r.bucket }; useBattle.setState({ selectedBucket: pick }); view.selectedBucket = pick; }}>
      <span className={r.side === "bid" ? "text-bull" : "text-bear"}>{r.price.toFixed(1)}</span><span className="text-right">{btc(r.qty)}</span><span className="text-right text-muted-foreground">{btc(r.sum)}</span>
    </button>;
  };
  return <div id="book-panel" className="flex h-full min-h-0 flex-col font-mono text-[10px]">
    <div className="flex items-center justify-between gap-1 px-2 py-1">
      <span id="book-sync" className={synced ? "text-ok" : "text-muted-foreground"}>{synced ? "Synced with Binance ✓" : "Resyncing…"}</span>
      <span className="flex gap-0.5">{GROUPS.map((g) => <button key={g} onClick={() => useBattle.setState({ bookGroup: g })} className={cn("rounded px-1", g === group ? "bg-primary text-primary-foreground" : "bg-secondary")}>{g}</button>)}</span>
    </div>
    <div className="grid grid-cols-3 px-2 py-0.5 text-muted-foreground"><span>Price (USDT)</span><span className="text-right">Size (BTC)</span><span className="text-right">Sum (BTC)</span></div>
    <div className="min-h-0 flex-1 overflow-auto">
      {asks.map(row)}
      <div id="book-spread" className="flex items-baseline justify-between border-y border-border px-2 py-1">
        <span className={cn("text-sm font-bold", last?.taker === "sell" ? "text-bear" : "text-bull")}>{last ? last.price.toFixed(1) : "—"}</span>
        <span className="text-muted-foreground">Mark {mark ? mark.toFixed(1) : "—"}</span>
      </div>
      {ladder.bids.map(row)}
      {!ladder.bids.length && <div className="p-3 text-muted-foreground">Waiting for live book…</div>}
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

const GUIDE = [
  ["Patrol boat", "Small resting order."], ["Destroyer", "Medium-small resting order."], ["Frigate", "Mid-sized resting order."], ["Cruiser", "One of the largest orders."], ["Flagship", "Largest visible order on its side."],
  ["Machine gun", "Small real trade with one tracer per fill."], ["Deck gun", "Medium real trade."], ["Torpedo", "Large real trade."], ["Broadside", "Very large real trade."], ["Fighter", "A single ≥$500K taker order above the 97th percentile."],
  ["Bomber", "A real Binance liquidation."], ["Submarine dive", "A large order vanished before contact."], ["Fled", "A large order pulled within 0.03% of price."], ["Surface / relocate", "A similar order reappeared at least two buckets away within 300ms."], ["Hidden reserves", "Trades exceeded displayed size; possible iceberg."],
  ["Repair", "Repeated real refills after damage."], ["Reinforce", "Real size added to a price bucket."], ["Sink", "Displayed size was fully traded."], ["Convoy", "Open interest changed."], ["Oil tanker", "Funding-rate state at the fleet rear."], ["Storm", "Volatility and liquidation intensity."],
] as const;
export function GuidePanel() { return <div className="min-h-0 overflow-auto p-2"><p className="mb-2 text-xs text-foreground/90">The middle vertical line is live BTC price. Buy orders wait left; sell orders wait right.</p><ul className="grid gap-1.5 text-[11px] sm:grid-cols-2">{GUIDE.map(([name, text]) => <li key={name} className="border-l-2 border-primary/50 pl-2"><strong className="text-primary">{name}</strong><span className="block text-muted-foreground">{text}</span></li>)}</ul><a className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary" href="https://www.binance.com/en/futures/BTCUSDT" target="_blank" rel="noreferrer">Open BTCUSDT on Binance <ExternalLink className="h-3 w-3" /></a></div>; }

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
