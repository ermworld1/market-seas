# No Man's Sea v2 — BTC-only, full book, story, sound, clips

This update is large, so it ships in 4 phases. Each phase ends with a verification pass, and live data never stops working between phases.

## Phase A — Scope, camera, data core
- BTCUSDT only. Remove the front tabs and the code paths for other symbols.
- Rename the sides everywhere to Buyers (south, gold) and Sellers (north, steel/red).
- Camera: near top-down perspective at about 65°, centred on the strait, framed so both fleets show at the same scale at 1440 and 390.
- Fix the label warning: drop the drei Html labels and draw labels in one HUD overlay that is projected every 250 ms.
- Full local book: REST snapshot (limit 1000) plus `@depth@100ms` diffs, synced with Binance's update-id rules (U/u/pu). A gap triggers a new snapshot. If the snapshot fails, fall back to depth20 and show a "partial book" badge.
- Bucketing at 0.01% of mark, within ±1% of mark. Up to 120 ships per side on desktop and 50 on phone.
- Tiers: patrol, destroyer (frigate GLB ×1.15, new trim), frigate, cruiser, battleship/BOSS.
- New order-change rules engine, run per tick per bucket: damage, cancel/smoke, sink, ghost dive, fled, relocate, hidden/iceberg, reinforce, repair.
- Copy `src/lib/battle/walls.ts` and `tape.ts` in verbatim. Adapt only their inputs (taker-buy / taker-sell, 300 ms aggregation).
- Unit tests: book sync, bucketing, every rule, tape aggregation.

## Phase B — Firepower density and the battle story
- Every aggTrade fires. Tracers = fills (l-f+1), capped at 24. Sweeps hit buckets in order and keep going past ships that sink.
- Procedural low-poly fighter for taker orders above the 97th percentile, built as one instanced mesh.
- Phase machine with phases P1–P7 in `src/lib/battle/phase.ts`: time-injected, with `force()`, unit tested.
- 5-minute battles: countdown, winner rule, result card, daily scoreboard in localStorage (tested).
- BOSS HP bars, tug-of-war meter, OI regime banner (the only place longs/shorts appear), big callouts, NEXT TARGET line.
- New prediction rounds: pre-battle winner pick, and flagship SUNK / DIVE / HOLD over 60 s. Remove the old hold question.

## Phase C — UI port
- Two header rows with all the metrics and filters listed in the request, plus the view switch.
- Right sidebar "How to read it" with a "More details +" toggle that persists.
- Action tape with filters, and a bottom LIVE TAPE ticker.
- Legend strip with ship icons.
- 4-step spotlight tour (Esc closes, reopen with ?).
- Error guards around each subsystem, a `?debug=1` panel, and a `/stats` page that reads analytics events from localStorage.

## Phase D — Sound and clips
- Web Audio engine: master gain, per-category buses, panning by x, max 8 voices with priority, off by default, "Enter battle" unlock, volume slider.
- Procedural synths for every event category, with a sample slot at `/public/sfx/<category>.mp3`.
- Adaptive procedural music layers driven by the phase, with 2 s crossfades and slots at `/public/music/`.
- Radio subtitles per phase, with slots at `/public/vo/`.
- Auto-clip on flagship sunk or P5: 12 s of MediaRecorder canvas plus audio, 16:9 and 9:16 crops with banner and watermark, and a toast with Download/Share. The 9:16 crop is skipped when frame time degrades.

## Verify (after each phase, full run after D)
- All unit tests.
- Desktop 1440 and phone 390 with live BTCUSDT for 3+ minutes. Report: ships per side, trades received/s vs visualized/s (must match), event counts by type, triangles and draw calls, console errors.
- The sandbox has no GPU, so real-device FPS still has to be checked on a real device.

## Assumptions
- "donotdie" source isn't in this project. walls.ts and tape.ts are copied from the request text, and the phase machine, audio and clip code are rebuilt from the spec.
- /stats is local to the device (localStorage), not shared across visitors. A shared stats page would need Lovable Cloud.
