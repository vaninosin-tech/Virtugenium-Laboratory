# Wave 11 C4: optical validation and capture

## Changes

- `ui/DiagnosticTools.tsx` provides the dev-only `window.__diag` API from the mounted scene. It pauses the app simulation clock through `setSimulationPaused`, sets the existing silver material's `uOpticsMode`, controls `DiagnosticCamera` through its existing flag, and adds an unlit black or gray plane behind the clamped tube. Production builds do not expose the API or create the plane. `ui/Laboratory.tsx` adds the import and one mount line beside `DiagnosticCamera`.
- `tests/_wave11/browserCommon.mjs` enters the real lab on port 5201 and uses the real `runStandAction` for AgNO3 then NaCl. `validateShaders.mjs` checks console errors, linked Three programs, the silver mesh and its program, texture upload version, uniforms, and cloud-on/off pixels at one paused state. It writes PNGs and JSON and exits nonzero on failure.
- `captureOpticsMatrix.mjs` writes 48 PNGs, a JSON manifest with the actual frozen clock value and fixed coefficients, and `contact-sheet.sh`. Every timestamp has all three backgrounds and four optics modes while paused.
- `measureFps.mjs` measures 600 real animation frames for the cloud-off baseline and each optics mode, reports median and 10th-percentile FPS and added frame time. It also samples `EXT_disjoint_timer_query_webgl2` if available. There is no `SLOW` clock dilation.
- `shaderSource.test.ts` checks generated stage-3 and legacy GLSL for decimal-free integer operands, Three-managed GLSL versioning, and uniform type consistency. `opticalDiagnosis.test.ts` marches all seven shared field dumps through the CPU reference in all four modes.

The silver shader, `glf()`, field, chemical production, delivery ledger, and experiments 1, 3 and 4 were not edited. The cells and tracer diagnostic branches remain ahead of the four optics modes in the existing shader.

## Optical diagnosis from the CPU reference

The reference uses `kappa=8` and a nominal tube diameter of two radii. For a spatially uniform dimensionless fine concentration `c`, centerline depth is approximately `tau=16c`. Depth 1.61 gives 80% extinction (`c≈0.10`); depth 3.00 gives 95% (`c≈0.19`). This is opacity from the measured field, not a recommendation to increase it.

Twelve representative rays per dump were sampled at x = -3, 0, +3 mm and y = 10, 20, 30, 40 mm, omitting points above the liquid. The table composites mode 0 over black (0), neutral gray (0.5), and a bright-window proxy (0.9). Values are linear reference intensities. Contrast is the change from the corresponding background, not an actual browser pixel measurement.

| Elapsed | Median depth | Maximum depth | Mean black contrast | Mean gray contrast | Mean bright contrast |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.9 s | 0.000 | 1.34 | 0.069 | 0.028 | -0.004 |
| 1.5 s | 0.000 | 5.56 | 0.081 | 0.039 | 0.006 |
| 2.5 s | 0.004 | 5.56 | 0.126 | 0.061 | 0.009 |
| 4.0 s | 0.185 | 4.57 | 0.277 | 0.136 | 0.023 |
| 6.0 s | 0.195 | 5.31 | 0.382 | 0.189 | 0.036 |
| 9.0 s | 0.661 | 5.45 | 0.461 | 0.242 | 0.066 |
| 12.0 s | 0.429 | 5.45 | 0.504 | 0.276 | 0.093 |

At 9 s, black contrast is about 1.9 times gray contrast and 7.0 times bright-window contrast for the same frozen field and coefficients. Peak rays are already thick, but median rays are below the 1.61 depth needed for 80% extinction. The field's uneven coverage and a bright background both weaken the broad white cloud. Mode 2 is gray by definition; mode 3's white scattering confirms the model can emit light where fine material exists. The current dumps cannot establish a physically correct optical coefficient: their concentration is dimensionless and there is no particle-size distribution or mass-to-extinction calibration. Raising `kappa` to defeat the bright room would hide the underlying coverage and background effects.

## Local verification

- `node --check tests/_wave11/browserCommon.mjs` and the same command for `validateShaders.mjs`, `captureOpticsMatrix.mjs`, and `measureFps.mjs`: all passed.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/night/wave11c4`: 4 passed, 0 failed across 2 files.
- `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism --testTimeout 10000`: 380 passed, 3 failed, 4 expected failures across 65 files. The failures were the three pre-existing cases `tests/night/wave4a/field.test.ts`, `tests/night/wave4b/PourStream.test.ts`, and `tests/night/wave6perf/flocPerf.test.ts`; C4 did not change them.

No browser or GPU was available to this worker. The Playwright scripts were syntax-checked but **not executed**. The image, shader linkage, GPU upload, captures, and FPS results remain unverified until the coordinator runs them.

## Coordinator commands

In one terminal, start the dev server:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort
```

In another terminal, with installed Chrome available:

```powershell
node tests/_wave11/validateShaders.mjs
node tests/_wave11/captureOpticsMatrix.mjs
node tests/_wave11/measureFps.mjs
```

Set `OUT` to move generated PNG/JSON files from the default `docs/night/wave11c4/captures`. The contact sheet is generated from that directory with `sh contact-sheet.sh` where ffmpeg and a POSIX shell are available. Review `validateShaders.json` first; any failure requires investigation before interpreting matrix or FPS results.

## Integration and remaining issues

- The full Vitest run rewrote five tracked files outside C4 ownership: `docs/night/stage1/slices.txt`, `docs/night/wave10c1/metrics.json`, `docs/night/wave7reagents/fields.json`, `docs/night/wave7reagents/fields.txt`, and `docs/night/wave7reagents/metrics.json`. These are test side effects, not intended C4 changes. The coordinator must restore those five files before integrating this worker snapshot. C4 did not edit them directly because the contract forbids edits outside owned paths.
- Browser validation and captures must be run by the coordinator. Any browser-only failure, including possible crop alignment or backdrop occlusion, will need a follow-up after actual frames are available.
