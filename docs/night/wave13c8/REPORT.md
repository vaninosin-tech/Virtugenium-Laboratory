# Wave 13 C8 diagnostics

## Artifacts and limits

`tests/_wave13/recordRun.mjs` enters the real laboratory, pours AgNO3 and then NaCl with `runStandAction`, and samples the app simulation clock at requested 50 ms intervals through 14 s. Each sample stores the actual simulation timestamp, delivery diagnostics and event IDs, stream debug geometry, source and receiving volumes, dissolved and product totals, wet surface level, and solver time. Ten full 3D dumps at 0.5, 1, 1.5, 2, 3, 4.5, 6, 9, 12 and 14 s contain mask, tracer, Ag+, Cl-, local product source, fine suspension and cell-centered solver flow. An additional `firstSource` full snapshot catches the earliest sampled product source. `*-run.json` contains `samples` and `dumps`; dump entries add `structure` and five `processes` groups. `DIAG=tracer` selects passive tracer mode. Requested grid times and actual `sim` values are separate because ticks can cross a grid boundary between browser frames.

`analysis.mjs` computes wet-cell variance, coefficient of variation, gradients, occupied fraction, 26-connected 10% and 50% of p95 iso-regions, surface-to-volume ratio, profiles, Gini and p90/p10. A uniform wet field has CV and Gini zero and p90/p10 one. The process groups distinguish tracer and downward-flow penetration, an inward-flow estimate and tracer dilution, a dissolved-reactant interface proxy, local source and contact consumption, and suspension centroid and moments. Product displacement is measured independently of source. Face flux and exact interfacial reactant flux are **proxies** because the staggered face arrays are private; only `solver.flow` cell velocities are public. The lowest two rows' radial speed, vertical sign changes and a circulation proxy are included. The field's `liquidLevel` is read from the live JavaScript instance and the wet mask is dumped.

`captureOpticsMatrix13.mjs` captures all four optics modes over black, neutral gray and laboratory backgrounds at configurable `TIMES`, with one paused simulation state per timestamp. `NAME` is in every PNG filename. `*-optics.json` records crop, frozen timestamp, uniforms and luminance measures. The numeric liquid region is a fixed central 50% by lower 70% rectangle within the tube crop, so it includes glass and may include some background; the background reference is the crop's upper-left 10% patch. These are comparable geometric proxies, not segmented liquid pixels. Coefficients are recorded at each capture and must be compared across manifests before drawing an optical conclusion. The script never changes opacity or coefficients.

`measureFpsPour.mjs` runs at least three fresh real-game pours with the cloud on and three with it off for each `INIT` configuration. The window is one wall-clock second before through eight seconds after the NaCl click. Each run writes raw frame intervals, per-step `field.advance` and `solver.lastStepMs` time, and available GPU timer query measurements around the whole Three render call. The summary gives median and 10th-percentile FPS, peak frame time, counts above 50 and 100 ms, solver and non-solver advance costs. Non-solver advance cost is the difference between the measured `advance` wrapper and `lastStepMs`; it includes chemistry, scalar transport and field maintenance, not just reagent transport. The first synchronous `advance` inside `applyDelivery` happens before the field is published and cannot be wrapped from this script. GPU queries are omitted when the extension or valid results are absent. There are no overlays or pixel reads in the measured window. Compare FPS cost with `structure` in the corresponding run before judging a flag.

`regressionAB.mjs` records a live run or reads `TRACE=<path>` for an earlier `_trace.mjs` file. It writes `*-regression.json` with failures and unavailable checks and exits nonzero for failures. Live runs require all checks; older traces report checks for which that format lacks source volume, full fields or stream geometry as unavailable. Checks cover impact timing and geometry, event ID uniqueness, delivered and source/receiver volumes, pre-impact absence, chloride onset and location, reagent conservation at every sample, and source overlap. The post-reaction source overlap check reconstructs available pre-reaction reagent as remaining reagent plus local stoichiometric product source; an exact pre-reaction cell snapshot would be stronger.

## Coordinator commands

