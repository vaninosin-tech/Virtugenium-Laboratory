# Wave 14 G1 geometry report

## Result and evidence

The receiving tube's rendered liquid body measures 7 mm in radius and 55 mm tall, with a 7 mm hemispherical bottom. The straight glass bore measures 7.5 mm, the outer glass 9 to 9.8 mm, and the lip is 150 mm above the model origin. [GEOMETRY.md](GEOMETRY.md) gives the measurements, source locations, coordinate mapping, and the distinction between the glass shell and the authored liquid body. The previous 3.849 mm effective radius was a display calibration that made 2.5 game mL reach the 55 mm top. It was not the radius used by the chemistry mask. `tubeVessel` now interprets stored game mL as physical volume in the 7 mm rendered liquid body. Its 5 mL game capacity fits at 34.814 mm, below the 55 mm authored body top. No browser or live WebGL view was available; no visual match is claimed.

| Stored mL | Old liquid height mm | New liquid height mm | Old physical volume in 7 mm mask mL | New mask volume mL |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 12.026 | 5.561 | 1.4921 | 0.5000 |
| 1 | 22.770 | 8.829 | 3.1459 | 1.0000 |
| 1.5 | 33.513 | 12.078 | 4.7998 | 1.5000 |
| 2 | 44.257 | 15.326 | 6.4536 | 2.0000 |
| 2.5 | 55.000 | 18.574 | 8.1074 | 2.5000 |
| 3.5 | 76.487 | 25.070 | 11.4150 | 3.5000 |
| 5 | 108.717 | 34.814 | 16.3765 | 5.0000 |

The old 3.5 and 5 mL heights exceeded the 55 mm authored body and required extra visual wall geometry. The old mask volumes in the table extend that 7 mm bowl/cylinder beyond the authored 55 mm top to show the numerical discrepancy; the authored body itself cannot contain those heights. `tests/night/wave14g1/slices.mjs` generated six central x/y numerical PPMs in this directory, before and after for 1, 2, and 2.5 mL. Red marks the plane, blue the wet interior, grey the dry bore. These are numerical geometry slices, not screenshots or render results.

## Code and conservation

- `lib/vesselGeometry.ts` replaces the stub with the hemisphere and cylinder integral, inverse, area, and sampled voxel wet fraction. Exported names, signatures, units, and `capacityMl` are unchanged.
- `lib/tubeLiquidLevel.ts` and `lib/tubeSilverGeometry.ts` now delegate their deprecated compatibility exports to `tubeVessel`.
- `lib/tubeAmounts.ts` takes the 5 mL capacity and `tubeVisualFill` from the vessel. Existing ledger amounts remain true mL; no stored quantity was reinterpreted or migration of amount records is needed.
- `lib/tubeReactionVisuals.ts` uses the new level for measured attached tubes. It creates chemistry fields only to the 5 mL height, while keeping the 55 mm authored visual wall. Silver cloud material binding paths were not changed.
- `lib/tubeVolumeField.ts` adds per-voxel wet millilitres and a total. Active cells are sampled against the bowl, upright or tilted free surface, and the active volume is normalized to the ledger volume. Existing chemistry arrays in silver, barium, permanganate, and copper are per-cell **amounts**, as shown by their raw-sum diagnostics and mass-balance code, not concentrations. Their regrid paths move amounts from vacated cells to active cells; changing voxel volumes does not rescale these stored amounts. The new cell volumes provide the denominator for any concentration calculation. No independent geometry constant needed replacement in the four field constructors; they receive geometry from the corrected visual and runtime callers.
- `lib/tubeSilverField.test.ts`, `lib/vesselGeometry.test.ts`, `lib/tubeLiquidLevel.test.ts` check mapping, volume, and scalar conservation in the owned paths. `tests/night/wave14g1/levels.test.ts` checks receiving delivery, stream/visible surface equality when upright, and the shared fill mapping for experiments 1, 3 and 4. `tests/night/wave14g1/performance.test.ts` records measured CPU samples and texture sizes.

The new inverse round trips at zero, below/at/above the bowl boundary, 1, 2, 2.5, 5 mL and the cavity top to relative error below 1e-9. The 12 x 24 x 12 active-cell volumes sum to the ledger volume for 0.5, 1, 2, 2.5, and 5 mL upright and at a 30-degree tilt, within the 1e-10 mL assertion. A silver field test moves the meniscus from 1 to 2 mL and tilts it; every ion, suspension class, coarse solid, tracer, dense amount and dense coordinate total remains unchanged to 1e-12 and inactive cells contain no scalar amount. The existing silver reaction test checks Ag+, Cl-, and solid balance after delivery and shaking. These tests do not prove exact geometric volume of the visual plane when tilted: the current renderer's plane intercept is based on upright fill and its shape has not been reinverted for tilt.

The stream and impact free surfaces still call the deprecated `tubeLiquidHeight` compatibility layer and therefore get the new height. Direct imports in `ui/PourStream.tsx` and `lib/tubePourImpact.ts` are G2-owned. The silver shader's `uLevel`, `uBottom`, `uHeight`, and `uRadius` are bound from the same level and field geometry in `tubeReactionVisuals.ts`; the shader itself remains outside G1 ownership. Its wet predicate has its own `+0.0035` m level allowance (`tubeSilverVolumeMaterial.ts:98`), so literal wet-mask equality between shader and chemistry is not achieved. Removing that allowance requires a shader owner change and optical review.

## Performance

