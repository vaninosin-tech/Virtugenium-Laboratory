# Wave 18 F4: visible AgCl aggregates and sediment

## Implementation

- `src/scenes/laboratory/lib/night/render/silverFlocReconstruction.ts` redistributes each conserved aggregate voxel across eight subvoxels. Physical node positions, radii and links set relative weights. Each group of eight sums to its original voxel density; the shader samples this texture in place of the coarse aggregate texture. Fine suspension remains separate. With no nodes, including `__silverAgg=0`, the renderer uses the original aggregate texture.
- `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts` combines fine and aggregate optical depths at each ray step and weights radiance by depth. Dense cores can saturate toward the shared light plus ambient bound. The four solid and four optics modes remain selectable. `src/scenes/laboratory/lib/night/render/silverOpticsReference.ts` mirrors the shader with shared coefficients.
- `SilverSedimentGeometry` in `src/scenes/laboratory/lib/tubeSilverSediment.ts` follows the bowl and samples physical `sedimentHeightTexture`. The silver path of `tubeReactionVisuals.ts` binds it. The sediment shader uses interpolated mesh thickness for alpha; another height sample supplies gentle tone only. Display scale defaults to one and does not alter simulation mass.
- `tests/_wave16/validateAggregates.mjs` checks program links, aggregate binding and upload, floc data, sediment arrival and a nonempty render. `tests/_wave16/captureLayers.mjs` and `tests/_wave18/captureLayers18.mjs` capture the four solid modes on black, gray and laboratory backgrounds at 3, 6, 9, 14 and 20 seconds. A cloned synthetic map and 10 times display scale expose the sediment for moire inspection.
- `tests/_wave15/baselineRecord.mjs` defaults to 24 seconds, records true simulation time and floc count and radius. `tests/_wave15/buildComparison.mjs` stage-aligns game and reference and adds fine, aggregate, deposit and floc panels.

These source and tooling changes were present when attempt 2 began. Attempt 2 reran verification, restored generated diagnostics and updated this report. Its only other final change is `docs/night/wave18f4/reconstruction-benchmark.json`, rewritten by the performance test.

## Measurements and limits

The available prior-population `docs/night/wave16shared/state_9s.json` has a 12 x 24 x 12 grid. Positive aggregate density has p50 0.02136 and p95 0.39403 (ratio 18.44). Adjacent-cell absolute gradient p50/p95 is 0.01075/0.21972. Estimated aggregate optical depth across 126 nonzero straight columns has p50/p90 0.648/3.676; 23 rays exceed depth 3. Coarse trilinear sampling and fine-first compositing smoothed or obscured dense regions. A nominal 2.1 mm node would span about 2.84 cells horizontally and 1.69 vertically in the old splat. Actual per-node support counts are unavailable because this dump has no nodes.

That dump contains fine 0.65344, aggregate 0.11743 and sediment 0.03200 mass units at extent 0.80287. Its maximum physical deposit height is 6.40 micrometres, so a barely visible physical deposit at 9 seconds is expected. The CPU bright-wall value is 0.85; the strongest distinct aggregate/fine ray composites to 0.911/0.793, a difference of 0.118. These are CPU estimates, not browser pixel measurements. F3's refreshed 0.1 M state must replace this older dump before final optical judgment.

The controlled 10 times sediment CPU diagnostic compares the `7690e47` periodic detail and competing alpha heights with the current shader model. The high-pass FFT peak to broadband ratio changed from 0.07466 to 0.06427; energy at the old lattice frequency changed from 0.97718 to 0.000868 of broadband. The CPU crops are `sediment-diagnostic-before.ppm` and `sediment-diagnostic-after.ppm` in this directory. This verifies removal of that specific frequency in the CPU model. Browser moire, depth sorting and aliasing remain unmeasured.

The 88-step march uses up to six state taps per occupied combined sample: one fine density, one aggregate density and two light taps for each. Reconstruction adds no shader taps and uses eight times the aggregate voxel count, about 0.44 MB for the 12 x 24 x 12 grid. The current worst-case CPU benchmark (3,456 occupied cells, 260 nodes, 200 links) measured 13.58 ms median and 21.17 ms p90 per rebuild in this sandbox. Compiled GPU instruction count and the 44 median / 33 p10 pour FPS target require coordinator browser measurement.

## Attempt 2 verification

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed, 0 errors |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/night/wave18f4/reconstruction.test.ts tests/night/wave18f4/sedimentDiagnostic.test.ts tests/night/wave18f4/reconstructionPerf.test.ts tests/tubeReactionVisuals.test.ts` | 4 files passed; 46 tests passed, 0 failed |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism` | 84 files: 82 passed, 2 failed; 462 tests passed, 2 failed, 3 expected failures |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/night/wave18f4/reconstruction.test.ts` after diagnostic restoration | 1 file passed; 7 tests passed, 0 failed |
| `node tests/_wave18/sedimentMoire18.mjs` | Passed; CPU crops and FFT metrics generated |
| `node tests/_wave18/restoreDiagnostics18.mjs` | Restored 444 tracked diagnostic files written by older tests outside F4 ownership |

The two full-suite failures are old expectations in `tests/night/wave4a/field.test.ts` (surface threshold) and `tests/night/wave6perf/flocPerf.test.ts` (exact mass). Neither file is owned by F4.

## Coordinator browser commands

Start the game server in one terminal:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort
```

In a second terminal:

```powershell
node tests/_wave16/validateAggregates.mjs
$env:OUT='docs/night/wave18f4/browser'; node tests/_wave18/captureLayers18.mjs
$env:OUT='docs/night/wave18f4/recording'; $env:BOTH='1'; $env:SLOW='0.15'; $env:DURATION_MS='24000'; $env:INIT='window.__silverAgg=true;'; node tests/_wave15/baselineRecord.mjs
$env:GAME='docs/night/wave18f4/recording/wide'; $env:COMPARE_OUT='docs/night/wave18f4/comparison'; node tests/_wave15/buildComparison.mjs
```

Use the same camera and synthetic map on `7690e47` and this version to compare browser FFT crops. Inspect the 3, 6, 9, 14 and 20 second combined, fine-only, aggregate-only and sediment-only PNGs on all three backgrounds; measure floc core, fine milk and bright wall luminance, and pour FPS. No browser was available in this worktree, so no PNG, program-link or FPS result is claimed.

## Integration requests

- F3 should include node coordinates, radii, links and per-node raster support counts in its refreshed shared dumps. The current dump has no nodes, so physical subcell structure cannot be checked against a real state.
- The coordinator should rerun CPU metrics and browser captures against F3's final 0.1 M population and sediment state. The older dump's mass and 9 second deposit numbers are provisional.
- Browser validation is required to establish whether the cotton structures, bright-wall contrast and visible diagnostic deposit meet the reference, and whether moire is fully gone at the target frame rate.
