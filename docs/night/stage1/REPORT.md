# AgCl stage 1, iteration 4

## Design and changes

Experiment 2 defaults to `window.__silverStage === 1`; set a different numeric value and recreate the tube to use the retained older silver path. Stage 1 forms all solid in the conserved `dense` liquid-grid scalar at the `precipitatePair` reaction source. `TubeFlowSolver.transport` carries dense mass and its three mass-weighted birth coordinates. Neighbor fluxes settle and compact the dense phase. Fine suspension, instanced flocs, fragments and separate sediment are inactive in this view. The existing `PourStream` remains mounted and its code was not changed. The silver volume renders at order -0.25, before the default transparent stream order.

The iteration 4 change increases conservative, three-axis compaction toward flow-created concentration peaks. A neighboring pair transfers up to 20% of its lower-density cell in a 0.05 s step when the higher cell is at least 8% denser. Settling remains `0.004 + 0.015*c/(c+0.3)` m/s. No additional source, random scattering or scripted position was introduced. The LOW grid is 8 x 18 x 8; no new grid or per-frame buffer was added.

The ray march uses 56 primary samples and at most three light samples per occupied primary sample. Its broad clump mask and folds use isotropic current physical coordinates with domain warp. Transported birth coordinates contribute only a bounded, low-frequency displacement of at most 0.12 tube radii per axis. Fine erosion uses current-position noise at 10 and 23 cycles per radius, so settling cannot stretch those octaves into vertical lines. A broad noise threshold makes gaps and an uneven outline even where conserved field mass remains dilute. Self-shadowing is stronger, and the white material has no emission. The shader and textures are created with the tube, before reaction onset. The cylindrical wet mask and radial fade still exclude proxy-box faces.

The product-source tint remains restricted to instantaneous nonzero reaction source above the existing 0.015 display threshold. The liquid outside dense cotton and the active mixing region has no stage-1 suspension tint. Experiments 1, 3 and 4 use their original rendering branches. The reaction visual tests cover all four kinds; no non-silver branch was edited in this iteration.

## Numeric diagnostics

[ASCII slices](slices.txt) show x-y and x-z midplanes for dense, Ag+, Cl- and product source before delivery and at 0.25, 1, 2.5, 5 and 8 seconds. With the LOW grid and a center pour, the first dense center is y=10.74, below the top wet row y=11. The vertical span above concentration 0.04 grows from two cells at the first step to nine by step 20 and twelve by step 50. Floor mass in the lowest three rows is 0% at 1 second, 48.6% at 2.5 seconds, 89.3% at 5 seconds and 95.0% at 8 seconds. These are simulation measurements, not visual observations.

At every checked step, including level change, tilt and shaking, `dense` equals consumed reagent within 1e-8; the largest recorded mass-balance error was 2.554e-15. No checked dense or ion cell was negative or non-finite. At eight seconds, the largest above-0.01 connected component contains 222 of 233 occupied cells, across three components. The dense x center is 3.557 grid cells for a center pour and 4.522 for a wall pour. Repeated center pours produced identical arrays and diagnostics.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: passed, zero errors.
- Focused stage-1, silver-field and reaction-visual run: four files passed; 44 tests passed, zero failed.
- After the final reduction of low-frequency warp amplitude, the density mapping file passed again: nine tests passed, zero failed. Typecheck also passed again. The full suite result below predates that amplitude-only adjustment and was not rerun.
- Full suite, one Vitest process: 47 files passed, one failed; 315 tests passed, one failed, two expected failures. `tests/_g1_motion.test.ts` timed out at its 30-second limit. That barium motion test and its implementation are outside stage1 ownership. The full suite was not aborted or rerun.
- `git diff --check` found no whitespace issue in owned files. It reports an existing trailing blank line in the out-of-ownership `vite.review.config.ts`.

## Modified files

- `src/scenes/laboratory/lib/tubeSilverField.ts`: stronger conservative compaction.
- `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`: isotropic current-position clumps, folds and erosion; bounded birth-coordinate warp.
- `src/scenes/laboratory/lib/night/stage1/density.ts`: CPU counterpart of the density mapping.
- `tests/night/stage1/density.test.ts`: bounded deformation and directional-detail checks.
- `docs/night/stage1/slices.txt`: regenerated numeric slices.
- This report.

## Limits and integration

I inspected the supplied iteration 4 and reference contact sheets, but this worker cannot render or capture browser frames. The revised silhouette, clear gaps, floor shape, GPU shader compilation and visible stream therefore remain unverified. The code keeps `PourStream` enabled for experiment 2; if a browser capture still lacks the stream, its render/depth behavior in `src/scenes/laboratory/ui/PourStream.tsx` needs review by that file's owner. The pre-existing changes to `vite.review.config.ts` and untracked `tests/_hide.mjs`, `tests/_hide5201.mjs` and `tests/_review5201.mjs` are outside stage1 ownership and were left untouched.
