# No Man's Sea — implementation plan

## Goal
Build a mobile-first, live 3D naval battle driven only by Binance USD-M Futures public data. Use the seven supplied GLBs locally, normalized at load and rendered through a reusable model adapter.

## Experience
- Full-screen portrait-first ocean battlefield with Bulls south, Bears north, a central spread channel, and a buoy line at mark price.
- Three switchable fronts: BTCUSDT, ETHUSDT, and BNBUSDT. Switching fully replaces the active socket and open-interest polling.
- Compact command HUD for mark, spread, funding, open interest, latency, ghost rate, liquidation activity, XP, streak, and a collapsible legend.
- Explicit unavailable/connecting states. The battlefield never invents market events or fallback prices.

## Build sequence
1. **Live market engine**
   - Implement the Binance combined WebSocket and 30-second OI poll with cleanup, reconnect backoff, status, and latency.
   - Normalize depth, aggregate trades, liquidations, mark/funding, and OI into typed snapshots and discrete visual events.
   - Add rolling percentile classification, price-level lifecycle tracking, ghost detection, refill detection, volatility windows, and full-war windows as pure testable functions.

2. **Battle state and predictions**
   - Maintain the latest market snapshot and a bounded queue of shots, impacts, sinks, ghosts, repair sparks, air strikes, and convoy changes.
   - Implement rotating 60-second XP-only prediction rounds, truthful market-based resolution, result notices, streaks, and local browser persistence.
   - Pause unresolved questions when the market feed is unavailable rather than guessing outcomes.

3. **3D battlefield**
   - Integrate Three.js Water and Sky using the downloaded local water-normal texture, ACES filmic tone mapping, sun reflections, fog, and volatility-driven sea/sky/rain changes.
   - Render 40 desktop price-level slots (24 on phones) with deterministic horizontal jitter, eased distance and scale updates, merged GLB geometry instanced once per model and side, faction materials, floating battleship/repair labels, buoys, tankers, convoys, and fog banks.
   - Add pooled tracer, shell, torpedo, splash, smoke, fire, bubble, wake, rain, bomb, and repair effects; all timing uses clamped frame delta.
   - Add brief camera shake only for the largest real trades and full-war atmospheric treatment only from qualifying liquidation events.

4. **Responsive HUD and accessibility**
   - Keep primary market stats and prediction controls thumb-reachable in portrait while preserving a wider tactical layout on desktop.
   - Use semantic buttons, readable status colors, reduced-motion handling, and labels/tooltips where icons are not self-evident.
   - Include the required Binance sampling note and attribution footer.

5. **Verification**
   - Unit-test percentile tiers, trade direction, ghost/refill/full-war detection, and prediction resolution.
   - Verify a live desktop and portrait render, tab switching, unavailable-stream behavior, WebGL visibility, asset requests, console output, and interaction states.
   - Keep the scene within the mobile draw-call/particle budget and confirm no placeholder landing page remains.

## Technical notes
- Route `/` will be client-only because WebGL and browser WebSockets must not server-render.
- Market logic will live outside React and Three.js; the scene receives normalized snapshots/events only.
- The seven supplied models will be downloaded into `public/models/`, validated as GLB, merged once at load, auto-centered/scaled, and positioned with their hull bottoms slightly below the waterline. Bulls face north and Bears south.
- Ships of each tier and faction use one `InstancedMesh`; mobile viewports below 768px show 12 levels per side.
- Event visualization is lossy under extreme message volume by design: market state remains current, while bounded visual queues protect frame rate.
- If Binance is region-blocked, the interface reports that condition and leaves the battle inactive; no sample or simulated stream is introduced.
