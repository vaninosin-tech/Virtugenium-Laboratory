# Wave 10 C1: fine AgCl transport

## Result

The principal smoothing in Diagnostic C was the fine scalar's explicit transport closure. Stage 3 used `diffusivity = 1.2e-5 m²/s` and `eddyScale = 0.6`, on approximately 0.9 mm horizontal cells. The per-face diffusive transfer often reached the solver's 0.12 cap. The replacement uses `1e-9 m²/s` explicit diffusivity and `0.02` of the velocity-dependent eddy term for **stage 3 fine suspension only**. No Ag+, Cl-, precipitation, delivery, settling, renderer, or other-experiment path was changed. The stage 3 pixel path already overrides the spatial-mean optical blend and copies `suspension[0] * activeCount` directly.

The six supplied real-game dumps were parsed. Their source-to-fine normalized total variation falls from 3.58 to 2.39 at 900 ms, 2.07 to 0.70 at 4000 ms, and 1.78 to 0.26 at 9000 ms. These are observations of the original game, not claimed results for the new implementation. The deterministic field replay below uses the 50 ms `wave10diag` delivery pattern (0.02 per step through 1 mL), not the browser's exact impact timing. It follows the same field, mask, chemistry, transport and texture-writing code; all 220 steps and their four stages are in `metrics.json`.

## Stage-by-stage evidence

`source` is raw `productSource` after reaction, `before` and `after` bracket the fine `solver.transport` call, and `pixels` is the renderer input. Normalized TV is the sum of absolute wet-face differences divided by scalar mass. CV uses positive wet cells. `HF` is the squared residual of a wet 3×3×3 box filter divided by total spatial variance, a reproducible local high-pass proxy for wavelengths of a few cells. Components use 26-connectivity above 10% and 50% of the positive-cell p95. The exact p95/p50 and all other values are retained for every step in `metrics.json`.

| Grid, setting, time | Source TV | Before TV | After TV | Pixel TV | Pixel CV | Pixel p95/p50 | Pixel HF | Components |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| LOW old, 1 s | 3.358 | 1.434 | 1.355 | 1.384 | 2.232 | 1901 | .210 | 1/1 |
| LOW new, 1 s | 3.358 | 2.643 | 2.623 | 2.615 | 2.926 | 35140 | .581 | 1/1 |
| LOW old, 4 s | 1.929 | .518 | .503 | .511 | 1.217 | 7.93 | .027 | 1/1 |
| LOW new, 4 s | 1.929 | 1.532 | 1.517 | 1.519 | 2.108 | 759 | .220 | 1/1 |
| LOW old, 9 s | 1.702 | .191 | .185 | .190 | .905 | 3.58 | .0056 | 1/1 |
| LOW new, 9 s | 1.702 | .877 | .872 | .874 | 1.416 | 55.78 | .0544 | 1/1 |
| HIGH old, 9 s | 1.484 | .151 | .148 | .151 | .973 | 3.89 | .0029 | 1/1 |
| HIGH new, 9 s | 1.484 | .746 | .740 | .741 | 1.393 | 27.23 | .0502 | 1/1 |

At 9 s, pixel TV increases 4.61× on LOW and 4.91× on HIGH; the local high-pass fraction increases 9.73× and 17.5×. The source is identical between matched runs. The single-step `before` to `after` loss is small compared with the accumulated loss over 180 steps. The pixel assembly is nearly transparent to spatial structure; tint transfer changes the absolute fine mass, and float texture conversion changes low-concentration ratios. The source itself remains one connected contact region at these thresholds. The fix preserves cores and gaps much better but does not manufacture new disconnected branches.

## Numerical diffusion audit

`TubeFlowSolver.transport` is conservative face-flux advection with upwind donor and a minmod-like linear donor reconstruction when `lowDiffusion` is set, plus explicit centered diffusion and a positivity limiter. It is neither semi-Lagrangian nor pure first-order upwind in smooth regions; at sharp edges its slope falls to zero and it becomes first-order. A one-cell passive pulse advected at 0.005 m/s across 0.875 mm cells for 50 ms has Courant number 0.286 and effective **scheme** diffusion 1.56e-6 m²/s from its measured second-moment increase. With zero velocity and zero diffusivity it does not move. The old explicit 1.2e-5 m²/s is 7.68× this scheme value before the face cap; a 0.12-capped horizontal face corresponds to 1.84e-6 m²/s per axis. In the replay's actual 9 s LOW flow, the mean facewise scheme proxy is 5.04e-7 m²/s. Mean old explicit plus eddy input is 1.42e-5 m²/s, effectively 7.03e-6 m²/s after cap across axes. New mean eddy is 7.25e-8 m²/s, plus 1e-9 explicit. The actual-flow proxy uses face speeds and Courant factors, and is an upper estimate in smooth cells because the limiter restores a slope there.

Removing the remaining eddy term alone changes 9 s LOW TV from .874 to 1.005, considerably less than the old-to-new change. Source patch injection and coarse-cell formation were held fixed. Nearest-cell mask redistribution was not the main cause in this rising-level replay. Grid resolution still limits the source to a few wet rows and prevents resolved branches below a cell.

