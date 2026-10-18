# Wave 16 F2: aggregate optics and AgCl sediment

## Changes

- `tubeSilverVolumeMaterial.ts` keeps the accepted fine suspension path and adds `uAggregate` plus `uSolidMode`: 0 fine, 1 aggregates, 2 combined (default), 3 sediment only. The four existing `uOpticsMode` choices apply to each solid mode. Aggregate opacity follows texture R, with porosity from G, compaction from B and subcell fibre direction from A. Fibre modulation is bounded to 8% of local extinction and is strictly multiplicative, so it cannot create a lobe or move the field's zero mask. Two aggregate light taps add self shadowing and a bounded multiple scattering term using the fine cloud's light direction. The old procedural cotton structure and its independent opacity contribution are removed from the stage 3 march. Stage 3 fine and aggregate mass are sampled from distinct textures.
- `tubeReactionVisuals.ts` binds `field.aggregateTexture ?? field.denseTexture` in the silver path and passes `field.sedimentHeightTexture` to the silver sediment geometry and material. Stage 3 shows the deposit only after settled mass exists. The sediment material uses the height texture for thin edge alpha and small curd shading.
- `SilverSedimentGeometry` interpolates F1's height map at each vertex, follows the 7 mm hemispherical floor, tapers at the rim and adds bounded curd scale height variation. Its legacy mass based height path remains as a fallback.
- `silverOpticsReference.ts` contains the shared aggregate coefficients, CPU layer marcher, sediment height sampling, and PPM renderer. The 16 synthetic panels and [contact sheet](synthetic-sheet.ppm) cover four solid modes by four optics modes. These are CPU renders from a **synthetic** state, not game or GPU images.
- New unit tests check opacity, translucency, monotonicity, porosity, field controlled masks, separate texture use, numeric GLSL literals and sediment geometry. Two long silver visual tests have explicit 15 second timeouts because their simulation loops exceeded the prior 5 second limit on this worker.

Modified source and test files: `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`, `src/scenes/laboratory/lib/tubeSilverSediment.ts` (`SilverSedimentGeometry` only), `src/scenes/laboratory/lib/tubeReactionVisuals.ts` (silver hunks only), `src/scenes/laboratory/lib/night/render/silverOpticsReference.ts`, `tests/tubeReactionVisuals.test.ts` (two silver timeouts), `tests/night/wave16f2/aggregateOptics.test.ts`, `tests/_wave16/validateAggregates.mjs`, and `tests/_wave16/captureLayers.mjs`. Generated outputs are the 16 `synthetic-layer*.ppm` panels and `synthetic-sheet.ppm` in this directory.

## Cost

The primary march remains one uniform bounded 88 step loop. For a sample containing both states, the new aggregate path adds one aggregate texture lookup, two aggregate light lookups and two analytical sine evaluations. The fine path retains one fine lookup and two light lookups. Thus a fully occupied combined sample has up to six state texture taps, or 528 over 88 steps before early exit, excluding diagnostic and disabled smoke paths. In aggregate only mode it has three state taps per occupied sample. The previous cotton noise and 7 tap `denseAt` blur are no longer called in the main path. These are source level counts. Compiled GPU instruction count, shader link time and actual per pixel cost could not be measured without the browser/GPU; compare to the accepted 44 median and 33 10th percentile FPS baseline in the coordinator's run.

## Verification

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/tubeReactionVisuals.test.ts tests/night/wave16f2 tests/night/wave11c4/shaderSource.test.ts` | 45 passed, 0 failed, 3 files |
| `node --check tests/_wave16/validateAggregates.mjs` | Passed |
| `node --check tests/_wave16/captureLayers.mjs` | Passed |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism --testTimeout 10000` | 439 passed, 2 failed, 3 expected failures across 77 files. Only the documented `wave4a` surface raft and `wave6perf` floc snapshot failures remain. This run preceded the final one line sediment only shader short circuit; the focused shader tests and typecheck passed after it. |

The full suite rewrote tracked diagnostic outputs. They were restored with `tests/night/wave14g1/restore-diagnostics.mjs` and byte equivalent restoration of its two omitted wave14 outputs. No diagnostic output remains modified.

## Coordinator browser commands

Start the dev server and run these with installed Chrome:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort
node tests/_wave16/validateAggregates.mjs
node tests/_wave16/captureLayers.mjs
```

`OUT` changes the default output directory `docs/night/wave16f2/browser`; `ELAPSED_MS` selects validation time and `TIMES_MS` is a comma separated capture list. The scripts set stage 3 and aggregation on, use the app exposed diagnostic and runtime handles, and leave each capture state paused. No browser or GPU validation was run in this worker.

## Remaining issues and integration requests

- `docs/night/wave16shared/` contained only `README.md` during this worker's run. F1's real state dumps, and F1's new textures, were unavailable here. The CPU PPM panels are explicitly synthetic. Once F1's dumps arrive, rerun `tests/night/wave16f2/aggregateOptics.test.ts` and adapt the dump reader to the actual dump format if needed. The test currently accepts JSON files with `field` or top level `fine`, interleaved `aggregate`, `sedimentHeight`, grid dimensions and vessel coordinates.
- The coordinator must run browser validation and inspect the captures for aggregate silhouette, sediment contact with the bowl, texture upload, program linkage and pour FPS. CPU tests cannot establish those visual or GPU facts. If the sediment texture is never uploaded or the silver bed remains hidden despite deposited mass, inspect F1's producer and the `TubeSediment` material binding together.
- Source instruction counts are provided above; compiled instruction count is a browser/GPU integration measurement.
