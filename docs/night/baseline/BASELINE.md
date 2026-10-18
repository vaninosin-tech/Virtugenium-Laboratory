# Temporary stable baseline for experiment 2 (AgNO3 + NaCl)

Cloud session, 2026-10-18. This is a **temporary hand-in baseline, not the final implementation and not a visual acceptance of experiment 2**. Nothing here was looked at in the game: the cloud session has no Windows game rendering and no reference video. The user keeps final visual approval.

## What the baseline is
Stage 3 with the accepted fine suspension and the corrected vessel geometry. The aggregation code (sectional population, floc nodes, sediment curd) is intact and selectable, but off by default.

| Switch | Default now | Before | How to get the other behaviour |
| --- | --- | --- | --- |
| silver stage (`lib/silverStage.ts`) | 3 | 1 | `?silverStage=1` or `window.__silverStage = 1` |
| aggregation (`silverAggregationEnabled()`) | off | on (any value but 0) | `window.__silverAgg = 1` or `?silverAgg=1`; `__silverAgg = 0` still means off |
| section scheme (`SectionalPopulation`) | `legacy` | `legacy` | `window.__silverSectionScheme = 'conservative'` (Task B) |
| `__silverPrimaryRadiusUm`, `__silverStickingScale`, `__silverJetModel`, `__silverSubgrid` | unchanged | unchanged | as before; the jet and subgrid flags stay off |

With aggregation off the field uses `silverAmount = 1.15` (the legacy silver amount of the accepted baseline). A test checks that the default is bit-identical to an explicit `__silverAgg = 0` run and differs from `__silverAgg = 1`.
Without a `window` (plain Node) `silverStage()` still returns 1; the new default applies in the page.
The development viewer `src/lab/experimentLab.ts` keeps its old behaviour (aggregation on except in `?view=cloud`).

## Does the stage change reach other experiments?
Checked by code reading and by tests (`tests/night/baseline/defaults.test.ts`):
- Every `silverStage() === 3` site is gated on NaCl / AgNO3 / the silver-chloride visual (`tubePourImpact`, `tubeAmounts`, `tubeReactionVisuals`, `PourStream`). The only non-gated path is NaCl delivery, and `silverRuntime.canApply` refuses it unless `judgeMix` allows NaCl in that tube. In experiments 1, 3 and 4 NaCl is "foreign", so the runtime refuses it: no field, no volume change, no contents change (tested for all three).
- Experiment 2 still creates the field on the first valid impact (tested).
- NOT verified: the sandbox / free mode (`selectedExperimentId === null`), where `judgeMix` allows any reagent. NaCl poured there into a tube without AgNO3, and NaCl poured first in experiment 2 (wrong order is allowed), now go through the stage-3 runtime instead of the stage-1 path. This was not tested; check it in the game.
- Experiments 1, 3, 4 were not run in the game. Their visuals (`tubeReactionVisuals.ts`) have no stage-3 branch outside the silver-chloride kind.

## Test suite (complete available suite, one process, `--no-file-parallelism`)
| Run | Tests | Passed | Failed |
| --- | ---: | ---: | ---: |
| Before any change (branch as handed over) | 485 | 483 | 2 |
| After the baseline change, before test setups were adjusted | 492 | 486 | 6 |
| Final (this commit set) | 502 | 500 | 2 |

**Existing failures (present before the change, unchanged, expectations not edited):**
- `tests/night/wave4a/field.test.ts`: surface raft 0.0024971 against minimum 0.005.
- `tests/night/wave6perf/flocPerf.test.ts`: HIGH golden total, 0.2111380784 against 1e-12 (identical value before and after).

**Failures introduced by the default change, then resolved (4 files):** these tests relied on the old implicit defaults.
- `stage1/density.test.ts` asserted that the page default is stage 1. Expectation updated on purpose: the page default is now 3 (no window still gives 1).
- `wave18f3/sectional.test.ts`, `wave3flocs/flocSystem.test.ts`, `wave6perf/flocPerf.test.ts` (setup only), and `wave19s2/audit.test.ts` (it already declared `__silverAgg: 1` on the stubbed window, which the old code never read from there): these exercise aggregation; their window stubs now ask for `__silverAgg: 1`. `silverAggregationEnabled()` reads `window.__silverAgg` first, then `globalThis.__silverAgg`.

**Newly introduced failures after the final change: none.** New tests: `tests/night/baseline/defaults.test.ts` (8), `tests/night/taskB/sectionalValidation.test.ts` (8), `tests/night/taskA/surfaceProfile.test.ts` (1).
Running the suite rewrites tracked diagnostic files under `docs/night/...`; they were restored with `git checkout -- docs tests/_*`.

## Not done / not verified
- No visual check of anything. No game run, no video, no FPS measurement.
- The five-test visual regression of experiments 1, 3, 4 and a final pour recording (priority 2 of the handoff) were not run.
- Sandbox and wrong-order NaCl paths (above).

## Continue in the Windows environment
1. `git fetch` this branch (`claude/epic-brown-yxujey`), do not merge into `main`.
2. `node node_modules/typescript/bin/tsc --noEmit`, then the suite as in `docs/HANDOFF_CLAUDE_CLOUD.md` section 3.
3. Browser scripts, in order: `tests/_wave11/validateShaders.mjs`, `tests/_wave15/captureExperiments.mjs` (experiments 1, 3, 4: this branch on 5201 against commit `76f7350` on 5202), `tests/_wave15/baselineRecord.mjs` (pour recording). Compare stages, not times.
4. Decide on the sandbox / wrong-order behaviour noted above; if it matters, gate the stage-3 delivery on the target containing AgNO3 (`tubePourImpact.ts`, `stage3`).
5. Task A and Task B: see `docs/night/taskA/REPORT.md` and `docs/night/taskB/REPORT.md`.
