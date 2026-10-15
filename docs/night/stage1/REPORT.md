# AgCl stage 1, iteration 3

## Design

Experiment 2 defaults to `window.__silverStage === 1`. The local reaction product feeds one conserved `dense` scalar on the liquid grid. The flow solver transports dense mass and its three mass-weighted birth coordinates; conservative neighboring fluxes settle and compact the field. No fine suspension, instanced flocs, fragments, or separate sediment is visible in stage 1. The separate `PourStream` component remains mounted and unmodified. Experiments 1, 3, and 4 use their original render branches; the reaction visual test exercises all four kinds.

This iteration changes settling to `0.004 + 0.015*c/(c+0.3)` m/s, where `c` is local dense concentration. Compact cotton falls faster than dilute wisps. Local conservative compaction transfers at most 7.5% of a lower-density cell toward a neighbor at least 20% denser in one 0.05 s step. The source is still only `precipitatePair` consumption. Every stage-1 solid unit remains in `dense`, including material that reaches the bowl.

The ray march uses 56 fixed primary samples and at most three light samples per occupied primary step. A smooth concentration threshold is perturbed by three transported-coordinate noise octaves and three domain-warp values. Higher-frequency erosion and weaker core extinction expose folds and holes. A cylindrical liquid mask and radial fade prevent visible proxy faces. The instantaneous product-source tint is near neutral, very faint, and discarded below a concentration of 0.015; it does not use accumulated ions. The dense mesh renders before the transparent `PourStream` (default order 0) so the stream is not overpainted by this mesh. Shader objects and buffers are constructed with the tube, before reaction onset.

Set `window.__silverStage = 1` before constructing a tube, or leave it unset, to select stage 1. Set another numeric value and recreate the tube for the retained older silver path. An active tube cannot switch mass representations in place.

## Numerical evidence

The LOW grid is 8 x 18 x 8. [ASCII slices](slices.txt) show x-y and x-z midplanes before delivery and at 0.25, 1, 2.5, 5, and 8 seconds. The first dense center is at y=10.74, below the top wet row y=11. Floor mass in the lowest three rows is 0.1% after one second, 43.5% after 2.5 seconds, 86.9% after five seconds, and 94.4% after eight seconds. These measurements show upper birth followed by floor accumulation; they do not establish visual appearance or physical calibration. The above-0.04 vertical span grows from two cells at the first step to nine cells by step 50.

At every tested step, including level change, tilt, and shaking, total dense mass equals consumed reagent within 1e-8. The largest observed mass-balance error was 2.831e-15. No checked field value was negative or non-finite. At eight seconds, 323 of 323 cells above concentration 0.01 belong to the largest connected component. The final x center differs by pour location: 3.502 grid cells for a center pour and 4.423 for a wall pour. A repeated center pour produced identical arrays and diagnostics.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: passed, zero errors.
- Focused stage 1 tests: 2 files, 10 passed, 0 failed.
- Silver field and reaction visual tests: 2 files, 33 passed, 0 failed. The later isolated rerun includes the new stream-layer assertion.
- Full suite, one process: 45 files passed, 3 failed; 311 tests passed, 4 failed, 2 expected failures. Failures: motion test timed out at 30 s; barium circulation test timed out at 5 s; copper CPU test measured 3.20 ms against 3 ms; copper completion test timed out at 5 s.
- Isolated rerun of those three files plus reaction visuals: 3 files passed, 1 failed; 53 tests passed, 1 failed. Only the motion test still timed out at 30 s. The motion path is outside this worker's ownership. No full-suite rerun was attempted.

The render changes affect only the silver branch. The new assertion verifies the silver field's order relative to the default stream order; existing visual tests verify that non-silver kinds have no silver dense mesh and keep their resources. No non-silver path was edited.

## Modified files

- `src/scenes/laboratory/lib/tubeSilverField.ts`: density-dependent settling and stronger conservative compaction.
- `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`: local source tint, high-frequency cotton surface, and interior relief.
- `src/scenes/laboratory/lib/night/stage1/density.ts`: pure CPU counterpart of the threshold and noise mapping.
- `src/scenes/laboratory/lib/tubeReactionVisuals.ts`: silver-only dense mesh render order.
- `tests/night/stage1/field.test.ts`: eight-second floor and early-arrival checks; streamlined per-cell checks to avoid test framework overhead.
- `tests/tubeReactionVisuals.test.ts`: silver stream-layer assertion.
- `docs/night/stage1/slices.txt`: regenerated numeric slices.
- This report.

## Limits and integration

No browser or GPU rendering was available in this worker. I inspected the supplied browser contact sheet, but cannot verify the revised silhouette, tint, stream visibility, shader compilation, or timing against browser frames. `PourStream.tsx` draws only during its existing pour window and uses the default transparent render order; stage 1 does not hide it. The provided crop starts at the tube mouth, so it cannot prove whether the free stream above the mouth was drawn. If a new browser capture still lacks the stream, its mesh and depth behavior in `src/scenes/laboratory/ui/PourStream.tsx` must be inspected by that file's owner. No change outside stage1 ownership was made.

The pre-existing untracked `tests/_dbg.mjs` is outside stage1 ownership and was left untouched. Test logs in this directory are ignored by Git; the counts and failures above are recorded here so the report remains usable without those logs.
