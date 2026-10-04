# Roadmap

- [x] v1: live battle, fleets, effects, HUD, predictions, GLB models.
- [x] v2 Phase A: BTC only, Buyers/Sellers, ortho camera, label fix, full book sync, buckets, tiers, order-change rules + tests.
- [x] v2 Phase B: fill-count tracers, sweeps, fighters, phase machine, 5-min battles, boss HP, tug-of-war, regime banner, callouts, new predictions.
- [x] v2 Phase C: header/filters, guide, action tape, ticker, legend, tour, guards, ?debug=1, /stats.
- [x] v2 Phase D: Web Audio engine + procedural sfx/music/radio with slots, auto-clips.
- [x] v2 verification at 1440 and 390 with live BTCUSDT.
- [x] v3: bullet sounds, ambient action, radio voices.
- [x] v4: left/right battlefield, moving vertical price front, mobile pan/zoom/recenter, orientation copy and clip updates.
- [x] v4 verification at 1440 and 390 with live BTCUSDT, screenshots and render/data metrics.
- [x] v5 Part 1: verifiable Book/Trades/Tape/Guide panels, cross-highlighting, lessons, and noise controls.
- [x] v5 Part 2: Cinema/Map modes, event camera director, cinematic effects, minimal HUD, and adaptive quality.
- [x] v5 Part 3: optional profiles/auth, server-locked predictions, rankings, standings, and share cards.
- [x] v5 Part 4: browser alerts, mobile LOD/particle budgets, and supplied recorded radio lines.
- [ ] v5 verification: tests, database lint, four live viewport/mode runs, forced P5, metrics, and limitations.
- [ ] Real-device frame-rate check (needs a real phone/laptop GPU).

## v6 open
- [ ] End-to-end settlement with a real signed-up user (blocked: email confirmation required; needs a real inbox or the owner testing)
- [ ] Real-device FPS (sandbox has no GPU)

## v7
- [x] How to read panel by default (desktop) + phone chip; raw Binance book with grouping and 15s REST sync check
- [x] Layered randomized gunfire, ambience bed, siren, radio chatter, more radio triggers, thin tracer streaks, P5 director lock
- [x] 5-min live runs at 1440 and 390: 0 book mismatches, trades rx = viz, active fire gap < 0.1s, P5 held

## v8
- [x] A real CC0/commercial sfx files per category + LICENSES.md
- [x] B "?" opens How it works panel (+ Replay tour)
- [x] C Binance-style order book widget
- [x] D green/red sides everywhere
- [x] E unit legend/guide/tour from one shared config + real renders
- [x] F full QA checklist (remaining: battle result card not caught by automation; real device)

## v9 realism and sound
- [x] Realistic non-emissive warship finishes, formations, wakes, foam, smoke, and restrained labels
- [x] WWII naval weapon and ship ambience sound design
- [x] Captain, Admiral, and Spotter recorded radio system and panel
- [x] Five-minute live desktop and phone verification (sandbox software renderer; physical-device sound/FPS remains unverified)
- [x] v9 clarification: zero emissive, outlines, halos, rim lights, or side-coloured unit effects in Cinema and Map; verified close and wide screenshots at 1440 and 390

## v10 ship clarity
- [x] Oblique readable Cinema camera; exact tier pixel targets at 1440/390 still need measurement
- [x] Cinema aggregation to at most 30 ships per side with natural formations
- [x] Near high-detail GLBs, realistic naval materials, soft shadows/reflections/contact foam
- [x] Daylight searchlights removed; consistent tier/side rendering without black hulls
- [ ] Close tier/side, wide Cinema, and Map screenshot verification

## v11 live unit cards and fighter waves
- [x] Runtime scene-rendered Buyers/Sellers unit cards with live dollar thresholds and interactive previews
- [x] $200K / three-level fighter trigger, queued three-second waves, finger-four flight, strafe splashes, pull-up, contrails and flak
- [ ] Five-minute live fighter target not met in one sample: 9 waves/5m (1.8/min); desktop wave captured, phone had no qualifying real order in 3m; physical audio remains unverified

## v12 textured PBR fleet
- [ ] Optimize and install eight supplied textured GLBs plus far ship LODs
- [ ] Preserve PBR materials with zero emissive and separate muted side markings
- [ ] Use supplied fighter/bomber models and regenerate scene-matched guide renders
- [ ] Verify sizes, material safety, responsive screenshots, frame time and draw calls
## v13 data positions and naval comms
- [ ] Replace formation placement with exact price X and logarithmic order-age depth, with overlap nudges only in depth
- [ ] Add staged three-second fleet advance on load and Cinema/Map switches without dropping trade fire
- [ ] Update How to read, Guide, and tour copy for price/time-on-station axes
- [ ] Add three processed voice channels, clip-chain number readouts, prioritized event chains, and naval ship/weapon layers
- [ ] Verify opening screenshots and forced-audio chain logs; recorded voice clips remain pending user delivery
