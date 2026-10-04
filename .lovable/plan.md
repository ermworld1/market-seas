# No Man’s Sea — Trust, Cinema, Community, Performance

## Product direction
- Keep BTCUSDT, Buyers/Sellers naming, full-book synchronization, every-trade fire/audio, and the rule that no battle action is simulated.
- Make **Cinema** the default presentation and retain the current readable tactical view as **Map**.
- Keep the existing **?** control as the only tutorial entry point; first-visit onboarding opens it immediately after the Enter Battle gate closes.
- Treat the social layer as optional: the live battle remains available without an account; signing in is required only to save a nickname, side, predictions, and global ranking.

## 1. Trust, learning, and quieter narration
- Extend the market snapshot with the nearest 25 raw bid and ask levels, cumulative quantities, and a bounded recent-aggTrade buffer containing Binance ID, millisecond timestamp, price, quantity, notional, and taker side.
- Carry first/last aggregate-trade IDs through the 300 ms order aggregation so narrated trade lines can be cross-checked against the Trades tab.
- Replace the desktop right rail and phone overlay with shared tabs: **Book, Trades, Tape, Guide**. Desktop keeps the selected panel visible; phone uses a collapsed bottom drawer with drag/swipe and explicit open/close states so the battle stays unobscured by default.
- Build a trading-DOM ladder with Buyers left and Sellers right. Hover/tap synchronizes a selected bucket between ladder rows and ships and projects a thin connector to the matching ship.
- Add the Binance BTCUSDT external link in the data panel.
- Expand Guide into a compact illustrated glossary covering every requested ship, weapon, inferred event, aircraft, convoy, tanker, and storm.
- Add a pure lesson selector plus first-session controller. During the first three minutes, the first real shot, sink, dive, fighter, bomber, and reinforce each trigger once per visitor: 30% speed for one second, scene spotlight, real-value explanation, and Skip. Persist completed/skipped lessons locally.
- Tighten event noise without affecting visuals: fighters require both ≥$500K and ≥97th percentile; tape-worthy inferred book events require ≤0.2% from mark and ≥90th-percentile bucket notional; relocation requires a ±10% size match at least two buckets away and is narrated at most once per 10 seconds.
- Rewrite qualifying tape entries as numeric battle narration. Small trades remain visible and audible but never create individual tape/callout noise.

## 2. Cinema mode
- Add a header **Cinema / Map** segmented control and persist the choice. Map preserves the current orthographic battlefield behavior.
- Introduce a pure shot-selection/rate-limit module and a camera rig that smoothly eases among wide establishing, gun/torpedo follow, battleship hero, fighter chase, bomber POV/waterline, cascade-wide, and flagship-sink shots.
- Enforce no more than one cut per 2.5 seconds and a readable wide return within six seconds. Camera requests are driven only by real phase and battle events.
- Implement the P5 “Pearl Harbor moment” as a real-flow intensity treatment: aircraft count scales from observed liquidation flow (bounded 6–12 while P5 is active), with flak, deck fires, smoke columns, shake, siren, and the existing adaptive music peak. No synthetic market events or fake hits are introduced.
- Add flagship-sink slow motion and title treatment; torpedo/broadside impact emphasis; event-driven muzzle light, debris, water columns, flak, fire, and soft billboard smoke.
- Add Cinema-only letterboxing, warm film grade, vignette, subtle grain, and sun glare. Close-shot depth of field is enabled only at sufficient quality; Map remains clean and data-first.
- Reduce Cinema HUD to price, clock, tug-of-war, flagship bars, mode switch, sound/help controls, and one-line ticker; move all detail into the shared panel/drawer.

