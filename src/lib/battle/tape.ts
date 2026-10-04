export type OrderPrint = { a: string; orderSide: number; hash?: string | undefined; trade: number; sz: number; fills: number; at: number };
export function orderKey(o: OrderPrint): string { const address = o.a.toLowerCase(); return o.hash ? `t|${o.hash.toLowerCase()}|${address}|${o.orderSide}` : `t|${address}|${o.orderSide}|${Math.floor(o.at / 300)}`; }
export class TapePipeline {
  private orders = new Map<string, OrderPrint>(); private seen = new Map<string, number>(); rawPrints = 0;
  aggregate(print: OrderPrint): string { this.rawPrints += print.fills; const key = orderKey(print), previous = this.orders.get(key);
    if (previous) { previous.trade += print.trade; previous.sz += print.sz; previous.fills += print.fills; } else this.orders.set(key, { ...print }); return key; }
  take(key: string): OrderPrint | undefined { const order = this.orders.get(key); this.orders.delete(key); return order; }
  accept(key: string, time: number, window: number): boolean { const last = this.seen.get(key); if (last !== undefined && time - last < window) return false; this.seen.set(key, time);
    if (this.seen.size > 3000) for (const [k, at] of this.seen) if (time - at > 600_000) this.seen.delete(k); return true; }
}
