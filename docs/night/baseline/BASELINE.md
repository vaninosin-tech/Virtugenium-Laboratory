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

## Does the stage change reach other experiments? (re-checked)
`tests/night/baseline/isolation.test.ts`, run with no stage override (the browser default):
- **Rule now enforced:** stage 3 claims chloride only when the receiving tube really holds silver nitrate (`silverRuntime.acceptsChloride`: an active field or `agno3` in the tube contents with liquid in it) and a chloride delivery event arrives for that same tube. Otherwise the chloride takes the plain amount-ledger path: no Ag+ is created and no field starts. Before this change a chloride delivery into any tube whose mixing rules allowed it would go to the stage-3 runtime (and was refused or, in tubes without the same reagent, could start a field without silver nitrate). Two tests fail without the change.
- Experiment 2, AgNO3 first, NaCl poured after: field starts (as before).
- Experiment 2, NaCl in the tube first, AgNO3 added after: no stage-3 field, both amounts kept in the ledger (legacy path). The silver-chloride cloud for this wrong order is then **not** drawn by stage 3 (the stage-3 visual is driven only by the runtime field); the old stage-1 cloud for it is not reached from the stage-3 default. Check in the game; this is a consequence of the rule, not verified visually.
- Free sandbox, NaCl alone: no field, no Ag+. NaCl into an empty tube: refused (no liquid). Sandbox, AgNO3 first and NaCl delivered: field starts. Sandbox tube pre-filled with both reagents: chloride is not seeded (by the stage-3 design), nothing is invented.
- Experiments 1, 3 and 4: chloride delivery leaves contents and amounts untouched, no field.
- Explicit overrides `?silverStage=1` and `window.__silverStage = 1` keep the legacy path.
- Browser and Node defaults differ on purpose: without a `window` (plain Node, SSR, unit tests that do not stub one) `silverStage()` returns 1, so older tests keep their meaning; in the page the default is 3. Tests that need a mode select it explicitly (`window.__silverStage`, `?silverStage=`), and `defaults.test.ts` and `isolation.test.ts` stub a window without an override to exercise the browser default.

## Test suite (complete available suite, one process, `--no-file-parallelism`)
| Run | Tests | Passed | Failed |
| --- | ---: | ---: | ---: |
| Before any change (branch as handed over) | 485 | 483 | 2 |
| After the baseline change, before test setups were adjusted | 492 | 486 | 6 |
| After the first baseline commit | 502 | 500 | 2 |
| After the isolation rule, Task A diagnostics and Task B part 2 | 520 | 518 | 2 |

**Existing failures (present before the change, unchanged, expectations not edited):**
- `tests/night/wave4a/field.test.ts`: surface raft 0.0024971 against minimum 0.005.
- `tests/night/wave6perf/flocPerf.test.ts`: HIGH golden total, 0.2111380784 against 1e-12 (identical value before and after).

**Failures introduced by the default change, then resolved (4 files):** these tests relied on the old implicit defaults.
- `stage1/density.test.ts` asserted that the page default is stage 1. Expectation updated on purpose: the page default is now 3 (no window still gives 1).
- `wave18f3/sectional.test.ts`, `wave3flocs/flocSystem.test.ts`, `wave6perf/flocPerf.test.ts` (setup only), and `wave19s2/audit.test.ts` (it already declared `__silverAgg: 1` on the stubbed window, which the old code never read from there): these exercise aggregation; their window stubs now ask for `__silverAgg: 1`. `silverAggregationEnabled()` reads `window.__silverAgg` first, then `globalThis.__silverAgg`.

**Newly introduced failures after the final change: none** (one intermediate failure, `wave8delivery` "rejects the permissive legacy publisher for stage-three chloride", appeared when the isolation rule was added: its tube was only seeded in the amount ledger, not present in the contents store. The test setup now puts `agno3` into the tube store; its assertions are unchanged). New tests: `tests/night/baseline/defaults.test.ts` (8), `tests/night/taskB/sectionalValidation.test.ts` (8), `tests/night/taskA/surfaceProfile.test.ts` (1).
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
