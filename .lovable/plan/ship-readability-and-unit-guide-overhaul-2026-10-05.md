# Ship readability and unit-guide overhaul

## Goal
Make Buyers, Sellers, and ship tiers immediately readable without glow, while preserving real-data placement and raw order-book accuracy.

## Battle scene
- Replace the small floating markings with matte, non-emissive ship paint: full main deck and upper 30% hull band in Buyers green `#2F8F57` or Sellers red `#C0392B`; retain naval-grey lower hull, dark antifouling, light-grey superstructure, funnel band, and a larger mast flag.
- Preserve each displayed ship’s exact price-derived X position. Merge nearby visible levels to the requested Cinema/Map budgets, anchor each merged ship to a real constituent price, and map all represented buckets back to it for hits and selection.
- Resolve collisions by moving ships only along the order-age depth axis; never alter price X. Use tier-aware hull footprints and deterministic packing so no visible ships overlap.
- Set visible limits to about 25 per side in Cinema and 40 per side in Map.
- Apply the exact length ratios: patrol 1.0, frigate 1.6, destroyer 1.9, cruiser 2.5, battleship 3.4. Keep distinct models, a larger flagship flag, and its existing name label.
- Keep Cinema at a 35–45° oblique perspective by default; make Map tilted rather than vertical.
- Reduce repair markers and continue showing them only during active repair windows.

## Lighting and water
- Brighten the daylight key and sky fill, raise exposure, and use clear deep-blue water with lighter crests.
- Push haze toward the far horizon so nearby hulls remain crisp and strongly contrasted.
- Keep all ship materials at zero emissive with no unit bloom, halos, or outlines.

## Legend, Guide, help, and tour
- Generate one transparent, frameless 110×55 real-model render per unit from the same loaded model/material pipeline.
- Use neutral three-quarter daylight and a restrained split green/red paint hint for sided units; remove separate Buyers/Sellers cards and labels.
- Keep live dollar-range copy beside each sample.
- Add one shared line under unit lists: “Green-decked ships are buy orders (Buyers), red-decked ships are sell orders (Sellers).”
- Ensure the Guide, How it works, sidebar legend, and tour all use the same single-sample component.

## Verification
- Check emissive values and visible-ship caps programmatically.
- Run focused positioning/unit tests and confirm the preview build is clean.
- Capture and inspect wide Cinema screenshots at 1440 and 390, close-ups for every tier on both sides, and the updated legend cards.
- Record any limits of software-rendered screenshot verification without claiming real-device performance.

## Technical details
- Keep market rules and raw Book rows unchanged.
- Keep the exact-price X invariant; all collision correction is depth-only.
- Retain instancing and LOD budgets, using shared materials per model/LOD/side.
- Implement model paint from normalized model bounds/material regions, with emissive forcibly black and intensity zero after loading.
