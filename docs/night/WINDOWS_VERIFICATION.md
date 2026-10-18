# Verification still to do in the Windows game (nothing here was seen in the cloud session)

The cloud session produced CPU diagnostics and tests only. The user retains final visual approval. Preserve the baseline (stage 3, aggregation off); do not merge into `main`.

## 1. Isolation (priority 0)
In the game, with no flags: experiment 2 (AgNO3 in the tube, then NaCl), experiment 2 wrong order (NaCl first, then AgNO3: expect no stage-3 cloud, see `docs/night/baseline/BASELINE.md`; decide whether that case needs a stage-1 style cloud), free sandbox with NaCl alone, with both reagents, and experiments 1, 3, 4 (compare against commit `76f7350` on port 5202 with `tests/_wave15/captureExperiments.mjs`).

## 2. Task A: confirm the cause with the renderer
Findings to confirm (`docs/night/taskA/REPORT.md`): the empty top is a chemical-overlap effect (Ag+ absent in the layer added by the pour), not a rendering or grid-gap effect.
- Record the pour on the black background: `window.__diag.setBackground("black")`, then `setOpticsMode` 1, 2, 3 (raw, extinction, scattering), `__diag.pauseSimulation()` for stills, `window.__diagCamera` for the side view. Frame times must come from in-page records (`performance.timeOrigin + performance.now()` against the screencast epoch), never frame numbers.
- With `window.__silverRuntime.field(tubeId)` read the same rows as `tests/night/taskA/depthDiagnostics.test.ts` and compare with the CPU tables (Ag+ in the top rows, formation by absolute height).
- Check the rendered top half-cell (`wet()` in `lib/tubeSilverVolumeMaterial.ts` accepts +3.5 mm above the level; textures clamp to the edge).
- Only after that decide the fix (plunging-jet entrainment with a justified penetration depth). Compare visual **stages**, never times; the reference vessel is wider.

## 3. Task B: before changing any default
`window.__silverAgg = 1; window.__silverSectionScheme = 'conservative'; window.__silverSectionBins = 52;` then `tests/_wave16/validateAggregates.mjs` and a pour recording; compare with the 13-section legacy run. Check frame cost (the CPU model needs about 7 ms LOW / 17 ms HIGH per step for the collisions at 52 sections, advection and rendering extra).

## 4. Synchronized images and one continuous video (user's list)
Use `tests/_wave15/baselineRecord.mjs` (continuous recording) and `tests/_wave15/buildComparison.mjs` (stage-matched panels with the reference). Stages to show: pouring and surface impact; early AgCl formation; near-surface cloud development; connected dense white regions; downward-moving structures; progressive milkiness; later aggregation and sediment (aggregation on, flags above). Report the reference's x1/x5/x50 playback changes as stage labels.

## 5. Physical stream (experimental, `window.__silverStream = true`; see `docs/night/stream/REPORT.md`)
The flag is off by default. Keep aggregation off and `__silverSubgrid` off. Run everything twice, with and without the flag, from the same build.
1. **Measured input.** After a pour, read `window.__silverRuntime.field(tubeId).streamModel` (`state`: `source` must say `measured`, `impactSpeed`, `impactRadius`, `momentumFlux`, `fall`; `penetration`, `entrainedFlow`, `endSpeed`, `stations`). If `source` is `reconstructed` the lip sample was missing for that step (`samplePourOutlet` in `PourStream.tsx`): fix that first, because the lip height is the one unmeasured input.
2. **FPS and step cost.** `NAME=baseline node tests/_wave13/measureFpsPour.mjs` and `NAME=stream INIT="window.__silverStream=true" node tests/_wave13/measureFpsPour.mjs`: median and 10th-percentile FPS, worst frame, solver time. The cloud CPU numbers (median step 18 ms against 7 ms, solver 5.9 ms, projection 5.1 ms) apply only while the stream is active.
3. **Recording.** `INIT="window.__silverStream=true" node tests/_wave15/baselineRecord.mjs` (continuous recording from before the pour to the late suspension) and `tests/_wave15/buildComparison.mjs` against the reference at corresponding stages. Look at: the impact point; the depth where AgCl first appears (the model predicts the jet path and the bowl, not the surface); any near-surface white; irregularity and motion; the transparent regions; gradual milkiness. Compare the fine-suspension field with the render at the same positions (`window.__diag.setBackground("black")`, `setOpticsMode`), with no surface film and no decorative particles.
4. **Decision for the user.** If the reference shows a near-surface cloud that develops over seconds, the cloud result suggests the delivered stream (pour rate and speed) is stronger than the real one; that is the authoritative pour envelope (`pouredMl`, `POUR_MS`), which this work did not change.

## 6. Pouring-input trace and the corrected stream (review iteration; see `docs/night/stream/REPORT.md` section 10)
1. **Trace (priority 1, nothing else first):** `NAME=baseline node tests/_stream/tracePourInputs.mjs`, then the same with `INIT="window.__silverStream={surfaceRise:true};window.__silverStreamCoupling=8;" NAME=corrected`. Output in `docs/night/stream/captures/`. Check: the scenario line (`agnoMl` must be 1, standard pour 1 mL), `measuredShare` (1 means every valid event had a measured lip), the used fall against the reconstructed one, the peak flow and the pour duration. Rows with source `reconstructed` are not measurements. The recorder only reads state; it does not change the pour.
2. **Compare three runs** on the same scenario (1 mL + 1 mL, no `agnoMl`): baseline, `window.__silverStream = true` (as built), and the corrected configuration above; keep aggregation off. Record from before the pour to the late suspension; compare stage by stage (initial contact, first visible white, dense cloud during the pour, deformation after the pour, later milkiness), never by playback time.
3. **FPS:** `NAME=corrected INIT="window.__silverStream={surfaceRise:true};window.__silverStreamCoupling=8;" node tests/_wave13/measureFpsPour.mjs` against `NAME=baseline`.

## 7. One command for the final gate (A baseline, B corrected stream, C legacy jet)
`node tests/_stream/runGate.mjs` (dev server running from the branch copy). It runs the pouring-input trace, the FPS / worst-frame measurement and the continuous recording for each configuration with the same delivery and camera, and writes `docs/night/stream/gate/gate_run.json`. Details: `docs/night/stream/REPORT.md` section 11.4.
