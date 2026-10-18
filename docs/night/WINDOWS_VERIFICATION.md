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