Start the development server on port 5201 in one PowerShell terminal:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort
```

In another terminal, run each configuration separately. Use a writable `OUT` under this worker's capture directory:

```powershell
$env:OUT='docs/night/wave13c8/captures'
$env:NAME='baseline'; $env:INIT=''
node tests/_wave13/recordRun.mjs
$env:DIAG='tracer'; $env:NAME='baseline-tracer'; node tests/_wave13/recordRun.mjs; Remove-Item Env:DIAG
$env:NAME='baseline'; node tests/_wave13/captureOpticsMatrix13.mjs
node tests/_wave13/measureFpsPour.mjs
node tests/_wave13/regressionAB.mjs

$env:NAME='jet'; $env:INIT='window.__silverJetModel=true;'
node tests/_wave13/recordRun.mjs
$env:DIAG='tracer'; $env:NAME='jet-tracer'; node tests/_wave13/recordRun.mjs; Remove-Item Env:DIAG
$env:NAME='jet'; node tests/_wave13/captureOpticsMatrix13.mjs
node tests/_wave13/measureFpsPour.mjs
node tests/_wave13/regressionAB.mjs

$env:NAME='jet-subgrid'; $env:INIT='window.__silverJetModel=true;window.__silverSubgrid=true;'
node tests/_wave13/recordRun.mjs
$env:DIAG='tracer'; $env:NAME='jet-subgrid-tracer'; node tests/_wave13/recordRun.mjs; Remove-Item Env:DIAG
$env:NAME='jet-subgrid'; node tests/_wave13/captureOpticsMatrix13.mjs
node tests/_wave13/measureFpsPour.mjs
node tests/_wave13/regressionAB.mjs
```

Optional: `$env:TIMES='500,1000,3000,9000,14000'` for the optical matrix, `$env:RUNS='5'` for more performance repetitions, or `$env:TRACE='D:/Claude/virtugenium-night/frames/<run>/trace.json'; node tests/_wave13/regressionAB.mjs` for an offline prior trace. Clear `TRACE` before a live regression.

## Integration requests

1. Add a read-only `TubeFlowSolver.faceVelocity(axis, x, y, z)` or typed-array snapshot accessor with the existing staggered face convention and wet-face validity. This is required for exact inward jet-column volume flux, face-resolved penetration and circulation, and Ag+/Cl- advective flux through an interface. Cell-centered `flow` only supports estimates.
2. Expose `TubeSilverField` transport-step time separately from total `advance` time, or provide a dev-only timing callback. The present performance harness can report only the non-solver difference.
3. Publish the first pre-reaction Ag+/Cl- cell arrays with the first valid insertion if a strict first-source overlap proof is needed. The first synchronous step precedes the runtime's public field handle.

No production files were changed. The browser, WebGL, GPU, PNG captures, real-game regression and FPS measurements were unavailable in this worker and were not executed. Syntax, pure-library tests and offline checks against saved traces were run locally.

## Local verification

`tsc --noEmit` passed, and the focused C8 test had 6 passed, 0 failed. The final whole suite had **392 passed, 6 failed, 4 expected failures** across 69 files; its output is `full-suite.log`. Three failures were the known `wave4a`, `wave4b`, and `wave6perf` assertions. Two `tubeReactionVisuals` tests timed out at five seconds and `_g1_motion` timed out at 30 seconds. Rerun alone, rendering had 33 passed / 2 timed out, and motion had 1 timed out. These are unresolved timing failures; C8 changed no production path involved. All new `.mjs` files passed `node --check`. The offline regression command passed on `frames/a2/trace.json` (1,295 trace records) and `frames/w12D/trace.json` (6,886 trace records and six rounded full dumps), with unavailable checks explicitly listed in `offline-check/*.json`. Those old files lack source and receiver volumes, local impact coordinates and exact silver totals, so their passing result does not prove those checks. The full suite regenerated 23 tracked diagnostic files outside C8 ownership; they were restored from `HEAD` with the worktree's CRLF conversion after `git restore` was blocked by the read-only Git index. `git diff --exit-code` on those generated paths then passed, leaving only C8-owned additions.
