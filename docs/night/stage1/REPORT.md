# AgCl stage 1, iteration 2

## Design and changes

The default diagnostic view for experiment 2 contains the existing external `PourStream`, the faint blue local product-source field, and one white ray-marched dense field. The tube liquid remains clear; fine suspension, instanced flocs, fragments, and the separate sediment geometry are hidden. The `PourStream` component is outside this worker's ownership and was not changed. The stage 1 visuals do not toggle its visibility. Experiments 1, 3, and 4 retain their existing render branches. `tests/tubeReactionVisuals.test.ts` checks that the dense mesh exists only for silver and checks resources for all four reactions.

Each local `precipitatePair` consumption is added in full to `TubeSilverField.dense` and to the diagnostic `productSource`; no solid enters another reservoir in stage 1. The solver transports dense mass and three mass-weighted material coordinates using its low-diffusion flux-limited scheme with zero explicit dense diffusivity. A conservative neighbor transfer settles the mass at `0.012 / (1 + 1.5 * local concentration)` m/s, capped at 0.45 cell per 0.05 s step. A second conservative transfer moves at most 2.5% of a lower-density cell toward a neighboring cell at least 20% denser. This local coagulation sharpens the mass without creating it. It has six face checks per active cell per step and no new per-frame allocation. Material coordinates move with both transfers and anchor the cotton noise.

The ray proxy extends to 1.2 tube radii and 0.15 radius above and below the field. A real cylindrical liquid mask and a radial fade from 0.87 to 0.985 radius keep the proxy faces from defining a straight visible edge. The shader uses 56 fixed primary steps and at most three additional light samples at occupied steps. Four noise evaluations (one warp plus three octaves) use transported material coordinates; higher spatial frequencies tear the threshold into folds, pores, and vertically stretched detail. The optical threshold spans concentrations 0.025 to 0.135 with a separate dense-core ramp from 0.055 to 0.22. White non-emissive extinction is 19 per radius. The blue source tint has much lower opacity. The mesh, shaders, textures, and buffers are created with the tube, before reaction onset.

Set `window.__silverStage = 1` before creating the tube, or leave it unset, for stage 1. Set it to another number and recreate the tube to select the retained older silver path. The field chooses its mass route at construction; switching an active tube does not migrate its mass.

## Numerical evidence

The deterministic LOW-grid diagnostic uses an 8 x 18 x 8 grid and 100 steps (5 s). [ASCII slices](slices.txt) show x-y and x-z midplanes before delivery and at steps 5, 20, 50, and 100 for dense AgCl, Ag+, Cl-, and current overlap. Before delivery, dense mass and consumed extent are zero. On the first delivery step, every nonzero dense cell has a local product source. At every step, including liquid-level change, tilt, and shake, dense mass equals consumed reagent within `1e-8`; all checked values are finite; other solid reservoirs remain empty. The largest measured mass-balance error was `2.831e-15`. Repeating a center pour produced identical arrays and diagnostics.

The dense center starts at y=`10.74` on the LOW grid, where the top wet cell is y=11. The above-0.04 vertical span grows from 2 cells at step 1 to 4 at step 5, 8 at step 20, and 12 at step 50. The fraction of dense mass in the lowest three rows rises from `0.001` at step 20 to `0.046` at step 50 and `0.279` at step 100. The final tilted and shaken field has one connected component of 440 cells above concentration 0.01. A center pour ends at x=`3.502` cells; a wall pour ends at x=`4.242` cells. These are numerical checks, not visual observations.

## Verification and limitations

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit`, passed with zero errors.
- Focused Vitest run: 4 files, 43 passed, 0 failed. See [focused.log](focused.log).
- Full Vitest run: 46 files passed, 2 failed; 313 tests passed, 2 failed, 2 expected failures. Both failures were non-silver CPU timing tests: a barium motion test timed out at 30 s, and a Cu(II) step averaged 3.27 ms against a 3 ms soft budget. See [full-suite.log](full-suite.log).
- Those two files rerun alone: 2 files, 14 passed, 0 failed. See [non-silver-rerun.log](non-silver-rerun.log).
- A second full-suite run was stopped after severe host slowdown caused widespread unrelated timeouts; it has no valid final pass count. Its partial output is in [full-suite-final.log](full-suite-final.log). The completed first full-suite run above is the reported result.

## Files modified in iteration 2

- `src/scenes/laboratory/lib/tubeSilverField.ts`: faster conserved dense settling, zero explicit dense diffusivity, and local conservative compaction.
- `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`: ragged high-frequency cotton mapping, brighter density, radial fade, larger proxy bounds, and 56-step march.
- `src/scenes/laboratory/lib/tubeReactionVisuals.ts`: silver-only proxy geometry enlargement.
- `src/scenes/laboratory/lib/night/stage1/density.ts`: pure CPU counterpart of the shader mapping.
- `tests/night/stage1/field.test.ts`: upper-origin, growing-extent, and floor-accumulation assertions and numerical profiles.
- `docs/night/stage1/slices.txt` and this report: refreshed diagnostics and measured results. Test logs in this directory are generated and ignored by Git.

No browser or GPU rendering was available in this worker. The silhouette, perceived whiteness, stream visibility in browser frames, and shader compilation time are unverified. The reference frames were inspected as read-only images. A later browser review must determine whether this numerical and shader change looks like the upper cotton curtain and bottom heap. No integration edit outside the owned paths was made. If the external `PourStream` is absent during an actual pour, its timing and visibility must be investigated in `src/scenes/laboratory/ui/PourStream.tsx` by its owner.
