# Wave 18 F4: aggregate structure and sediment surface

## Changes

- `src/scenes/laboratory/lib/night/render/silverFlocReconstruction.ts`: reconstructs the aggregate field at twice the resolution on each axis. Each coarse voxel's eight children sum to exactly its original density. The physical nodes, their radii and links only redistribute that density. A reusable cell list selects at most four nearby nodes or links per child; no node mass is added to the existing aggregate field. The original field remains the fallback when no nodes exist, including `__silverAgg=0`.
- `src/scenes/laboratory/lib/tubeReactionVisuals.ts`: binds the reconstructed texture for stage-3 AgCl, keeps the fine texture separate, and supports display-only sediment height/texture diagnostics. The default diagnostic scale is 1 and there is no synthetic texture by default. No other experiment path was changed.
- `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts` and `lib/night/render/silverOpticsReference.ts`: fine and aggregate optical depths within one ray step now form one extinction event, with source radiance weighted by each depth. The previous fine-first compositing systematically covered aggregates in the same sample. Aggregate multiple scattering now saturates dense cores toward the shared light-plus-ambient cap; the fine coefficients are unchanged. The CPU reference accepts the doubled-resolution aggregate grid and mirrors the mixed compositing and sediment alpha/tone functions.
- `src/scenes/laboratory/lib/tubeSilverSediment.ts`: the bowl-following sediment mesh has 24 rings and 64 sectors instead of 14 and 40. A diagnostic display scale changes geometry only. Physical heights still come from `sedimentHeightTexture`.
- `tests/_wave16/` and `tests/_wave18/`: browser validation checks the displayed aggregate texture, its upload, node data, shader programs, deposit arrival and nonempty image. Capture covers four solid modes, four optics modes, three backgrounds and 3, 6, 9, 14, 20 s. A controlled synthetic sediment texture is cloned for the diagnostic capture without modifying the field. `sedimentMoire18.mjs` produces CPU before/after crops and FFT metrics. `restoreDiagnostics18.mjs` cleans old tests' generated files.
- `tests/_wave15/`: baseline recording defaults to 24 s, records node count and radius, and the stage-matched comparison adds aggregate density and floc count/size panels.
- `tests/night/wave16f2/`, `wave17f2/`, `wave18f4/`: optics, mass-integral, source separation, structure, moire, GPU-tap and capture guards. Older CPU panel tests now write under `docs/night/wave18f4/` rather than older waves' directories. The wave16f2 reader skips the pre-existing malformed `mass-state.json` and selects state dumps only.

## Measurements before and after

The available `docs/night/wave16shared/state_9s.json` has a 12 × 24 × 12 grid. This state has aggregate density p50 0.02136 and p95 0.39403 among 1,130 positive cells, a p95/p50 ratio of 18.44. Adjacent-cell absolute gradient p50 is 0.01075 and p95 is 0.21972. Across 126 nonzero straight z columns, estimated aggregate optical depth p50/p90 is 0.648/3.676 and 23 rays exceed depth 3. The previous render sampled this coarse grid with trilinear filtering after each node was splatted across multiple cells, then composited fine milk before aggregate light. This explains a smooth or partly hidden aggregate even where coarse density has contrast. The previous node formula gives a nominal 2.1 mm node raster support radius of 2.84 cells in x/z and 1.69 cells in y, usually many tens to hundreds of candidate cells. Actual per-node support counts cannot be measured from this dump because node positions and radii are absent.

The current state dump's mass units are fine 0.65344, aggregate 0.11743 and sediment 0.03200 at extent 0.80287. The maximum physical deposit height is 6.40 µm and the median positive column is about 0.000614 µm. This deposit is genuinely almost invisible at 9 s. The shader does not inflate its physical height. The separate diagnostic uses a controlled synthetic height map and 10× display scale.

The CPU reference's 9 s bright-wall value is 0.85. At the strongest displayed aggregate versus fine contrast ray, aggregate/fine are 0.911/0.793, a difference of 0.118. At a ray where combined output exceeds the wall, combined/fine are 1.000/0.961 after display clipping, a difference of 0.039. These are CPU reference values; the browser's glass, exposure and tone mapping have not been measured. See `contrast-9s.json`. The fine path is unchanged, but its 9 s physical mass is much larger than aggregate mass, so combined-mode contrast may remain modest.

