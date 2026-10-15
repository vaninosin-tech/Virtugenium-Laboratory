# Worker "agcl2": real AgCl physics inside TubeSilverField

Read `docs/AGCL_INTERFACES.md` first, then `docs/realism/agcl-baso4-full-physics-tasks.md` (tasks 56 and 58), `docs/realism/microphysics-supplement.md`, `docs/realism/local-reaction-onset.md`, and `docs/realism/game-rules-amounts.md`. Study `lib/tubeSilverField.ts` (current draft), the night-1 prototype `lib/night/agcl/AgclPrototype.ts` with its REPORT (`docs/night/agcl/REPORT.md`), `lib/tubeSilverSediment.ts`, `lib/tubePrecipitationPhysics.ts`, and how `tubeReactionVisuals.ts` and `tubeBariumField.ts` use them (read-only). Look at the existing tests `tubeSilverField.test.ts`, `tubeFlowSolver.test.ts`.

Mission: after this task, pouring NaCl into AgNO3 (and the reverse order, both are possible in the game) in the real game produces physically driven AgCl precipitation, with the aggregate model from the prototype integrated into `TubeSilverField`.

Required behaviour (all emerging from simulation, no timers, no scripted timeline):
1. Ag+ and Cl- meet only where the poured stream mixes; solid forms only there, proportional to the local excess/product, consuming both reagents exactly (excess of one reagent limits the product).
2. First a fine white suspension (milky streaks), then soft cotton-like aggregates (porous, irregular, deformable, not snowflakes/stars/balls). One continuous pour produces aggregates at several depths; some stay in the upper liquid while others reach the bottom early.
3. Aggregates move by flow + gravity + drag, deform first, and fragment only when flow shear stress exceeds a strength that depends on their properties; they may merge on contact. Fragmentation/merging conserve mass exactly.
4. Mass bookkeeping: `suspended + coarse + flocs + sediment` equals the reagent consumed at every step; `diagnostics().massBalanceError` stays at floating-point noise level, also under tilting, shaking, level changes (the code already moves mass when cells are vacated; keep it exact) and in both pour orders.
5. Bottom: aggregates deposit onto the hemispherical floor into `SilverSedimentField` as a loose wet layer that slowly compacts; residual fine suspension keeps the liquid milky and thins out with settling (the number of particles in the upper liquid drops while the same mass shows up at the bottom).
6. Remaining flow keeps moving after the pour stops; aggregates keep responding to it; stopping the pour stops delivery of reagent.
7. Public data contract unchanged (additive only), `advance(...)` signature unchanged, so `tubeReactionVisuals.ts` keeps working without edits; the data additions you make (e.g. per-aggregate deformation, fragmentation state) must be documented in `docs/night/agcl2/INTERFACE.md` for the renderer.
8. Performance: step cost must stay close to the current draft at LOW and HIGH quality; measure and report ms per advance before/after. Keep allocations out of hot loops.
9. Experiments 1, 3, 4 untouched; `tubePrecipitationPhysics` exports used by barium keep behaviour (add new functions instead).

Verification you must do yourself (unit and scenario tests, all deterministic and seeded):
- Scenario test driving `TubeSilverField.advance` for one full 1.0 ml pour plus 60 s of simulated settling at LOW and HIGH quality; assert mass balance, monotonic thinning of upper turbidity, growth of sediment mass, aggregates at several depths during the pour, non-uniform settling, no NaN, determinism.
- Both pour orders; excess Ag+ and excess Cl-; tilt/shake mid-run.
- Shear threshold test: same aggregate, low vs high shear.
- Keep every existing test of the repo that is not about silver green: run `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism src tests/night` and report counts (the sandbox may time out on slow tests; rerun those alone).
- `node node_modules/typescript/bin/tsc --noEmit` clean.
You cannot run a browser: say so, never claim visual results. Write `docs/night/agcl2/REPORT.md` with measured numbers, test counts, what is physically motivated vs artistic, limitations, and anything the renderer or coordinator must do. Do not fake results.
