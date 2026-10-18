# Wave 16 F1: conserved AgCl aggregation

## Model and interface

Stage 3 retains local AgCl formation and the accepted fine transport. By default (`__silverAgg` absent or nonzero), a local concentration-squared collision law transfers mass from `suspension[0]` to cohesive `FlocSystem` nodes. Setting `__silverAgg = 0` stops new aggregation and reproduces the accepted fine-only replay. Existing aggregate mass remains conserved if the switch is changed mid-run. `__silverBreak = 1` enables link failure after force-driven stretch; it remains off by default because no browser replay has yet established a safe breakup threshold. `__silverJetModel` and `__silverSubgrid` remain off by default.

Nodes move with sampled resolved velocity plus a size-dependent drag/buoyancy slip. Load compacts linked nodes. Relative motion erodes mass back to the fine field. Floor-contact nodes release mass at their drag-limited slip rate into `SilverSedimentField`; the deposit slumps only down a local load gradient and compacts under deposited load. No transfer is triggered by age. The transfer ledger is `suspension[0..2] + coarse + nodes + pending + sediment = extent`.

The added `aggregateTexture` is RGBA FloatType at the carrier grid resolution. R is rasterized node mass times active cell count, G is mass-weighted `1 - solidFraction`, B is mass-weighted node compaction, and A is zero because no orientation tensor is computed. `denseTexture` retains its established visual bridge and tuft data. `sedimentHeightTexture` is RedFormat FloatType, nx by nz, metres above the local bowl floor, computed from `sedimentField.values`. `dumpAggregateState()` returns JSON-compatible mask, fine, aggregate RGBA, sediment height and mass arrays, plus masses by state. Eight real-pour dumps and numeric PPMs are in `docs/night/wave16shared/`.

## Constants and scale

- `FLOC_AGGREGATION = 14 s^-1`, `FLOC_C0 = 0.25` in per-active-cell normalized concentration: inherited collision calibration. Transfer fraction per step is `min(0.6, 14 c²/(c+0.25) dt)`. It is concentration-squared when dilute, then bounded under concentrated contact. `FLOC_MIN_PARCEL = 5e-6` prevents tiny nodes; mass stays fine until a cell can supply a parcel. These values have not been fitted against the 7 mm reference frames.
- `Df = 1.9`, base solid fraction `3e-5`, `Cd = 1.1`, AgCl density `5560 kg/m³`, liquid density `1000 kg/m³`, node relaxation `0.12 s`, and 260 maximum nodes are inherited from the cohesive floc system. `slipSpeed` uses buoyancy and drag with solid fraction proportional to radius^(Df-3). The effective solid fraction is a hydrodynamic closure, not the deposit packing porosity.
- The remaining inherited node constants are quantum mass `.03`, quantum radius `2.1 mm`, link range `3.4 mm`, three links per node, eddy diffusivity `6e-6 m²/s`, erosion rate `.3 s^-1` at `3 mm/s` relative speed, compaction load `.05` normalized mass with rate `.9 s^-1` and slip factor `2.5`, contact overlap ratio `.75`, link stiffness `.35`, yield stretch `1.25` with plastic share `.5`, and break stretch `2.4`. These are numerical cohesive-floc closures from stage 1, not measured AgCl material constants; this wave did not independently recalibrate them against the corrected geometry.
- The one deposit conversion is `SILVER_SEDIMENT_BULK_M3_PER_UNIT = 0.14332/5.56/0.1 × 1e-6 = 2.5777e-7 m³` per normalized AgCl unit. This assumes the game's 1 mL NaCl portion represents 1 M, giving 0.001 mol and 0.14332 g AgCl, solid density 5.56 g/mL, and 90% void in loose curd. The game defines normalized amounts rather than a laboratory molarity, so the height has at least proportional molarity and porosity uncertainty. Mass is never scaled by this constant.
- `settleCurd` moves at most `0.15 dt` of a column's load excess above a neighbouring column if its load exceeds 1.8 times that neighbour; this is a local slope closure, not an age clock. Deposit compaction rises with local deposited load at `0.1 s^-1` maximum. The height texture currently uses the loose bulk conversion and does not shrink as compaction grows, a known limitation.

## Deterministic replay

