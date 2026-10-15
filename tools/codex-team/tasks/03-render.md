# Worker "render": visualization of AgCl volumetric suspension and sediment

Do NOT create any particle/aggregate formation system. All matter to draw is produced by `TubeSilverField` (`suspension` classes, `coarse`, `flocs`, `pixels`/`texture`, `sedimentField`). You only change how that data is drawn. Study `lib/tubeSilverVolumeMaterial.ts`, `lib/tubeSilverSediment.ts` (`SilverSedimentGeometry`), how `tubeReactionVisuals.ts` consumes them (read-only), and `docs/realism/agcl-baso4-full-physics-tasks.md`, `docs/realism/microphysics-supplement.md`, `docs/realism/liquid-surface-spec.md`.

Goals (physical look, no baked animation):
- Volumetric suspension: milky and soft, density-dependent optical thickness (Beer-Lambert style extinction, white forward scattering), no visible voxel grid or banding, stable at LOW and HIGH quality, no NaN/negative values in the shader mix (clamp), no colour above 1 in mixing.
- Aggregates (cotton-like flocs) readable as irregular soft clumps inside the volume, driven by existing `flocs` data or the texture channel that already encodes them; never invent positions.
- Sediment: curd-like AgCl layer following the hemispherical floor, thickness proportional to deposited mass per column, compaction over time, soft irregular top surface instead of a clean dome; preserve exported signatures.
- Performance-aware: bounded raymarch steps; document the cost.

Verification (be honest about what you could actually run): unit tests of any pure functions you add (extinction, thickness-from-mass mapping, height-field generation) in `src/scenes/laboratory/lib/night/render/` and `tests/night/render/`; geometry tests for `SilverSedimentGeometry` (finite vertices, closed surface inside the tube radius, thickness monotonic in mass, floor-following). Try an offscreen/browser render if a headless browser is available (see `tests/_review.mjs` for the repo approach) and save frames under `docs/night/render/frames/`; if you cannot run it in the sandbox, say so explicitly and list what a human must check visually.

Write `docs/night/render/REPORT.md`: what changed, tests with real counts, visual checks done or pending, limitations. Run `node node_modules/typescript/bin/tsc --noEmit` and your tests before finishing. Do not modify coordinator-only files; list needed changes there as integration requests.
