# Market Seas

Build "No Man's Sea": a live, real-time 3D naval battle that visualizes Binance USD-M Futures order flow. Every ship, shot and bomb is driven by real public market data. Nothing is simulated. UI language: English. Mobile-first portrait layout, also works well on desktop.

TECH
- React + three.js via @react-three/fiber and @react-three/drei. Realistic ocean using three.js examples Water shader (three/examples/jsm/objects/Water.js) with a waternormals texture (download https://threejs.org/examples/textures/waternormals.jpg into /public/textures/) plus the Sky shader for sun reflection, subtle fog, ACES filmic tone mapping. The ocean must look real: animated normals, sun glints, depth color, foam/wake particles behind moving or hit ships.
- Ship 3D models (GLB) will be provided in my next message as URLs; download them into /public/models/. Until they arrive, use simple placeholder hull meshes with the same API so the swap is one line. Models are untextured grey: auto-center, auto-scale by bounding box, rotate so the longest axis is along X, then apply a per-side MeshStandardMaterial (Bulls: deep gold hull, metalness 0.6, roughness 0.4, warm emissive trim; Bears: dark gunmetal hull with red accents). Clone models, cap draw calls, target 60fps desktop / 30fps mid-range phone.

DATA (client-side WebSocket, no backend needed)
- wss://fstream.binance.com/stream?streams={sym}@depth20@100ms/{sym}@aggTrade/{sym}@forceOrder/{sym}@markPrice@1s
- Open interest: poll https://fapi.binance.com/fapi/v1/openInterest?symbol=SYM every 30s.
- Three fronts as tabs: BTCUSDT (default), ETHUSDT, BNBUSDT. Switching tab switches streams.
- If the stream cannot connect (e.g. region blocked), show a clear "Binance stream unavailable" state. Never generate fake data. Header shows data latency (ms since last message): yellow >2s, red >10s.

LAYOUT
- Camera: perspective, looking down at ~35 degrees over a horizontal strait across the middle of the screen. Bears fleet on the far (north) side = asks (sell limit orders, higher prices). Bulls fleet on the near (south) side = bids (buy limit orders, lower prices). The narrow water band in the middle = the spread, no-man's sea. A row of glowing buoys marks the mark price line.
- Each of the 20 visible price levels per side is one ship slot. Distance from the center strait = price distance from mark price. Ships at the same row are spread horizontally with slight jitter so the fleet looks natural.

FLEET (resting limit orders). Size tiers by rolling percentile of level notional on that front (not absolute USD), so BNB also gets battleships:
- small: patrol boat
- large: frigate
- top percentile (walls, ~top 10%): cruiser
- single largest level on each side: battleship, with a floating label "Battleship 84,200" (its price).
Ship scale grows smoothly with notional inside its tier. When a level's size changes, the ship eases to its new scale.

GHOST SHIPS: if a cruiser/battleship level disappears before any trade printed at that price (check aggTrades in the last few seconds), the ship does not sink: it drifts back into a smoke/fog bank and fades out over ~1.5s. Count ghosts per minute in the HUD.

REPAIR CREWS (inferred): if a level is hit by trades and refilled at the same price 2+ times within 10s, show green repair sparks on the hull and a small tag "repair (inferred)" — it may be an iceberg or a market maker refilling.

FIREPOWER (aggTrade). Taker buys fire from the Bulls fleet north at the Bears ship on the traded price; taker sells fire south. Weapon by percentile of trade notional on that front:
- small: deck machine-gun tracers
- medium: deck gun salvo
- large: torpedo with a short visible wake on the water (travel time under 0.5s so it never lags data)
- very large: battleship main battery broadside, screen shake, big splash.
Hits damage the target ship in proportion to filled quantity / level quantity (smoke, fire, list). When the last ship at a price level is consumed the ship sinks (tilts, goes under, bubbles and foam) and the buoy line advances one notch: the price moved.

AIR STRIKES (forceOrder liquidations): a bomber flies in and drops bombs on the rear of the liquidated side (liquidated longs = SELL force orders → bombs on the Bulls rear; liquidated shorts → Bears rear). 3+ liquidations within 10s on a front = "FULL WAR" mode: storm sky, heavier rain, red tint on the HUD. Show a small permanent note: "Liquidations are sampled by Binance: max 1 per second per symbol."

SLOW BACKGROUND LAYERS (must never compete with firepower):
- Open interest: OI up >0.3% over 5 min → a convoy of transport ships sails in from the horizon behind the side whose price is gaining; OI down → ships sail out of view.
- Funding rate: one oil tanker at the rear of each fleet. The side paying funding (positive funding = longs/Bulls pay) has a leaking tanker with a spreading oil slick on the water.
- Volatility: realized volatility from 1-minute returns over the last 15 minutes drives sea state: calm water and clear sky when quiet, bigger waves (Water distortionScale, wind speed), darker clouds and rain particles when volatile.

PREDICTION ROUNDS (free, XP only, no money, stored in localStorage):
60-second rounds with one question at a time, rotating:
- "Will Battleship <price> hold for the next 60s?" (resolves NO if that level is fully consumed or pulled)
- "Which fleet gains water in the next minute?" (mark price up = Bulls, down = Bears)
- "Will a storm hit in the next 5 minutes?" (realized vol rises above current)
Two big buttons, countdown, result toast, XP and streak counter.

HUD: front tabs, mark price, spread, funding, OI, latency, ghost count, last liquidation, a collapsible legend that explains every unit in one line each, and a footer: "Live Binance Futures public market data. Prototype. Not affiliated with Binance."

Keep the code modular: data layer (streams + percentile tiers + event detection) separate from the scene, so event logic can be unit tested.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/82fd3109-ca11-4e57-bea2-a4f1af1469ba).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
