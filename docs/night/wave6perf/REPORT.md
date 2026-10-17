# Wave 6 floc performance

## Method

`tests/night/wave6perf/flocPerf.test.ts` advances stage 3 for 280 steps of 0.05 s at LOW and HIGH. Delivery ramps to one portion over the first 3 s; the jet is off for the remaining 11 s. Times use `performance.now()` around each `TubeSilverField.advance` call, with the mean and nearest-rank p95 of 280 samples. The initial implementation was measured before editing `flocSystem.ts`. Measurements vary with concurrent work on this machine; the numbers below are the recorded runs, not a claim of isolated CPU conditions. No browser or visual evaluation was available.

| Quality | Before mean | Before p95 | After mean | After p95 |
| --- | ---: | ---: | ---: | ---: |
| LOW | 110.8 ms | 197.6 ms | 88.3 ms | 176.1 ms |
| HIGH | 343.3 ms | 582.7 ms | 185.9 ms | 286.2 ms |

The HIGH mean improved by about 46%, but the 25 ms target was not reached.

## Changes and behavior

- A uniform 3D grid with cell width `linkRange` narrows merge, separation, and new-node searches. A matching 2D column grid narrows compaction's horizontal search. Candidate indices are sorted to preserve the original pair order. The grid is rebuilt after motion and after constraint sweeps so later `addMass` calls see current positions; merges also refresh it when they change indices.
- Node indices replace repeated `nodes.indexOf`. Radius and compaction load storage are reused. Raster splats use a method instead of a per-call closure. The fixed compaction storage retains the original resize and reset behavior, including zero compaction for a newly added node.
- The HIGH reference result, captured before editing, was total solid mass `0.541659166404985`, 259 nodes, median height `0.005313219702339795` m, and mean position `(0.00003572888030355774, 0.008237669009417877, -0.0010756035481744868)` m. The final run matched all of these exactly, exceeding the required tolerances. LOW also matched its baseline exactly. Worst absolute mass balance error was `2.45e-14` at HIGH and `8.88e-15` at LOW; node state was finite.

## Remaining cost and integration request

A manual timing pass over the first 4 s at HIGH measured 17.08 s in `advance`, including 11.87 s in `FlocSystem.addMass`, 1.35 s in `step`, 0.54 s in `rasterize`, and 0.04 s in `erode`. After indexing `addMass`, a repeat measured 9.73 s in `advance`, including 4.42 s in `addMass`, 1.36 s in `step`, 0.50 s in `rasterize`, and 0.03 s in `erode`. The other `advance` work alone was about 3.42 s / 80 steps, or 42.8 ms per step in that sample. The first 4 s profile is separate from the full 14 s timing run.

The coordinator owns `tubeSilverField.ts` and `tubeFlowSolver.ts`. Reaching 25 ms requires profiling and optimizing the remaining work there, including the field update and fine-solid transfer loop that calls `addMass`; this worker cannot edit those paths. The floc indexing improvement alone cannot meet the target while the other work exceeds it.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: clean.
- `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/night/wave6perf/flocPerf.test.ts -t '3 s pour'`: 2 passed, 1 skipped after the compaction correction.
- An earlier combined run of the new file and `tests/night/wave3flocs/flocSystem.test.ts` had 8 passed, 1 failed because the first fixed-size compaction version reset state after a merge; this was corrected and the 14 s cases rerun successfully.
- Full suite (`node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism`): 321 passed, 9 failed, 2 expected failures across 52 files. The new `wave6perf` and existing `wave3flocs` files passed. The nine failures were one CPU budget threshold in `tubeVolumeField.test.ts`, five timeouts, and three stage-1/wave-4 numerical assertions. None of those tests exercises this worker's stage-3 floc changes. The failed paths are outside this worker's ownership.
- Timed-out files rerun individually: `tubeReactionVisuals.test.ts` 29 passed / 2 timed out; `_g1_motion.test.ts` 1 timed out; `tubeBariumField.test.ts` 9 passed; `tubeVolumeField.test.ts` 13 passed. The last two timeouts did not recur alone. The two rendering timeouts and the motion timeout did recur.

`measurements.jsonl` and `profile.jsonl` contain raw results from the iterations, including the failed intermediate compaction version. The final two measurement rows are the verified after values above.