The LOW real-pour replay follows the wave 11 delivery schedule, with a rising 1 to 2 mL level and a wall-adjacent inlet at 6.5 mm. Units below are normalized AgCl. All sampled times and complete arrays are in `wave16shared/mass-state.json` and `state_*s.json`.

| s | formed | fine | aggregate | sediment | nodes |
|---:|---:|---:|---:|---:|---:|
| 1 | .171958 | .035550 | .124471 | .011937 | 11 |
| 2 | .333585 | .058708 | .232381 | .042497 | 20 |
| 3 | .467517 | .084313 | .314711 | .068494 | 34 |
| 4.5 | .627493 | .112890 | .351676 | .162927 | 57 |
| 6 | .744317 | .131109 | .343685 | .269523 | 82 |
| 9 | .880770 | .154524 | .279387 | .446859 | 144 |
| 12 | .946791 | .170113 | .210654 | .566024 | 197 |
| 14 | .971115 | .177987 | .155532 | .637595 | 229 |

Worst stepwise mass error was `1.97e-14`, with nonnegative fine cells and no NaN in the checked arrays. The largest deposit height above its bowl column at 14 s was 4.29 mm. The loose bulk volume of deposited mass is about 0.164 mL, roughly 8.2% of the final 2 mL liquid volume. A wider reference vessel should be judged by this volume fraction and physical settling behaviour, not the pixel height of the game's narrow tube. No browser comparison was available.

The replay rows also include cumulative fine-to-aggregate transfer (which can exceed net formed mass because eroded mass may reaggregate), node-mass and radius histograms, mean node height, and mean drag slip. At 14 s the mass bins `<.001/.001-.005/.005-.02/>=.02` contain `183/44/1/1` nodes. Mean slip is `2.68 mm/s`. A separate 0.5 s control using a velocity snapshot from the real pour moved seven nodes by a mean `0.753 mm` relative to the same nodes in a motionless carrier; their end-to-end span was `5.58 mm` versus `6.22 mm`. This establishes flow coupling in that snapshot, not a full no-flow experiment replay.

LOW on/off CPU per 50 ms step was p50 `12.2/2.72 ms`, p95 `33.1/7.75 ms`, peak `60.2/25.2 ms` in this run. HIGH on/off through 6 s was p50 `9.28/5.89 ms`, p95 `18.4/8.72 ms`, peak `24.5/13.1 ms`. Host load and different sample lengths affect these comparisons. Maximum LOW/HIGH node counts were 229/76 in measured runs, under 260. New aggregate and height texture arrays use 55,872 bytes LOW and 132,096 bytes HIGH; this excludes existing raster buffers, object overhead and GPU copies. Rasterization cost was not isolated from the field step. The floc implementation still creates transient arrays and objects during stepping, so a zero per-frame allocation claim is not supported.

## Verification and gaps

Focused tests passed: wave 16 F1 plus wave 11 C3, wave 12 C6, wave 13 C7 and wave 10 diagnostics, 14/14 at that run; the final F1-only rerun after adding motion diagnostics passed 3/3. Earlier floc and silver-field tests passed 9/9. TypeScript `--noEmit` passed. The whole suite, before the final motion diagnostic test was added, had 432 passed, 4 failed, and 3 expected failures in 77 files. `wave4a/field.test.ts` retained its pre-existing surface-raft failure (actual `.0024971032`, minimum `.005`). `wave6perf/flocPerf.test.ts` retained a stale HIGH golden: expected total `.5416591664`, current `.6136711334`; the prior report recorded `.5982768111` before this work. The change is intentional: aggregate weight and sediment transfer alter chemistry through flow feedback, while mass balance still passes. Its node/shape goldens were not re-pinned because the test stops at the first assertion. Two rendering tests timed out at 5 seconds, including when the rendering file was rerun alone (33 passed, 2 failed); they run stage one rather than the new stage-three path, so this is not evidence of a stage-three numeric failure, but the timeout remains unresolved. No expectations were edited.

The field provides exact accounting and renderer data, but morphology, suspension persistence, breakup default, a full real-pour versus motionless-control replay, isolated rasterization timing, 7 mm deposit volume shape, and visual similarity have not been validated against game frames. The node budget can still accumulate pending parcels if it reaches 260 and no local pair can merge. The deposit height is a loose-volume proxy rather than a compacted volume. These are integration and calibration risks for the coordinator's browser review.
