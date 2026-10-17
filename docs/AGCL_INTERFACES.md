# AgCl wave 2 interface contract (experiment 2, AgNO3 + NaCl)

Base: main 7cfa1ca plus the reviewed night-1 branches merged (isolated prototype `lib/night/agcl/AgclPrototype.ts`, fluid diagnostics `lib/night/fluid/`, render helpers `lib/night/render/silverOptics.ts`). `lib/` means `src/scenes/laboratory/lib/`. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`. Tests: `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism <paths>`.

Goal of this wave: make experiment 2 look and behave like the real AgCl precipitation, in the real game code, driven by real transport, with exact mass accounting. Reference description: `docs/realism/agcl-baso4-full-physics-tasks.md` (tasks 56, 58, 60, 61), `docs/realism/microphysics-supplement.md`, `docs/realism/local-reaction-onset.md`, `docs/realism/game-rules-amounts.md`.

## Project rules that must not break
Free movement of bottles; automatic bottle positioning on pour stays; pour is one click = fixed 1.0 ml portion; no pouring out; heating is optional and not required for precipitation; experiments 1, 3 and 4 must behave exactly as before (do not touch their code paths, tests must stay green); no baked animation or time-line: everything follows from transport, concentrations, shear and gravity.

## Data contract between the two workers (additive-only)
`TubeSilverField` (`lib/tubeSilverField.ts`) is the producer; the renderer is the consumer. Existing public members keep names, types and meaning: `species`, `suspension[3]`, `coarse`, `flocs: FlocAggregate[]`, `sedimentField`, `pixels`, `texture`, `advance(...)`, `diagnostics()`, `extent`, `delivered`. New data may be ADDED (new optional fields on `FlocAggregate`, new arrays, new texture channels) but nothing may be renamed, removed or re-purposed, so both workers can merge. `SilverSedimentField` keeps `values`, `deposit`, `release`, `settle`, `mass`, `compaction`.

## Fixed shared facts (read-only)
- Grid: `LiquidMask` + `TubeFlowSolver` (`lib/tubeVolumeField.ts`, `lib/tubeFlowSolver.ts`); SI units, fixed step `TUBE_SIMULATION.field.stepSeconds` = 1/20 s; tube radius about 0.007 m, liquid height about 0.055 m.
- Pour channel `lib/tubePourImpact.ts`, amounts `lib/tubeAmounts.ts`, levels `lib/tubeLiquidLevel.ts`: read-only.
- Mass rule: solid AgCl = suspension classes + coarse + flocs + sediment, equal to the reagent consumed; `diagnostics().massBalanceError` stays near zero at all times, including after tilting/shaking the tube.

## Ownership
- `agcl2` owns: `lib/tubeSilverField.ts`, `lib/tubeSilverField.test.ts`, `lib/tubePrecipitationPhysics.ts` (ADD new functions only; existing exports keep behaviour and signatures because `tubeBariumField.ts` uses them) and its test, the class `SilverSedimentField` in `lib/tubeSilverSediment.ts`, `lib/night/agcl/`, `tests/night/agcl2/`, `docs/night/agcl2/`.
- `render2` owns: `lib/tubeSilverVolumeMaterial.ts`, the class `SilverSedimentGeometry` in `lib/tubeSilverSediment.ts`, `lib/night/render/`, `tests/night/render2/`, `docs/night/render2/`, and ONLY the silver/AgCl code paths inside `lib/tubeReactionVisuals.ts` and `lib/tubeLiquidMaterial.ts` (smallest possible hunks, guarded by the experiment-2 condition; experiments 1, 3, 4 must render pixel-identically).
- Nobody edits: `lib/tubeFlowSolver.ts`, `lib/tubeFlowDebug.ts`, `lib/tubeLiquidLevel.ts`, `lib/tubeAmounts.ts`, `lib/tubeReactions.ts`, `lib/tubePourImpact.ts`, `lib/tubeVolumeField.ts`, `lib/tubeSimulationConfig.ts` except the `silver` block, `lib/tubeBarium*.ts`, `lib/tubePermanganate*.ts`, `lib/tubeNOBubbles.ts`, all UI and stores, `package.json`, lockfile, `lib/night/fluid/`. If a change there is truly required, describe it as an integration request with the exact diff in your report and work around it.
- A worker that needs the other's output must not wait or guess: code against the data contract above.

## WAVE 3 OVERRIDE (supersedes the ownership list above)
One worker, `stage1`, owns everything listed under its job in `tools/codex-team/tasks.json` (silver field, silver material, silver visuals hunks, `lib/silverStage.ts`, `lib/night/stage1/`, `tests/night/stage1/`, `docs/night/stage1/`, and the silver parts of `tests/tubeReactionVisuals.test.ts`). The previous wave-2 render/physics branches were REJECTED by the customer and are NOT part of this base. Its task file `tools/codex-team/tasks/21-stage1.md` is authoritative.

## WAVE 4 OVERRIDE (supersedes wave 3)
Two workers run in parallel on disjoint files. The coordinator owns `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`; do NOT touch it.
- `fieldA` owns: `lib/tubeSilverField.ts` and its test, `lib/tubeFlowSolver.ts` (optional-parameter additions only, defaults must not change behaviour for experiments 1, 3, 4) and its test, `lib/silverStage.ts`, `lib/night/stage1/`, `tests/night/stage1/`, `tests/night/wave4a/`, `docs/night/wave4a/`, `docs/night/stage1/`.
- `pourB` owns: `src/scenes/laboratory/ui/PourStream.tsx`, `lib/tubeReactionVisuals.ts` (ONLY the pour stream, render order and stage-1 silver hunks), `tests/tubeReactionVisuals.test.ts`, `tests/night/wave4b/`, `docs/night/wave4b/`.
Customer reference video frames: D:/Claude/virtugenium-night/wave3/docs/reference/agcl/ (ref-NN.png one per second, sheet.png). Current game frames of this branch: D:/Claude/virtugenium-night/frames/s19/sheet.png (left to right 0.2, 0.5, 1, 1.5, 2.5, 4, 7, 12 s after the first precipitate forms). Do not copy them into the repo.

## WAVE 6 OVERRIDE (supersedes wave 5)
Three workers on disjoint files. `perf` owns only `src/scenes/laboratory/lib/night/stage1/flocSystem.ts`, `tests/night/wave6perf/`, `docs/night/wave6perf/`. `game` owns only `src/scenes/laboratory/lib/tubeReactionVisuals.ts`, `tests/tubeReactionVisuals.test.ts`, `tests/night/wave6game/`, `docs/night/wave6game/`. `tests` owns only `tests/night/wave6tests/`, `docs/night/wave6tests/` and cleanup edits inside `tests/night/wave4a/` and `tests/night/stage1/`. The coordinator owns `tubeSilverField.ts`, `tubeSilverVolumeMaterial.ts`, `tubeFlowSolver.ts`, `src/lab/` and the stand; nobody else edits them, and the coordinator will not edit `flocSystem.ts` while `perf` runs.

## WAVE 7 OVERRIDE (supersedes wave 6)
Two Codex agents at most. `pour` owns only `src/scenes/laboratory/ui/PourStream.tsx`, `src/scenes/laboratory/lib/tubePourImpact.ts` (+ test), `tests/night/wave7pour/`, `docs/night/wave7pour/`. `reagents` owns only `tests/night/wave7reagents/`, `docs/night/wave7reagents/`. The coordinator owns `tubeSilverField.ts`, `tubeSilverVolumeMaterial.ts`, `tubeFlowSolver.ts`, `tubeReactionVisuals.ts`, `src/lab/`, the stand and `flocSystem.ts`.
