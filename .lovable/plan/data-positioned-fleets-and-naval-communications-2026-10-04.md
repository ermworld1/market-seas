# Data-positioned fleets and naval communications

## Build
- Replace decorative ship rows and heading jitter with two data axes: exact bucket price on X and logarithmic resting age on depth. Preserve X during collision spacing and relocations.
- Add a three-second staged fleet advance on initial book readiness and every Cinema/Map switch. Flagships lead, then cruisers, frigates/destroyers, and patrol boats. Continue consuming live market events and queue trade fire until its participating ships arrive.
- Add bow-wave, wake, engine-order, and general-quarters cues tied to that real movement.
- Update How to read, Guide, and tour language to explain price and time-on-station.

## Naval audio system
- Add three shared voice processing paths: sound-powered phone, inter-ship TBS radio, and 1MC loudspeaker.
- Add a priority, non-overlapping chain scheduler with 120–200 ms clip gaps, fleet call signs, role metadata, subtitles, and event cooldowns.
- Add Navy-style number tokenization for digit-by-digit prices and spoken compact sizes, ready to use the supplied phrase/digit/unit clips when they arrive. Missing new voice clips will remain silent rather than inventing speech.
- Route real market events into the requested battle-start, flagship-target, hit/miss, damage, pull/relocate, fighter, liquidation, cascade, flagship-sunk, and battle-end chains.
- Extend existing procedural/recorded layers with distance-delayed gun audio and ship-mechanical ambience.

## Verification
- Add unit tests for logarithmic age placement, overlap separation without X drift, intro ordering, Navy price digits, compact sizes, and chain priority.
- Expose a forced-audio diagnostics log containing timestamp, role, channel, and clip list, then capture a 60-second run plus opening screenshots in desktop and phone views.
- Report supplied-file gaps explicitly; recorded voice playback cannot be verified until the next voice-file message arrives.
