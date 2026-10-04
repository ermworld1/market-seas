import type { MarketEngine } from "./engine";
import type { StreamStatus } from "./types";

// Binance routes USD-M market data by traffic class: order-book streams on
// /public, trades / mark price / liquidations on /market.
const WS_PUBLIC = "wss://fstream.binance.com/public/stream?streams=";
const WS_MARKET = "wss://fstream.binance.com/market/stream?streams=";
const REST = "https://fapi.binance.com";

export interface FeedInfo {
  partial: boolean;
}

/** Connects the engine to live Binance public data. Returns a disposer. */
export function connectFront(
  engine: MarketEngine,
  onStatus: (s: StreamStatus, detail?: string) => void,
  onFeed?: (f: FeedInfo) => void,
) {
  const sym = engine.symbol.toLowerCase();
  let disposed = false;
  const live: boolean[] = [];
  const failed: boolean[] = [];
  const report = () => {
    if (disposed) return;
    if (live.some(Boolean)) onStatus("live");
    else if (failed.length >= 2 && failed[0] && failed[1]) onStatus("unavailable", "Binance did not answer the stream connection");
    else onStatus("connecting");
  };

  const handle = (raw: string) => {
    let msg: { stream: string; data: any };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    const s = msg.stream.toLowerCase();
    const d = msg.data;
    try {
      if (s.endsWith("@depth@100ms")) engine.handleDiff(d, now);
      else if (s.endsWith("@depth20@100ms")) engine.handlePartial(d.b, d.a, now);
      else if (s.endsWith("@aggtrade")) engine.handleTrade(d, now);
      else if (s.endsWith("@forceorder")) engine.handleForce(d.o, now);
      else if (s.endsWith("@markprice@1s")) engine.handleMark(d, now);
    } catch (err) {
      console.error("[data] message handler failed", err);
    }
  };

  const openSocket = (url: string, idx: number) => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    live[idx] = false;
    failed[idx] = false;
    const open = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(url);
      } catch {
        failed[idx] = true;
        report();
        return;
      }
      watchdog = setTimeout(() => {
        if (!live[idx]) {
          failed[idx] = true;
          report();
          ws?.close();
        }
      }, 10_000);
      ws.onmessage = (ev) => {
        if (!live[idx]) {
          live[idx] = true;
          failed[idx] = false;
          attempt = 0;
          report();
        }
        handle(ev.data as string);
      };
      ws.onclose = () => {
        clearTimeout(watchdog);
        if (disposed) return;
        if (!live[idx] || attempt >= 2) failed[idx] = true;
        live[idx] = false;
        attempt++;
        if (idx === 0) engine.needSnapshot = true;
        report();
        retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      };
    };
    open();
    return () => {
      clearTimeout(retry);
      clearTimeout(watchdog);
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
      }
    };
  };

  const closers = [
    openSocket(`${WS_PUBLIC}${sym}@depth@100ms`, 0),
    openSocket(`${WS_MARKET}${sym}@aggTrade/${sym}@forceOrder/${sym}@markPrice@1s`, 1),
  ];
  onStatus("connecting");

  const ctrl = new AbortController();
  const getJSON = (path: string) => fetch(REST + path, { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

  // ── full book: snapshot + diff sync, depth20 fallback
  let snapFails = 0;
  let snapBusy = false;
  let partialSocket: (() => void) | null = null;
  const snapTimer = setInterval(() => {
    if (disposed || snapBusy || !engine.needSnapshot || !live[0] || partialSocket) return;
    snapBusy = true;
    getJSON(`/fapi/v1/depth?symbol=${engine.symbol}&limit=1000`)
      .then((s) => {
        snapFails = 0;
        engine.handleSnapshot(s, Date.now());
      })
      .catch(() => {
        snapFails++;
        if (snapFails >= 2 && !partialSocket && !disposed) {
          partialSocket = openSocket(`${WS_PUBLIC}${sym}@depth20@100ms`, 2);
          onFeed?.({ partial: true });
        }
      })
      .finally(() => {
        snapBusy = false;
      });
  }, 600);

  getJSON(`/fapi/v1/klines?symbol=${engine.symbol}&interval=1m&limit=16`)
    .then((rows: any[]) => engine.seedCloses(rows.map((r) => ({ openTime: r[0], close: +r[4] }))))
    .catch(() => {});
  getJSON(`/futures/data/openInterestHist?symbol=${engine.symbol}&period=5m&limit=2`)
    .then((rows: any[]) => {
      if (rows?.[0]) engine.seedOIBase(rows[0].timestamp, +rows[0].sumOpenInterest);
    })
    .catch(() => {});
  const pollOI = () =>
    getJSON(`/fapi/v1/openInterest?symbol=${engine.symbol}`)
      .then((r: any) => engine.setOI(+r.openInterest, Date.now()))
      .catch(() => {});
  pollOI();
  const oiTimer = setInterval(pollOI, 30_000);

  return () => {
    disposed = true;
    clearInterval(oiTimer);
    clearInterval(snapTimer);
    ctrl.abort();
    closers.forEach((close) => close());
    partialSocket?.();
  };
}
