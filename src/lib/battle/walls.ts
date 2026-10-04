export type Level = { px: string | number; sz: string | number };
export type Wall = { key: string; side: 1 | -1; px: number; sz: number; shown: number; hitAt: number; ghostAt: number; gone: boolean };
export const WALL_PCT = 0.9; export const MAX_PER_SIDE = 6; export const EASE_MS = 250; export const GHOST_MS = 1200; export const HIT_GRACE_MS = 3000;
export function percentile(v: number[], p: number): number { if (!v.length) return Infinity; const s = [...v].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1)); return s[i]!; }
export function pickWalls(bids: Level[], asks: Level[], pct = WALL_PCT, max = MAX_PER_SIDE) {
  const all = [...bids, ...asks].map((l) => +l.px * +l.sz).filter((n) => n > 0); const cut = percentile(all, pct);
  const pick = (ls: Level[], side: 1 | -1) => ls.filter((l) => +l.px * +l.sz >= cut && +l.sz > 0).sort((a, b) => +b.px * +b.sz - +a.px * +a.sz).slice(0, max).map((l) => ({ side, px: +l.px, sz: +l.sz }));
  return [...pick(bids, 1), ...pick(asks, -1)];
}
export function createWalls() {
  const walls = new Map<string, Wall>(); const key = (side: number, px: number) => (side === 1 ? "b" : "a") + px;
  function update(bids: Level[], asks: Level[], t: number) {
    const picked = pickWalls(bids, asks); const live = new Set<string>();
    for (const p of picked) { const k = key(p.side, p.px); live.add(k); const w = walls.get(k);
      if (w && !w.gone) { w.sz = p.sz; w.ghostAt = 0; } else walls.set(k, { key: k, side: p.side, px: p.px, sz: p.sz, shown: w?.shown ?? 0, hitAt: 0, ghostAt: 0, gone: false }); }
    const inBook = new Set<string>(); for (const l of bids) inBook.add(key(1, +l.px)); for (const l of asks) inBook.add(key(-1, +l.px));
    for (const w of walls.values()) { if (live.has(w.key) || w.gone || w.ghostAt) continue;
      if (inBook.has(w.key)) w.sz = 0; else if (t - w.hitAt < HIT_GRACE_MS) { w.gone = true; w.sz = 0; } else w.ghostAt = t; }
  }
  function erode(dir: 1 | -1, px: number, sz: number, t: number): Wall | null {
    let hit: Wall | null = null;
    for (const w of walls.values()) { if (w.gone || w.ghostAt) continue;
      if (dir === 1 && w.side === -1 && w.px <= px) hit = !hit || w.px < hit.px ? w : hit;
      if (dir === -1 && w.side === 1 && w.px >= px) hit = !hit || w.px > hit.px ? w : hit; }
    if (!hit) return null; hit.sz = Math.max(0, hit.sz - sz); hit.shown = Math.min(hit.shown, hit.sz + (hit.shown - hit.sz) * 0.4); hit.hitAt = t; if (hit.sz <= 0) hit.gone = true; return hit;
  }
  function tick(dt: number, t: number) { const k = Math.min(1, dt / EASE_MS);
    for (const w of walls.values()) { const target = w.ghostAt ? w.shown : w.sz; w.shown += (target - w.shown) * k;
      const dead = w.ghostAt ? t - w.ghostAt > GHOST_MS : (w.gone || w.sz === 0) && w.shown < 1e-6 + w.sz * 0.02;
      if (dead && (w.ghostAt || w.shown < 1e-4)) walls.delete(w.key); } }
  return { walls, update, erode, tick };
}
