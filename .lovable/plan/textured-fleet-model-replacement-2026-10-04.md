# Textured fleet model replacement

## Build
- Download the eight supplied GLBs into temporary staging, validate each file, and record source size, meshes, triangles, textures, materials, and orientation.
- Optimize committed models with 1024px WebP textures and Meshopt compression, targeting 1.5 MB or less while preserving PBR maps; create 512px, roughly 4k-triangle far LODs for every ship.
- Replace the existing geometry-flattening loader with a Meshopt-aware textured-model pipeline that preserves material groups and shares geometry/materials across instanced near/far fleets.
- Force emissive black and intensity zero after loading every material. Preserve baked paint and keep side identity restricted to separate muted stripe, deck-marking, and flag meshes.
- Replace the procedural fighter with the supplied fighter GLB, retain the supplied bomber, and animate fighter banking plus a spinning propeller when the model exposes one or when a propeller mesh can be identified safely.
- Regenerate runtime Guide, legend, and tour previews from the same new model/material pipeline.

## Verification
- Confirm all source and output sizes, Meshopt decoding, texture maps, triangle counts, and zero emissive values.
- Capture close-ups for each ship tier on both sides, plus wide Cinema and Map views at 1440px and 390px.
- Compare frame time and draw calls before and after using the existing live debug instrumentation; report software-renderer limitations honestly.
- Run focused tests, inspect browser console/network failures, and leave no source GLBs committed.

## Technical notes
- Textured GLBs cannot be flattened into the current single untextured geometry without losing UV/material data. The fleet renderer will use one instanced mesh per primitive/material group, model, LOD, and side.
- If any optimized file remains above 1.5 MB after the requested command, texture resolution or simplification will be reduced carefully and the exact final size reported.
- The supplied links are treated as user-provided assets; no external model-license claim will be added.
