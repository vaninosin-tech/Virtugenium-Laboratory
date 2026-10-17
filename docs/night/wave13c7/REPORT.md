# Wave 13 C7: calibrated jet momentum

## Decision

Keep `__silverJetModel` and `__silverSubgrid` off. The flow-rate handoff and wet-cell force accounting are corrected, but the flagged jet still mixes the 1 mL receiving layer much too aggressively. In the peaked-ledger LOW replay at 9 s, AgCl formed is 0.2334 with both flags off and 0.9860 with the calibrated jet. Fine-field total variation falls from 0.943 to 0.253. Both 10% and 50% p95 regions are one connected component. The numerical slices are evidence of fields only; no browser or WebGL visual assessment was made. No change to chemistry, rendering, delivery geometry, or the ledger was made.

## Delivery, units, and the missing lip measurement

`tubePourImpact.pouredMl(k)` integrates the actual squared stream-thickness envelope from the 30 ms pour clock. Its valid event increments were binned into 50 ms fluid steps. The sum is exactly 1 mL within the test tolerance, and `sum(Q dt) = 1e-6 m3` to better than `1e-15 m3`. The production runtime accumulates accepted `event.ml` until the next field step when the flag is on: `Q = acceptedMl * 1e-6 m3/mL / 0.05 s`. The unflagged overwrite behaviour is preserved exactly. The flagged field passes the same `Q` to `SurfaceSpread.flow` and `TubeJetModel.prepare`.

The chosen effective impact radius is the downstream `PourStream` ring at full visual flow, `r=0.00075 m`; its drawn lip ring is `0.00115 m`. The visual flow fraction is not in the delivery event, so this is a fixed area convention rather than a measured hydraulic cross-section. `A=pi r²=1.767145868e-6 m²`, `U=Q/A`, and `F=rho Q U` for `rho=1000 kg/m³`. Q is m³/s, U is m/s, and F is N. Numbers below are 50 ms averages after the click; the first delivery is at about 0.65 s.

| Click time s | Cumulative mL | Q m³/s | U m/s | F N |
| ---: | ---: | ---: | ---: | ---: |
| 0.70 | 0.02090 | 4.1303e-7 | 0.2337 | 9.6534e-5 |
| 0.80 | 0.16887 | 2.2181e-6 | 1.2552 | 2.7842e-3 |
| 1.00 | 0.56808 | 2.2812e-6 | 1.2909 | 2.9449e-3 |
| 1.20 | 0.91027 | 1.1406e-6 | 0.6455 | 7.3623e-4 |
| 1.30 | 1.00000 | 1.5861e-7 | 0.0898 | 1.4236e-5 |

The peak 1.291 m/s would require an 85 mm free fall from rest under `sqrt(U0²+2gh)`. The delivery event has `point` at the surface and `surfaceY`, but no source lip point, source speed, or stream fraction. `window.__pourStreamDebug` exposes lip and target only in a live development browser, and the supplied game dumps do not include it. Therefore the free-fall comparison cannot be completed from authoritative replay data. This is an integration blocker for calibrating the effective area and momentum. Do not interpret the rendered radius as a validated jet speed.

## Penetration and momentum response

The source uses wet interior faces only. It finds the floor near the 6.5 mm impact axis in the actual hemispherical `LiquidMask` and stops at that floor. For entrainment coefficient `alpha=0.08`, virtual origin `z0=r0/(2 alpha)=4.69 mm`, and `Q(z)=Q0(1+2 alpha z/r0)`, the local forcing density follows the derivative of the surviving round-jet momentum. If the core reaches the bowl floor, its remainder is deposited into the last wet layer. The projection then supplies the wall reaction and creates lateral and returning flow. The width is limited to the cone or 1.25 horizontal cells, rather than the previous 3.5-cell kernel. The dynamic stopping distance compares the entrained core speed with the local pre-step fluid speed plus a 0.05 m/s dissipation threshold. The `penetration` option can override this for controlled tests.

At 0.8e-6 m³/s on the 22 x 44 x 22 mask, the measured level/jet-force-depth pairs at 1.0, 1.4, 1.8, and 2.0 mL are 22.77/20.26, 31.36/28.85, 39.96/37.45, and 44.26/37.75 mm. The specified vertical force is `-3.621659e-4 N`, and the summed face source matches it to floating precision at each level. Dry and nonexistent cells get zero force. When no wet face can take the remaining force, `blockedMomentum` records it; the 1.30 s tail has `-1.4236e-5 N` blocked rather than silently discarded. The face-velocity cap and pressure reaction are separately reported in the CSV. The cap's absolute change is not a pure jet-momentum loss because it acts on the total pre-projection face velocity.

The measured physical levels conflict with the 7 to 14 mm depth estimate in the task: the current field uses `tubeLiquidHeight` with effective radius 3.849 mm, but `LiquidMask` uses a 7 mm radius and `silverFieldHeight=110.47 mm`. At the wall-adjacent impact, that mask has a lower bowl floor and 20 to 38 mm of wet depth over the tested fill. The 50 ms LOW field has 12 x 24 x 12 cells; stage-3 HIGH currently selects 16 x 32 x 16 in the `flocGrid` branch. The owned field hunk was restricted to flow handoff, so C7 did not alter that grid selection. The independent solver measurement and level test use the requested 22 x 44 x 22 grid, but the four chemistry replays use the actual LOW field. A true HIGH field replay needs an authorized grid-selection change.

## Controlled replay