## 2× scalar trial and CPU cost

`fineExperiment.ts` is a diagnostic-only conservative 2× scalar. It subdivides the **same** source mass into eight children, samples the coarse velocity trilinearly, uses bounded upwind face fluxes with four substeps, and reduces back to the coarse grid for a like-for-like comparison. At 9 s LOW the reduced TV is .989 versus .874 (1.13×), and the high-pass proxy is .0606 versus .0544 (1.11×). Its mass at 9 s is .178893, consistent with the fine scalar after the stage-3 smoke-to-tint transfer. Its LOW median step cost is 23.02 ms on top of the 3.98 ms field step, so it exceeds the 40% cost limit by a wide margin. A `fineTexture` was therefore **not** added. This diagnostic uses a parent-cell wet mask and approximate interpolated cell-centered flow, so it is evidence for a cost/gain decision, not a production 2× solver.

CPU times are `performance.now()` around 200 steps after 20 warm-up steps on this worker. They include the whole `advance` and are machine-dependent. Individual trials ran sequentially; p95 reflects background load.

| Grid | Old p50/p95 ms | New p50/p95 ms |
| --- | ---: | ---: |
| LOW 12×24×12 | 4.10 / 8.03 | 3.98 / 7.03 |
| HIGH 16×32×16 | 10.67 / 17.06 | 10.02 / 14.44 |

## Momentum and conservation

At 6 s in a separate off-centre LOW replay, the normal fine-suspension centroid is `(7.042, 12.352, 5.567)` cells and second moments `(5.724, 1.855, 5.828)` cells². Disabling the surface jet closure gives `(7.082, 12.316, 5.571)` and `(5.748, 1.748, 5.820)`; disabling incoming-solution buoyancy gives `(6.279, 10.996, 5.535)` and `(6.090, .297, 6.345)`. Mean mass-weighted vertical flow and fine-centroid vertical speed are respectively `.001729` and `.001350 m/s` in the normal run, versus `.000027` and `-.000057 m/s` without buoyancy. The Pearson correlation across 69 steps between vertical centroid displacement per time and mass-weighted vertical velocity is `.904` in the normal run. This checks directional coupling at cloud scale; it is not a cellwise displacement correlation. With no face velocity and no diffusion, a tracer is exactly stationary.

All 220 replay steps include rising meniscus masks. Maximum `|extent - total solid|` was 4.00e-15 LOW and 8.13e-15 HIGH. An additional test puts all solid into a cell then lowers the meniscus past it; redistribution retains mass to 1e-12. Aggregation is disabled; the field's `dissolveSmoke` explicitly transfers fine mass to `suspension[1]`, so `extent` must be compared with all suspension classes rather than class 0 alone. The 2× diagnostic is not shipped as a second reservoir.

## Reproduction, frames and interface

Run `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/night/wave10c1/analyze.test.ts tests/night/wave10c1/transport.test.ts` to regenerate `metrics.json`, `momentum.json`, and PPM frames; then run `node tests/night/wave10c1/combine.mjs` for the old/new paired frames. PPM images are numeric slices only, with a fixed grey scale across times and variants. `*_source_*` are raw formed slices, `*_before_*`/`*_after_*` bracket transport, `*_pixels_*` are texture-input slices, `*_velocity.ppm` stores speed in red and signed horizontal/vertical components in green/blue, and `comparison_*` places old on the left and new on the right. Both central vertical and horizontal slices are provided. No visual verdict is claimed without the coordinator's real-game rendering.

The only public API addition is an optional fifth constructor argument, `fineTransport?: { diffusivity?: number; eddyScale?: number }`, for controlled diagnostics. Defaults change only for stage 3 fine suspension. `texture`, `pixels`, and every existing field meaning remain unchanged. There is no new texture or renderer integration request.

## Validation and remaining issues

- `tsc --noEmit`: passed.
- Focused C1 tests: 5 passed, 0 failed (after the final mask-change test was added).
- Whole suite, once: 368 passed, 4 failed, 4 expected failures across 62 files. The four failures were `wave4a/field.test.ts` surface-raft golden, `wave4b/PourStream.test.ts` stream endpoint, `wave6perf/flocPerf.test.ts` HIGH golden total, and a `tubeReactionVisuals.test.ts` 5 s timeout. The timed-out file passed 35/35 when rerun alone.
- The wave4a and wave4b failures are unchanged paths and are known pre-existing. The wave6perf HIGH golden fails under both old and new fine transport settings: distance from its expected total is .05510085 with old settings and .05661764 with new settings. The new fine transport changes that already-failing total slightly; its expected value was not edited. This is an integration review item if the coordinator wants stage-3 floc behavior recalibrated.

Limitations: the supplied six dumps have no face velocities and no per-step before/after states, so the full stage comparison and CPU profiling use a deterministic field replay patterned on the repository's delivery tests. The high-frequency metric is a local filter proxy rather than an exact Fourier wavelength cutoff. The 2× experiment used LOW only, because it was already far beyond the cost threshold. The final visual judgment belongs to the coordinator's browser capture.
