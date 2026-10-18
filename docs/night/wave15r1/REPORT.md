# Wave 15 R1: experiments 1, 3 and 4 after the vessel correction

## Findings

`tubeVessel` models the 7 mm radius, 7 mm hemispherical bottom. The mesh starts at local y = 0.5 mm, so add 0.5 mm to every height in the table for the world plane of an untransformed tube. The legacy column uses the former 2.5 mL = 55 mm calibration. Values above 55 mm exceed the authored liquid body; they are mathematical extensions of that mapping, not contained volumes.

| Stage | Stored mL | Legacy height, mm | Corrected height, mm | Legacy physical volume in 7 mm bowl, mL | Corrected wet grid, mL |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sulfite base / BaCl2 base / copper preset | 2.5 | 55.000 | 18.574 | 8.107 | 2.500 |
| First liquid pour into a 2.5 mL preset | 3.5 | 76.487 | 25.070 | 11.415 | 3.500 |
| Sulfite + acid + permanganate | 4.5 | 97.974 | 31.566 | 14.723 | 4.500 |
| A 1 mL charge in isolation | 1.0 | 22.770 | 8.829 | 3.146 | 1.000 |
| Tube game capacity | 5.0 | 108.717 | 34.814 | 16.377 | 5.000 |

At the common 2.5 mL stage the old physical volume was **3.243 times** the stored amount; at 3.5 and 4.5 mL the ratios were 3.261 and 3.272. The new `LiquidMask.cellVolumeMl` sum is the stored amount within 1e-9 mL at 1, 2.5, 3.5, 4.5 and 5 mL. This grid normalization is checked in `geometryRegression.test.ts`; it does not prove exact volume under tilt, which remains a wave 14 limitation.

### Experiment 1: copper and dilute HNO3

The copper preset contributes 2.5 mL and three amount units of copper. A standard acid click adds 1 mL from the HNO3 source, making the receiving level 25.070 mm after delivery; the initial level is 18.574 mm. `TubeCopperGranules` places one irregular mesh representing the copper charge at the bowl. In the deterministic fixture its upper vertex stays below the 18.574 mm surface, and its lower vertex stays within 1 mm of the bowl origin. The production visual additionally fits the mesh within the rounded bowl on each update; the existing visual test checks real vertices at -20, 0 and +20 degrees. No 55 mm position remains in this placement.

The Cu(II) field uses the 34.814 mm 5 mL domain, with its mask updated at `level = bottom + size.y * fill`; the visible wall, cap, absorption wall and active liquid receive that same plane. Cu(II) and HNO3 remain in wet cells to below 1e-10 amount units in the replay. Cu(II) equals 1.65 times the field reaction extent within 1e-6, and residual HNO3 plus 4.4 times the extent equals its 4.4 charge within 1e-5. Copper sources are selected from wet metal-adjacent voxels. `TubeNOBubbles` samples wetted vertices, caps radial position to less than the radius, and removes rising bubbles when their top reaches the plane; the replay observes both births and pops. The decorative pour-air bubbles use the same computed `surfaceY` and a below-surface visibility condition. The ledger's separate normalization consumes copper and forms Cu2+ in equal 3:3 units per progress increment.

### Experiment 3: BaSO4

BaCl2 starts at 18.574 mm and the K2SO4 pour raises the level to 25.070 mm. `tubePourImpact` computes its target at the current level; `tubeReactionVisuals` moves the barium inlet to 0.7 mm below the actual surface after applying the impact's radial position. The stand path uses `stepTubePour` and the validated impact, while barium's field receives `impact.deliveredMl`; it does not use stage-3 silver's runtime source. The `legacySteps` bookkeeping is confined to the compatibility `publishTubePourImpact` entry point. `productSource` is created only where transported Ba2+ and sulfate coexist. The field replay forms precipitate, with Ba2+ + extent = 1.1, sulfate + extent = delivered amount, and suspended + coarse + sediment = extent, each within 1e-5. Every tested scalar, including suspension and product source, has less than 1e-9 amount in dry cells. Coarse mass remains below 15% of solid mass in this replay; no silver floc representation was added.

