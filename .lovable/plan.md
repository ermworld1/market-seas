# No Man's Sea — left/right battlefield

## What changes
- Put Buyers on the left and Sellers on the right, with price distance mapped horizontally from a moving vertical mark-price line.
- Spread ships vertically in stable formations while keeping all existing live book, combat, prediction, phase, sound, and clip rules unchanged.
- Reorient bows, fire, torpedoes, fighters, bombers, convoys, tankers, wakes, searchlights, labels, and stereo panning to the new axis.
- Pin Buyer and Seller flagship bars to opposite top corners and preserve the opposing-fill tug-of-war meter.
- Update the tour, guide, legend, and clip framing language for the vertical front.

## Mobile interaction
- Show roughly ±0.4% around mark by default at 390px.
- Add one-finger horizontal drag and pinch zoom on the battle surface, bounded to the available ±1% book.
- Add a compact recenter control that restores the live mark and default phone zoom.

## Technical details
- Keep the orthographic camera and price projection deterministic so both fleets stay the same scale.
- Track the mark-front offset separately from the user's camera pan; projected labels follow the same camera.
- Preserve instancing and pooled effects; no data or event-engine changes are planned.
- Update the architecture note to make the X-axis orientation an invariant.

## Verification
- Run the existing automated tests and inspect the current preview diagnostics.
- Exercise live BTCUSDT at 1440 desktop and 390 phone, capturing both screenshots.
- Confirm bows face inward, shots cross horizontally, phone drag/pinch/recenter works, and received trades equal visualized trades.
- Report ships, triangles, draw calls, and any console/runtime errors; software-renderer speed is not a real-device FPS measurement.
