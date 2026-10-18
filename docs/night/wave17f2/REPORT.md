# Wave 17 F2b report

## Changes in this worktree

- `src/scenes/laboratory/lib/night/render/silverOpticsReference.ts`: lowered the aggregate looseness extinction discount from 0.55 to 0.25. GLSL reads the same shared constant in `tubeSilverVolumeMaterial.ts`; no shader mass term was added. The fine path and the aggregation-off baseline remain untouched.
- `src/scenes/laboratory/lib/tubeReactionVisuals.ts` (silver sediment only): render the top surface once with front-face culling and depth testing. The fragment alpha now uses the mesh thickness. Its additional texture sample only supplies a gentle tone variation, avoiding a second height threshold applied at a different interpolation frequency.
- `tests/_wave16/captureLayers.mjs`: isolate sediment visibility in fine-only and aggregate-only captures, and restore it before simulation resumes.
- `tests/night/wave17f2/opticsAndCapture.test.ts`: static sediment frequency and height-source guard.
- The focused CPU tests regenerated their PPM images under `docs/night/wave16f2/` and `docs/night/wave17f2/`. They are CPU output, not browser captures.

## Measurement and decision

From `docs/night/wave16shared/state_9s.json` (12 x 24 x 12), the positive aggregate density cells have p50 0.0204, p95 0.932 and maximum 4.246. About 96.6% of density mass in active cells is above density 0.1. The median absolute adjacent active-cell gradient is 0.045, p95 0.662. Thus this dump is neither uniform nor universally too dilute. Mass-weighted looseness is 0.99995 and compaction is 0.0246. The old porosity/compaction mapping left about 38% of nominal extinction for typical mass. Along 137 nonzero column rays at 9 s, the old approximate optical-depth p50/p90 was 0.478/4.077, with 22 rays above depth 3. The new shared coefficient gives 0.797/6.795 and 35 rays above depth 3. Thin columns remain translucent. These are cell-centre column estimates, not GPU pixels.

Grid pitch is 1.17 mm horizontally and 2.29 mm vertically; a roughly 70 mm box ray takes 0.80 mm per primary step. The 88-step march therefore samples a horizontal cell about 1.5 times and a vertical cell about 2.9 times. Trilinear filtering can soften boundaries but is unlikely to be the dominant global translucency cause. The producer's `FlocSystem.splat` distributes each node over a Gaussian box based on 1.3 node radii plus half a cell, with normalized weights. Its `dumpAggregateState()` omits node positions and radii, so the actual cell count per node could not be measured. A shader node reconstruction would require a bounded GPU node buffer and mass-conserving handoff; this was not added on an unmeasured assumption.

The CPU 9 s aggregate-only PPM, using lower-tube centre x 14..33, y 65..89 versus side x 2..7 over the same rows, has mean luminance and contrast: black 0.515 / +0.342, gray 0.756 / +0.177, laboratory 0.924 / +0.062. These regions follow the settled aggregate in this dump. The earlier mid-tube region is nearly empty, so it cannot serve as the core contrast sample. The 0.924 lower core is brighter than the 0.85 CPU laboratory background. Browser glass, tone mapping and actual wall contrast remain unmeasured.

The sediment texture is already linear-filtered in `tubeSilverField.ts`. The silver surface previously used double-sided rendering with depth testing disabled, then applied `min(interpolated mesh thickness, fragment texture height)` to alpha. The two heights have different interpolation domains on a 14-ring, 40-sector regular mesh over a 12 x 12 height map. This is a plausible source of a repeated triangle/dot pattern. The silver shader contains no periodic curd-detail sine or hash function. The fix removes the duplicated back-face contribution and the competing height threshold. The browser FFT metric and before/after crops are still needed to verify that this is the observed moire cause; no browser result is claimed.

The volume march still has 88 primary steps. In combined occupied samples it makes one aggregate sample, two aggregate light samples, one fine sample and two fine light samples, up to six state taps per step. The sediment change keeps one height-texture tap and removes one `min` in its surface fragment. No extra full-volume pass was added. GPU instructions and pour FPS were not measured in this worktree.

## Verification

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed, 0 errors |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/night/wave17f2/opticsAndCapture.test.ts tests/night/wave16f2/aggregateOptics.test.ts tests/tubeReactionVisuals.test.ts` | 3 files, 49 passed, 0 failed |
| `node --check tests/_wave15/baselineRecord.mjs` | Passed |
| `node --check tests/_wave15/buildComparison.mjs` | Passed |
| `node --check tests/_wave16/captureLayers.mjs` | Passed |

The full suite was not rerun. It rewrites diagnostics outside ffour's exclusive ownership; the interrupted attempt had already left about 400 such files dirty when this turn began. I left them untouched. The focused CPU tests also regenerate the owned wave16f2 and wave17f2 PPM panels.

## Coordinator commands and outstanding evidence

Start the game server with `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort`, then in a second terminal:

```powershell
node tests/_wave16/validateAggregates.mjs
node tests/_wave16/captureLayers.mjs
$env:OUT='docs/night/wave17f2/recording'; $env:BOTH='1'; $env:SLOW='0.15'; $env:DURATION_MS='22000'; node tests/_wave15/baselineRecord.mjs
$env:GAME='docs/night/wave17f2/recording/wide'; $env:COMPARE_OUT='docs/night/wave17f2/comparison'; node tests/_wave15/buildComparison.mjs
```

The already present recording tools default to 22 s and dumps at 0.5, 1, 2, 3, 4.5, 6, 9, 12, 14, 17, 20, 22 s. `trace.json` holds simulation timestamps; `stages.json` holds measured markers. Comparison alignment uses visual stage metrics, and its panels include fine, aggregate and sediment raw views. The coordinator should capture a before crop from the prior silver shader and an after crop from this worktree under the same state and camera, compare `captureLayers.json` sediment `peakToBroadband`, inspect all four solid and optics modes, confirm no glass occlusion from depth testing, and measure pour FPS against median 44 / p10 33.

Integration request to F1b: add node position, radius, mass and per-node raster support-cell count to the shared dump (without changing the existing texture interface). This would determine whether sub-cell reconstruction is justified. Current shared dumps contain only grid fields. Also confirm the physical redistribution after F1b's refresh; 9 s mass in this dump is fine 0.155, aggregate 0.279, sediment 0.447, so most formed solid has already settled.