The four configurations share the same peaked valid increments, 1.0 mL initial Ag+ liquid, 6.5 mm impact, 50 ms steps, aggregation off, and subgrid off. `baseline` has no jet flag. `rate_only` uses the ledger Q with the previous broad axial kernel (`distribution:"legacy"`). `distribution_only` uses the local wet kernel with the previous nominal `flow:1e-6` m³/s. `both` uses ledger Q and the local kernel. The nominal-flow run is a diagnostic counterfactual, not a valid delivered-volume parameter; chemistry still receives only the actual ledger amount. A separate passive tracer run uses `__silverDiag="tracer"` and the same velocity transport. The chemistry run has precipitation on. `history.csv` and `chemistry.csv` each hold all 280 steps per configuration, with velocity, axis-down and bottom-radial profiles, tracer second moments and penetration, force and impulse, reagent totals, local source, variance, TV, occupied fraction, p95 component counts, S/V, and vertical/radial fine profiles. The first chemical source at 0.65 s was entirely within 3 mm of impact.

| Time s | Baseline extent / TV | Rate only extent / TV | Distribution only extent / TV | Both extent / TV |
| ---: | ---: | ---: | ---: | ---: |
| 1 | .0400 / 2.803 | .0653 / 2.278 | .1281 / 2.094 | .1155 / 2.548 |
| 2 | .0957 / 2.085 | .5825 / .692 | .5451 / .536 | .5953 / .649 |
| 4 | .1598 / 1.426 | .9801 / .222 | .8449 / .319 | .9053 / .273 |
| 9 | .2334 / .943 | .9964 / .076 | .9515 / .272 | .9860 / .253 |
| 14 | .3007 / .863 | .9966 / .070 | .9767 / .281 | .9947 / .218 |

At 0.5 s there is no delivery, and extent is zero for all four. The baseline 9 s extent closely reproduces the supplied real-game dump's 0.23328. The counterfactual jet variants all overmix and have one connected 10% and 50% fine region by 9 s. No alternative entrainment coefficient is selected because the missing lip speed and hydraulic area dominate the force uncertainty. The flow correction by itself does not repair the smooth cloud. The flagged jet is not accepted for producing more solid. Fixed-grey-scale 72 PPM central vertical slices contain velocity magnitude with x/y vectors, tracer, Ag+, Cl-, source, and fine suspension for baseline and both at 0.5, 1, 2, 4, 9, and 14 s.

## Cost and verification

`cpu.json` measures solver steps only, 200 measured after 20 warm-up, while a positive segment of the actual delivery Q sequence is repeated. Repeating is necessary to obtain 200 actively forced steps from a pour lasting less than 1 s. The host was loaded, so these are comparative wall-clock samples. HIGH here is the solver's 22 x 44 x 22 mask, not the stage-3 field's HIGH selection.

| Grid | Flag | p50 / p95 / peak ms |
| --- | --- | ---: |
| LOW 12 x 24 x 12 | off | 0.50 / 1.34 / 7.32 |
| LOW 12 x 24 x 12 | on | 3.54 / 6.92 / 12.90 |
| HIGH 22 x 44 x 22 | off | 3.21 / 7.76 / 17.91 |
| HIGH 22 x 44 x 22 | on | 23.91 / 29.68 / 71.30 |

The flagged solve uses 120 pressure iterations during and after forcing instead of the prior 300 during and 30 after. In the peaked replay, increasing the active iteration count from 120 to 300 did not change the large divergence seen immediately after the pour, because the post-pour path still used 30. Raising that path to 120 reduced maximum mean absolute divergence to 0.1142/s (`rate_only`), 0.0694/s (`distribution_only`), and 0.1070/s (`both`), below the 0.3/s tolerance. The fixed-level HIGH in-pour benchmark maximum was 0.1153/s. The expensive pressure solve remains a performance issue.

`tsc --noEmit` passed after the final code change. C7 tests passed 5/5, with a focused post-change replay passing 1/1. The existing field, solver, and runtime group passed 13/13. The single whole-suite run, before the final flagged post-pour projection adjustment, had 390 passed, 7 failed, and 4 expected failures across 69 files. That adjustment is gated by `__silverJetModel`; the affected C7 replay was rerun after it. Known numeric failures remain wave4a surface, wave4b stream endpoint, and wave6perf HIGH golden. The other failures were one `tubeReactionVisuals` timeout, one `_g1_motion` timeout, and a `tubeVolumeField` CPU threshold and timeout. Alone, `tubeReactionVisuals` had 33 passed and 2 timeouts, `_g1_motion` timed out, and `tubeVolumeField` passed 13/13. The whole suite's rewrites outside C7 ownership were restored to their original content.

## Remaining integration requests

1. Add an authoritative source lip position or fall height and source speed to the delivery event, or provide an equivalent recorded trace, so `sqrt(U0²+2gh)` can constrain effective `A`, `U`, and `F`. The present event's impact point is already at the surface and cannot supply this height.
2. Resolve the physical-volume versus `LiquidMask` radius discrepancy and authorize a stage-3 HIGH grid selection of 22 x 44 x 22 if that is the intended real field grid. This requires a change outside C7's permitted field hunks.
3. Keep the jet flag off until a physically constrained momentum budget passes a HIGH field replay with localized, progressively displaced tracer and fine-suspension structure at affordable cost. The present closure is conservative at source faces but fails that acceptance test.

Files modified: `src/scenes/laboratory/lib/tubeFlowSolver.ts`, `tubeJetModel.ts`, `tubeSilverField.ts`, `tubeSilverRuntime.ts`; new `tests/night/wave13c7/calibratedJet.test.ts` and this report plus CSV, JSON, and PPM evidence under `docs/night/wave13c7/`.