## 3. Profiles, predictions, and leaderboard
- Add optional email/password and Google sign-in, with a compact profile flow for nickname and Buyers/Sellers allegiance. Anonymous viewers can still watch and use local-only features.
- Create Cloud tables for profiles, prediction rounds, predictions, and scored outcomes. Every table gets explicit grants, row-level security, ownership policies, public-safe leaderboard reads, and server-only settlement paths.
- Store roles separately if any privileged role is needed; never infer privileges in the browser.
- Move prediction acceptance and scoring to authenticated server functions. The server derives time, validates the active deterministic window, rejects late/duplicate picks, and applies per-user rate limits before insert.
- Settle results idempotently and expose public Today / Week / Season rankings by XP and accuracy, plus aggregate Buyers/Sellers fan accuracy. Keep rewards XP-only with no money, deposits, or prizes.
- Preserve local predictions for signed-out viewers, clearly labeled device-only; sync only future picks after sign-in.
- Generate an end-of-battle share-card image locally with result, pick, streak, price move, and biggest observed event; provide Share and Download beside the existing private auto-clip.

## 4. Alerts, adaptive quality, and recorded voices
- Add an opt-in alerts control and browser notifications for: flagship within 0.05%, P5 cascade start, and 30 seconds remaining while the player’s chosen side is losing. Deduplicate each alert per battle/event and explain when browser permission is unavailable.
- Add a rolling frame-time quality controller with hysteresis. Quality tiers adjust particle caps, smoke density, post-processing, water reflection resolution, aircraft/flak density, and distant ship geometry, targeting ≥55 fps desktop and ≥40 fps mid-range phones without hiding real trades.
- Generate cached lower-poly ship geometry variants once and switch distant instances by quality tier while preserving one instanced mesh per model, side, and LOD.
- Download the five supplied WAV files as `capital`, `dive`, `surface`, `flagsunk`, and `bombers`; map them into the existing radio chain. Keep speech synthesis only for failed/missing recordings.
- Extend debug telemetry with view/shot, cut counts, quality tier/frame budget, active particle counts, tape acceptance/rejection counts, lesson triggers, alert state, and whether each voice came from a file.

## Technical details
- Keep market parsing and thresholds in pure modules under the existing market/battle libraries; React and Three.js consume typed snapshots/events only.
- Add aggregate-trade IDs without modifying the verbatim tape pipeline implementation: adapt its input/output at the engine boundary.
- Keep scene state on the mutable view object and HUD state throttled; do not introduce per-frame React updates.
- Use authenticated server functions for profile and prediction writes, public read-only server functions for rankings, and append the existing bearer middleware rather than replacing it.
- Database settlement is idempotent by unique round/user keys and server timestamps; client time is never trusted.
- Update architecture notes for dual camera modes, server-authoritative predictions, shared data-panel state, and adaptive quality.

## Verification
- Add unit tests for fighter threshold conjunction, tape proximity/percentile filtering, two-bucket relocation and 10-second narration limit, one-time lesson selection, shot priority/cut timing/wide return, quality hysteresis, leaderboard scoring, duplicate/rate-limit behavior, and prediction locking.
- Run all tests and inspect current build/runtime diagnostics plus the Cloud database linter.
- Run live BTCUSDT at 1440 and 390 in both Cinema and Map; capture four screenshots and verify Book/Trades/Tape/Guide behavior, phone drawer default/collapse/swipe, ship↔ladder highlighting/connector, and tutorial sequencing after Enter Battle.
- Cross-check a narrated aggTrade ID range against the Trades panel; report trades received versus visualized, tape lines/minute before baseline versus after, director cuts/minute, sound category totals, file-backed voice plays, quality tier, triangles/draw calls, and console/runtime errors.
- Force P5 with `?debug=1`, capture the cascade sequence, and verify aircraft/flak/smoke/siren/camera behavior uses the phase state without manufacturing market events.
- Verify notification eligibility and triggers in-browser. Report browser/audio/GPU limitations honestly; physical-device FPS, OS background delivery, and audible speaker quality cannot be proven in the sandbox.

## Assumptions
- “Today” uses UTC; “week” starts Monday UTC; “season” is the current UTC calendar month.
- Accuracy ranks require at least one settled pick and display pick count so small samples are visible.
- “While the tab is in background” means the standard Notification API while the page remains open; no push service or closed-tab delivery is added.
