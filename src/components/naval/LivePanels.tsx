import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { bucketOf, bucketWidth } from "@/lib/battle/buckets";
import { fmtPrice, usd } from "@/lib/market/predictions";
import { useBattle, type TapeLine } from "@/lib/market/store";
import { view } from "./layout";
import { cn } from "@/lib/utils";

const tone: Record<TapeLine["tone"], string> = { buy: "text-bull", sell: "text-bear", sub: "text-sub", liq: "text-danger", info: "text-ok" };

export function OrderBookPanel() {
  const { ladder, selectedBucket, hud } = useBattle();
  const rows = useMemo(() => [...ladder.asks].reverse().concat(ladder.bids), [ladder]);
  return <div className="min-h-0 overflow-auto font-mono text-[10px]">
    <div className="sticky top-0 z-10 grid grid-cols-[1fr_.8fr_1fr_1fr] bg-background/95 px-2 py-1 text-muted-foreground"><span>Price</span><span>BTC</span><span>Notional</span><span>Cumulative</span></div>
    {rows.map((r, i) => {
      const selected = selectedBucket?.side === r.side && selectedBucket.b === r.bucket;
      return <button key={`${r.side}-${r.price}-${i}`} className={cn("grid w-full grid-cols-[1fr_.8fr_1fr_1fr] px-2 py-0.5 text-left hover:bg-accent", r.side === "bid" ? "text-bull" : "text-bear", selected && "bg-primary/20 ring-1 ring-inset ring-primary")}
        onClick={() => { const pick = { side: r.side, b: r.bucket }; useBattle.setState({ selectedBucket: pick }); view.selectedBucket = pick; }}>
        <span>{fmtPrice(r.price)}</span><span>{r.qty.toFixed(3)}</span><span>{usd(r.notional)}</span><span>{usd(r.cumulative)}</span>
      </button>;
    })}
    {!rows.length && <div className="p-3 text-muted-foreground">Waiting for live book…</div>}
    <div className="sticky bottom-0 border-t border-border bg-background/95 px-2 py-1 text-center text-primary">MARK {hud.mark ? fmtPrice(hud.mark) : "—"}</div>
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

export function makeLadder(levels: Map<number, number>, side: "bid" | "ask", mark: number) {
  const sorted = [...levels].sort((a, b) => side === "bid" ? b[0] - a[0] : a[0] - b[0]).slice(0, 25);
  let cumulative = 0;
  const w = bucketWidth(mark);
  return sorted.map(([price, qty]) => { const notional = price * qty; cumulative += notional; return { side, price, qty, notional, cumulative, bucket: bucketOf(price, w) }; });
}