`BariumSedimentGeometry` uses the same 7 mm hemispherical floor as the mask, starting at the measured liquid-body bottom. Its top is bounded by the floor plus `0.12 * radius`, or 0.84 mm, and the closed underside sits 0.03 mm below the floor. The deterministic mesh test checks every vertex to 0.1 micrometre. The film does not float above or sink below the glass bowl at its top surface. Its thickness is an optical packing rule capped at 0.84 mm, not an independent conversion of solid mass to literal solid millilitres.

### Experiment 4: sulfite, acid and permanganate

The intended sequence is Na2SO3 at 2.5 mL / 18.574 mm, H2SO4 at 3.5 mL / 25.070 mm, and KMnO4 at 4.5 mL / 31.566 mm. The visual uses the live amount for each level. The incoming KMnO4 inlet is projected to 0.7 mm below that level and the field injects there. In the replay, all species and tracer have less than 1e-8 amount in dry cells at every stage. At the end, MnO4- + 2 extent = 2, SO3(2-) + 5 extent = 6, H+ + 6 extent = 7.2, SO4(2-) = 5 extent and Mn2+ = 2 extent, each within 1e-5. The one-millilitre delivered permanganate charge is scaled to two normalized field units in production (`2 * impact.deliveredMl`), as in the test. The permanganate field and its absorption texture bounds both span the authored 55 mm domain, while their visible wall and tint are clipped by the 31.566 mm plane. The longer texture domain costs some vertical resolution but does not place mass above the surface in this replay.

## Regressions and fixes

No reproducible new R1 regression was found. There are no `it.fails` cases and no production code changes. The shorter level makes the liquid column substantially different from the legacy appearance, so the coordinator's browser images are still needed for visual acceptance. The full suite's four failures are outside R1 ownership and predate this review: wave4a surface raft threshold, wave6perf golden total, and two silver visual test timeouts. Existing tilted free-surface volume mismatch remains an integration limitation from wave 14.

## Capture handoff

`tests/_wave15/captureExperiments.mjs` uses the installed Chrome via Playwright, the real stand actions and app-exposed stores, pauses each stage with `window.__diag`, and saves a labelled tube PNG plus JSON with measured level, object positions, material level/bounds uniforms, and `renderer.info`. `URL_BEFORE` triggers a second pass against commit 76f7350 served on another port. Module imports are used for pure level calculations and stand actions; live amount data comes from the app's `window.__tubeAmount` handle. `compareExperiments.mjs` prints and executes the exact ffmpeg arguments to make paired images and a contact sheet per experiment.

PowerShell commands for the coordinator, with both dev servers running:

```powershell
$env:URL = 'http://127.0.0.1:5201/'
$env:URL_BEFORE = 'http://127.0.0.1:5202/'
$env:OUT = 'tests/_wave15/r1/captures'
node tests/_wave15/captureExperiments.mjs
$env:FFMPEG = 'C:\Users\Aiyrell\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe'
node tests/_wave15/compareExperiments.mjs
```

The coordinator should inspect the seven stage pairs, especially copper immersion, the barium bed and the permanganate front. These scripts were syntax-checked, but not executed here: no two live game servers or browser were available in this worker run. No PNG or visual result is claimed.

## Verification and modified files

- `tests/night/wave15r1/geometryRegression.test.ts`: 11 passed, 0 failed.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `node --check tests/_wave15/captureExperiments.mjs` and `node --check tests/_wave15/compareExperiments.mjs`: passed.
- Full Vitest suite, one process: 424 passed, 4 failed, 3 expected failures across 75 files. The four failures are named above. The suite rewrote diagnostic files; they were restored to their prior contents after the run.
- Modified or added: this report, the R1 geometry regression test, and the two capture/compare scripts. No production files were modified.

There is no R1 integration blocker for merging these test and documentation changes. Browser comparison and the existing four non-R1 test failures remain coordinator work.
