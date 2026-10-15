# AgCl stage 1 report

## Files modified

- `src/scenes/laboratory/lib/tubeSilverField.ts`: conserved dense field, transport, source, textures, diagnostics.
- `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`: stage 1 ray march and retained legacy shader.
- `src/scenes/laboratory/lib/tubeReactionVisuals.ts`: silver-only stage view and volume mesh.
- `src/scenes/laboratory/lib/silverStage.ts` and `src/scenes/laboratory/lib/night/stage1/density.ts`: stage selector and pure density mapping.
- `tests/tubeReactionVisuals.test.ts`, `tests/night/stage1/density.test.ts`, and `tests/night/stage1/field.test.ts`: renderer, pure mapping, and deterministic scenario checks.
- `docs/night/stage1/REPORT.md`, `slices.txt`, `focused.log`, and `full-suite.log`: report and diagnostics.

## Design

Experiment 2 defaults to a diagnostic view with the existing external pouring stream, a faint blue mixing source, and one white dense volume. The tube liquid uses its clear baseline material. Silver suspension, floc instances, sediment, fragments, internal pour film, air bubbles, and splash are hidden in this stage. Experiments 1, 3, and 4 retain their previous construction and render branches; the reaction visuals regression test checks that only silver has `TubeSilverDenseField` and exercises resource stability for all four reactions.

`TubeSilverField.dense` lives on the existing liquid grid. Each local `precipitatePair` consumption adds the same amount to `dense` and `productSource`, and adds nothing to suspension or coarse classes in stage 1. `TubeFlowSolver.transport` advects the dense field and three mass-weighted birth-coordinate fields. A conservative neighboring-cell gravity transfer settles dense material with speed `0.0005 / (1 + 3 * local concentration)` m/s, capped at 0.08 of a cell per step. The birth coordinates travel with the solid and anchor domain-warped, three-octave noise. Stage 1 uses the solver's low-diffusion transport and `0.000002 + agitation * 0.000003` ion diffusivity in the existing 0.05 s step. The old material and bookkeeping remain available with the stage selector.

The volume is one box proxy rendered by a 48-step ray march. It samples the dense field and instantaneous local product source, applies two smooth density thresholds (`0.04..0.8` and `0.2..0.95`) around advected material-space noise, and takes at most three additional light samples at occupied steps. The result has a white dense core, translucent edge, and weak blue source tint. The volume mesh, material, textures, and buffers are made when the tube visuals are created, before reaction onset. The new stage render path allocates no per-frame objects. No browser or GPU shader compilation was available to verify its appearance or compile timing.

Set `window.__silverStage = 1` before creating the tube, or leave it unset, for this view. Set it to another number and recreate the tube to use the retained earlier silver representation. The field chooses its route when constructed, so changing the value during an active tube does not migrate existing mass.

## Numerical checks

The deterministic LOW-grid diagnostic uses an 8 × 18 × 8 grid and 100 simulation steps. It produces [ASCII slices](slices.txt) of x-y and x-z midplanes before the pour and at steps 5, 20, 50, and 100 for dense AgCl, Ag+, Cl-, and the current product source. Before delivery, dense mass and consumed extent were zero. On the first delivery step, every nonzero dense cell had a nonzero local product source. At every step, including after a liquid-level increase, tilt, and shake, dense mass equaled consumed reagent within `1e-8`; fine, coarse, floc, and sediment reservoirs remained empty. All checked ion, dense, and material-coordinate values were finite. Repeating the center-pour scenario gave identical arrays and diagnostics.

The tilted and shaken scenario ended at extent `0.481689`. At normalized concentration threshold `0.01`, its dense field had **one connected component of 472 cells**. The dense center moved from x=`3.502` grid cells for a center pour to x=`4.325` for a wall pour. The measured maximum mass-balance error in the center and wall comparison was `2.887e-15`.

## Verification

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit`, passed with zero errors.
- Focused tests: 4 files, 43 passed, 0 failed. See [focused.log](focused.log).
- Full suite, one Vitest process: 48 files passed; 315 tests passed, 2 expected failures, 0 unexpected failures. See [full-suite.log](full-suite.log).
- `git diff --check`: no whitespace errors.

Five silver renderer assertions that required visible floc instances, milkiness, or sediment were updated to assert the stage 1 field and hidden old representation. Non-silver assertions were preserved. Pure density mapping tests cover bounds, determinism, non-finite inputs, and zero density when solid mass is absent.

## Remaining verification and integration

No browser frames were captured. The actual cotton silhouette, source tint, transparency, performance, and WebGL shader compilation still need browser inspection. The LOW-grid ASCII slices show a broadening upper plume by step 100; whether the rendered threshold and material-space noise keep it visually distinct from a milky column remains unverified. There are no requested edits outside the owned paths and no integration blocker identified.