The controlled sediment CPU crops reproduce the `7690e47` surface's 183/197 UV sine detail and competing vertex/texture alpha rule, and compare them with the current surface at 10× display height. The overall high-pass FFT peak/broadband ratio changes from 0.07466 to 0.06427. Energy at the old lattice-aligned sine frequencies changes from 0.97718 to 0.000868 of broadband energy. This establishes removal of that specific repeated frequency in the controlled CPU model, not a browser visual result. The before and after crops are `sediment-diagnostic-before.ppm` and `sediment-diagnostic-after.ppm`.

The primary march remains 88 steps. A combined occupied sample still uses one aggregate and one fine density tap, plus two light taps for each, at most six state taps. The reconstruction adds no GPU texture taps and replaces one aggregate texture with an 8× voxel-count texture (about 0.44 MB at 12 × 24 × 12). Mixing the two depths removes one per-sample exponential and adds weighted-source arithmetic. Compiled GPU instruction count and pour FPS could not be measured without the coordinator's browser. A CPU worst-case stress test with all 3,456 cells occupied, 260 nodes and 200 links measured 12.0 ms median and 18.6 ms p90 per rebuild in this sandbox. Real sparse fields skip empty cells, but the 44 median / 33 p10 pour FPS target still needs browser verification.

## Verification

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed, 0 errors |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/night/wave18f4/reconstruction.test.ts tests/night/wave18f4/sedimentDiagnostic.test.ts tests/night/wave18f4/reconstructionPerf.test.ts tests/tubeReactionVisuals.test.ts` | 4 files, 46 passed, 0 failed |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism` | 84 files: 81 passed, 3 failed; 460 tests passed, 3 failed, 3 expected fail |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism src/scenes/laboratory/lib/tubeVolumeField.test.ts` | 1 file, 13 passed, 0 failed; its full-suite 3.05 ms versus 3 ms timing failure did not recur |
| `node tests/_wave18/sedimentMoire18.mjs` | Passed; metrics and two CPU PPM crops written |
| `node --check` on modified `_wave15`, `_wave16` and `_wave18` browser scripts | Passed |

The full-suite `wave4a/field.test.ts` surface-threshold failure and `wave6perf/flocPerf.test.ts` old exact-mass expectation are the known pre-existing failures. The `tubeVolumeField` soft CPU budget was 0.05 ms above its LOW threshold under suite load and passed alone. Full-suite generated tracked diagnostics outside F4 ownership were restored to their original bytes. Git may still show stale `M` status for some PPM files because it cannot refresh the worktree index in this sandbox; `git diff --exit-code --quiet -- docs/night` returns 0 for those files.

## Coordinator browser commands

Start the game server in one terminal:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort
```

Then run in another terminal:

```powershell
node tests/_wave16/validateAggregates.mjs
$env:OUT='docs/night/wave18f4/browser'; node tests/_wave18/captureLayers18.mjs
$env:OUT='docs/night/wave18f4/recording'; $env:BOTH='1'; $env:SLOW='0.15'; $env:DURATION_MS='24000'; $env:INIT='window.__silverAgg=true;'; node tests/_wave15/baselineRecord.mjs
$env:GAME='docs/night/wave18f4/recording/wide'; $env:COMPARE_OUT='docs/night/wave18f4/comparison'; node tests/_wave15/buildComparison.mjs
```

The capture command produces labelled PNGs for every solid/optics/background combination and a synthetic 10× sediment diagnostic for each background and time. Compare its FFT `peakToBroadband` against a capture from `7690e47` at the same camera and synthetic map, inspect the bowl for triangle/UV patterns and depth-sorting artifacts, and record actual core/fine/wall luminance and pour FPS. No browser was available to F4, so no PNG, program-link or FPS result is claimed here.

## Remaining integration requests and risks

- F3 should include node coordinates, radii, links and per-node raster support counts in the shared dump so the actual reconstructed 3D structure can be compared to its physical source. Current dumps contain the coarse field but no node list; the mass-conserving reconstruction is unit-tested with synthetic nodes.
- F3's stage-3 0.1 M population and sediment refresh may change the 9 s mass/height numbers above. Re-run CPU metrics and browser captures against the final shared state.
- Browser validation must confirm shader compilation, display texture upload, glass sorting, the deposit surface at synthetic height and the 44/33 FPS target. The CPU diagnostic removes the old sine frequency but does not prove all browser moire is gone.
