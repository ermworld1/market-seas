// Server-only settlement: outcomes come from Binance REST, never from the client.
import { battleWinner } from "@/lib/battle/round";
import { FLAGSHIP_MAX_SETTLE_LAG_MS, currentStreak, flagshipOutcome, xpFor } from "./settlement";

const FAPI = "https://fapi.binance.com";
const SYMBOL = "BTCUSDT";

async function getJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Binance ${r.status}`);
  return r.json() as Promise<unknown>;
}

/** Mark-price klines (1m) covering [start, end): open of first, close of last, low/high across. */
export async function markRange(start: number, end: number) {
  const rows = (await getJson(`${FAPI}/fapi/v1/markPriceKlines?symbol=${SYMBOL}&interval=1m&startTime=${start}&endTime=${end - 1}&limit=10`)) as unknown[][];
  if (!Array.isArray(rows) || !rows.length) throw new Error("No klines");
  const open = Number(rows[0]![1]);
  const close = Number(rows[rows.length - 1]![4]);
  let low = Infinity, high = -Infinity;
  for (const k of rows) { low = Math.min(low, Number(k[3])); high = Math.max(high, Number(k[2])); }
  return { open, close, low, high, complete: Number(rows[rows.length - 1]![6]) < Date.now() };
}

/** Displayed BTC size inside a 0.01% bucket starting at `price` on one side of the live book. */
export async function bucketSize(side: "bid" | "ask", price: number) {
  const book = (await getJson(`${FAPI}/fapi/v1/depth?symbol=${SYMBOL}&limit=1000`)) as { bids: string[][]; asks: string[][] };
  const lo = price, hi = price + price * 0.0001;
  let s = 0;
  for (const [p, q] of side === "bid" ? book.bids : book.asks) { const n = Number(p); if (n >= lo && n < hi) s += Number(q); }
  return s;
}

type Row = { id: string; user_id: string; round_kind: string; choice: string; side: string | null; price: number | null; starts_at: string; ends_at: string; start_size: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Idempotently settle due predictions (optionally for one user). Returns number settled. */
export async function settleDue(admin: Admin, opts: { userId?: string; graceMs: number; limit?: number }) {
  const now = Date.now();
  let q = admin.from("predictions").select("id,user_id,round_kind,choice,side,price,starts_at,ends_at,start_size").is("settled_at", null).lte("ends_at", new Date(now - opts.graceMs).toISOString()).order("ends_at", { ascending: true }).limit(opts.limit ?? 50);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data, error } = await q;
  if (error) throw new Error("load failed");
  const rows = (data ?? []) as Row[];
  const marks = new Map<string, Awaited<ReturnType<typeof markRange>>>();
  let settled = 0;
  for (const p of rows) {
    const start = Date.parse(p.starts_at), end = Date.parse(p.ends_at);
    const key = `${start}-${end}`;
    let m = marks.get(key);
    if (!m) { try { m = await markRange(start, end); } catch { continue; } if (!m.complete) continue; marks.set(key, m); }
    let outcome: string; let endSize: number | null = null;
    if (p.round_kind === "winner") outcome = battleWinner(m.open, m.close);
    else if (now - end > FLAGSHIP_MAX_SETTLE_LAG_MS || !p.side || !p.price || p.start_size == null) outcome = "void";
    else {
      try { endSize = await bucketSize(p.side === "bid" ? "bid" : "ask", Number(p.price)); } catch { continue; }
      const price = Number(p.price);
      outcome = flagshipOutcome(Number(p.start_size), endSize, m.low, m.high, price, price * 1.0001);
    }
    const correct = outcome === "void" || outcome === "draw" ? null : outcome === p.choice;
    const { data: hist } = await admin.from("predictions").select("correct").eq("user_id", p.user_id).not("settled_at", "is", null).order("settled_at", { ascending: true }).limit(200);
    const prior = currentStreak(((hist ?? []) as { correct: boolean | null }[]).map((h) => h.correct));
    const xp = xpFor(p.round_kind === "flagship" ? "flagship" : "winner", correct, prior);
    const { data: upd } = await admin.from("predictions").update({ outcome, correct, xp_awarded: xp, settled_at: new Date().toISOString(), start_mark: m.open, end_mark: m.close, end_size: endSize }).eq("id", p.id).is("settled_at", null).select("id");
    if (upd?.length) settled++;
  }
  return settled;
}
