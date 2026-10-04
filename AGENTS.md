<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Architecture rules

- Market logic lives in `src/lib/market/` (pure engine, rules, predictions) with no React/three imports — keeps event detection unit-testable.
- Only `binance.ts` touches sockets/fetch; it feeds `MarketEngine`, which emits `BattleEvent`s — the scene never parses raw Binance payloads.
- Binance USD-M streams are split: depth on `/public/stream`, trades/mark/liquidations on `/market/stream` — the legacy `/stream` URL only delivers depth.
- The book is a full local book (REST snapshot + `@depth@100ms` diffs, U/u/pu sync in `src/lib/battle/book.ts`); depth20 is only a fallback flagged as partial — keeps bucket sizes truthful.
- Ships are 0.01%-of-price buckets keyed by absolute bucket number; `SideTracker` turns per-tick bucket deltas + fills into order events — one pure, tested rule engine.
- `src/lib/battle/walls.ts` and `tape.ts` are verbatim copies (prettier-ignored); adapt their inputs, never their bodies.
- The phase machine, battle clock and rules are time-injected — so they stay unit-testable.
- Labels are fixed DOM nodes positioned via rAF from projected anchors (`screen.ts`), never drei Html — avoids mount/unmount during render.
- The battlefield price axis is X: Buyers left, Sellers right, moving vertical mark front; the orthographic 65° camera keeps both fleets at equal scale.
- Audio categories each have a sample slot (/sfx, /music, /vo) with procedural fallback — samples drop in without code changes.
- Each subsystem renders inside `Guard` — one failure never blanks the page.
- Analytics stay in localStorage (device-local /stats) — no backend.
- The 3D scene reads `engineRef` and the mutable `view` object inside `useFrame`; React state (zustand) is only for the HUD, throttled to 250 ms — avoids 60 Hz re-renders.
- `Fleet` drains engine events once per frame into `view.frameEvents` and must mount before `Effects` — both consume the same frame's events.
- Textured GLBs preserve authored UVs/PBR material groups; each primitive is normalized once and instanced per model/LOD, while every loaded material is cloned with emissive forced off — preserves real paint without sacrificing fleet draw-call budgets.
- Fire events are never dropped: the projectile pool recycles the oldest shot when full.
- Particles use pooled point-sprite buffers (`ParticlePool`) and projectiles a single InstancedMesh — no per-effect React components.
- The `/` route is `ssr: false` and lazy-loads the battle — WebGL, WebSocket and localStorage are browser-only.
- Nothing is rendered from simulated data: background layers stay hidden until real data arrives.
- Community profiles and predictions use authenticated server functions; public rankings expose aggregate scores only.
- Cinema direction and quality adaptation consume existing real events and mutable scene state; they never create market events.
- Unit cards are rendered and cached at runtime from the battle's shared GLBs and materials so guides cannot visually drift from the scene.