`performance.json` is the final stage-three field measurement at the real LOW (12 x 24 x 12) and HIGH (16 x 32 x 16) quality selections, 20 warm-up plus 200 measured calls each. The local pre-shrink measurement used the same corrected vessel but a 55 mm grid; its values are included as the direct before case. This is a cold host CPU comparison, not the legacy 3.85 mm chemistry field benchmark. `advance` includes chemistry and rendering-array updates; `solver` and `transport` are independently timed calls. Units are milliseconds.

| Quality | Grid height | Active / total cells | Five texture bytes | Advance p50/p95 | Solver p50/p95 | Transport p50/p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LOW, pre-shrink | 55 mm | 792 / 3456 | 110592 | 2.314 / 3.360 | 0.459 / 1.085 | 0.090 / 0.140 |
| LOW, final | 34.814 mm | 1292 / 3456 | 110592 | 2.899 / 3.336 | 0.714 / 0.775 | 0.131 / 0.157 |
| HIGH, pre-shrink | 55 mm | 2000 / 8192 | 262144 | 5.338 / 6.320 | 1.101 / 1.402 | 0.218 / 0.275 |
| HIGH, final | 34.814 mm | 3072 / 8192 | 262144 | 7.050 / 10.306 | 1.759 / 2.939 | 0.343 / 0.468 |

The shortened grid increases vertical resolution without increasing allocated cells or texture memory. At a fixed 2.5 mL level it activates more rows/cells, so it is slower. A prior wave-13 report measured a different solver setup and is not treated as a comparable before case.

## Tests and failures

`node node_modules/typescript/bin/tsc --noEmit` passed. Focused geometry/field/performance tests after the field-height change passed 6/6 across three files, and the added level/delivery checks passed 3/3 afterward. The visual structure tests passed 33/35; two previously timing-sensitive tests exceeded their 5 s limit (5.76 and 6.05 s in the focused run; 5.79 and 6.20 s in the final suite). The final full suite, run before the added three level assertions, had **399 passed, 9 failed and 3 expected failures across 72 files**. A preceding full run before the field-height shrink had 398 passed and 10 failed; shortening the grid resolved the wave12c6 A/C ordering assertion. Both whole-suite runs lasted roughly four minutes.

The final suite's failures were: `wave4a/field` surface 0.002497 versus minimum 0.005; `wave4b/PourStream` expected world y 0.251 but corrected geometry gives 0.218574 = 0.2 + 0.018574; `wave6perf/flocPerf` HIGH golden total mass difference 0.056618; two `tubeReactionVisuals` timeouts; `wave11c3/mixing` first extent 0.018406 versus old golden 0.015250; `wave12c6/mixing` the same old golden; `wave8integration/delivery` an `it.fails` case that now passes; and `lib/tubeAmounts.test.ts` expecting 2.5 mL to fill the 55 mm mesh rather than 18.574/55 = 0.337702. `wave4a`, `wave4b`, and `wave6perf` were already called out as known pre-existing failures in wave 13, but their current measured values reflect the new geometry. Golden chemistry values are geometry-dependent; do not update their expectations without a new accepted calibration. No evidence indicates a mass-accounting regression in the focused conservation tests. Timing failures also existed in wave 13 and remain uncorrected. `tubeBariumField`, `tubeVolumeField` CPU budget and `_g1_motion` did not fail in this full run.

## Integration requests and limits

1. G2 should replace the compatibility imports in `lib/tubePourImpact.ts`, `ui/PourStream.tsx`, `lib/tubeSilverRuntime.ts`, and related solver paths with `tubeVessel`, and check that the stream's transformed surface equals the active field plane for a clamped tube. The needed API is `tubeVessel.heightFromVolume(ml)` and `tubeVessel.innerRadius`; no new radius constant is required.
2. The owner of `lib/tubeAmounts.test.ts` should replace the two old `toBe(1)` expectations at lines 28-29 with `expect(tubeVisualFill(2.5)).toBeCloseTo(tubeVessel.heightFromVolume(2.5) / tubeVessel.cavityHeight, 12)` and the corresponding 3.5 mL expression. The owner of `tests/night/wave4b/PourStream.test.ts` should derive its target as `0.2 + tubeVessel.heightFromVolume(2.5)`; the hardcoded 0.251 is the former display calibration. Other golden tests need fresh accepted chemistry evidence before any value changes.
3. The shader owner should review `tubeSilverVolumeMaterial.ts:98`'s 3.5 mm wet-level allowance and align the volume mask with the field mask if exact liquid-region equality is required. G1 did not touch the shader under the contract.
4. Exact volume-preserving tilted free-surface geometry remains unresolved. The current normalized voxel volume total is canonical, but the plane intercept in the visual, shader, and field is not recalculated from the three-dimensional bowl integral at arbitrary tilt. A change must coordinate all three and the stream impact. The 34.814 mm field extent can clip the high side of a severely tilted 5 mL layer; the 55 mm rendered wall itself does not clip it.
5. No browser capture was available, so only model measurements, numerical slices, shader binding code, and tests support this report. The before and after timings are samples on this host, not a controlled GPU benchmark.

The two full-suite runs rewrote 463 and 397 tracked diagnostic files outside ownership, respectively. `git restore` was blocked by read-only Git index permissions; `tests/night/wave14g1/restore-diagnostics.mjs` restored their `HEAD` content and matched this Windows checkout's CRLF convention. `git status` then showed only G1-owned paths.
