# Experiment 2, 2.5 mL AgNO3 configuration: settling audit and 180 s CPU run

Test: `tests/night/longrun/longrun.test.ts` (env `AGG`, `START`, `CHECK`, `END`, `BUOY`). CPU only, nothing seen in the game. No stream, no buoyancy flag.

## Configuration of record (user's selected scenario)
- AgNO3: 2.5 mL receiving volume (`EXPERIMENT2_AGNO_ML`, default in `tubeAmounts.ts`; `__silverAgnoMl = 1` restores the old 1 mL, kept only for regression).
- NaCl: 1 mL poured over 1.7 s (game pour curve, 50 ms steps), liquid 25.1 mm after the pour (tube level function), inlet at 6.5 mm off axis on the highest wet voxel within 3 mm of the stream.
- Field: LOW grid 12x24x12, stage 3. Total Ag+ in the field is `silverAmount` = 1.15 units (aggregation off) or 1 unit (aggregation on), 1 unit = 0.1 mmol AgCl, i.e. the NaCl portion. It is NOT scaled with the AgNO3 volume (`tubeSilverRuntime.ts` builds the field with the default amount). So in the 2.5 mL case the field holds the same Ag+ amount as for 1 mL, in 2.5 times the liquid: the AgNO3 is effectively 0.04 mol/L, not 0.1. Total AgCl is limited by the NaCl either way (1 unit), but the Ag+ availability and therefore the reaction pattern differ from real 0.1 mol/L AgNO3 (0.25 mmol). OPEN QUESTION for the user.

## Audit of the existing code (answers)
1. Can fine suspended AgCl settle in the baseline? No. `settle()` for the three fine classes is called only under `!stageOne`; stage 3 is `stageOne`, so the fine suspension has no settling term at all. It moves only with the resolved flow and the eddy/diffusion terms. Even if it were on, primary particles (r = 0.32 um) have a Stokes slip of 0.54 um/s, 0.1 mm in 180 s.
2. Can unresolved microscopic aggregates settle? Yes, when they exist: sectional bins (r 0.32 um to 1.76 mm) carry slip from 0.54 um/s to 2.8 mm/s (`sections.transport`, face fluxes with slip, mass leaving the floor cell goes to `SilverSedimentField.deposit`). They are created only from the fine suspension by Brownian and shear collisions.
3. Is settling disabled when `__silverAgg=0`? Yes. `advanceFlocSystem` skips the fine to section transfer (`if (!silverAggregationEnabled()) continue`), so sections and flocs stay empty and nothing can reach the sediment. `SilverSedimentField` is also built without the stage-3 solid volume. Measured: deposited = 0.00000 at every checkpoint.
4. Does the fluid density include suspended AgCl? Baseline: only aggregate mass (`flocMass`, which includes the unresolved sections) loads the liquid, at a tuned 0.005 m/s2 per unit concentration; fine suspension adds no weight; the incoming-solution tracer is buoyant (-0.1). With `__silverBuoyancy` (experimental) the composition density is used.
5. Can a concentrated cloud move downward collectively? With aggregation on, yes: the aggregate weight loads the liquid and the flow carries the cloud down (measured -0.55 mm/s mass-weighted, versus gravitational slip 0.003 to 0.013 mm/s). With aggregation off, no: the fine cloud has no weight in the momentum equation.
6. Which states can reach the bottom? Sectional aggregates (fluid-carried to the floor cells, then slip) and resolved floc nodes (`depositAtFloor`; none were promoted in these runs: flocs = 0). Fine suspension: never (the `fineToSediment` path exists only in the unused non-stage-3 branch).
7. What transfers mass into a deposit? `SilverSedimentField.deposit(column, mass)` from `sections.transport` and `flocSystem.depositAtFloor`. `ConsolidatingDeposit` is not connected to anything. The existing deposit has a field-wide porosity proxy, 0.90 to 0.55, driven by one scalar (`compaction`), not per column or per stress.

## 180 s results, 2.5 mL AgNO3 + 1 mL NaCl (units: 1 = full conversion of the NaCl portion)
Accepted baseline (aggregation off):
| t, s | formed | fine | sections | flocs | deposited | centroid, mm of 25.1 | share in top sixth | fluid velocity of the cloud, mm/s |
|---|---|---|---|---|---|---|---|---|
| 10 | 0.632 | 0.632 | 0 | 0 | 0 | 20.1 | 0.50 | +0.32 |
| 30 | 0.929 | 0.929 | 0 | 0 | 0 | 22.0 | 0.80 | +0.15 |
| 60 | 0.998 | 0.998 | 0 | 0 | 0 | 23.6 | 1.00 | +0.06 |
| 120 | 0.999 | 0.999 | 0 | 0 | 0 | 23.8 | 1.00 | +0.05 |
| 180 | 0.999 | 0.999 | 0 | 0 | 0 | 23.8 | 1.00 | +0.05 |

The distribution becomes stationary because the fine cloud is carried up and collects in the top sixth, and then there is no mechanism that takes it down: no settling, no weight in the momentum equation. A stationary flow of about 0.37 mm/s max stays after 60 s (cause not investigated). The density excess in the top sixth reaches 22 kg/m3 against 0.7 kg/m3 at the bottom: a heavy layer over a light one that the baseline cannot act on, because the fine AgCl carries no weight. This is why the cloud "holds at the surface" and why the composition buoyancy test sank it quickly. It is a model limitation, not evidence about the real liquid.

Aggregation on (experimental here, as in the lab viewer):
| t, s | formed | fine | sections | flocs | deposited | centroid, mm | share in bottom sixth | fluid velocity, mm/s | slip, mm/s | deposit flux, units/s | bowl fill, mm |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 0.731 | 0.353 | 0.378 | 0 | 0.0001 | 8.8 | 0.34 | -0.69 | 0.0003 | 1e-5 | 0.011 |
| 30 | 0.953 | 0.126 | 0.814 | 0 | 0.0127 | 2.9 | 0.81 | -0.57 | 0.0029 | 6e-4 | 0.113 |
| 60 | 0.975 | 0.040 | 0.808 | 0 | 0.1273 | 1.7 | 0.93 | -0.55 | 0.0090 | 4e-3 | 0.183 |
| 120 | 0.983 | 0.016 | 0.513 | 0 | 0.4541 | 2.0 | 0.93 | -0.33 | 0.0132 | 5e-3 | 0.347 |
| 180 | 0.985 | 0.011 | 0.294 | 0 | 0.6798 | 2.3 | 0.89 | -0.19 | 0.0133 | 4e-3 | 0.425 |

- Mass ledger error stays below 8e-14 in all runs.
- Section mass sits in bins up to r = 11.6 um (slip up to 48 um/s); no large aggregates form at these conditions. Individual particles settle only a few mm in 180 s (mass-weighted slip 0.013 mm/s gives 2.3 mm). The 6 mm drop of the centroid in the first 30 s is carried by the fluid (loaded flow), not by gravitational settling of individual particles. Deposition then proceeds at the floor at rate about concentration x slip.
- Deposited 0.68 of 0.985 at 180 s, equivalent bowl fill 0.43 mm at the existing porosity law. The porosity proxy jumps from 0.90 to 0.55 by 60 s (one global scalar, time constant about 10 s), far faster than a real soft deposit; it does not describe a layer that compacts gradually under added load.

## What is missing for the final visual requirements
1. Under the accepted baseline (aggregation off) nothing can descend, separate or settle; the white layer at the surface persists indefinitely. Settling needs aggregation on, or a new weight term for the fine phase, which is a physical-model decision for the user.
2. With aggregation on, mass does reach the bottom and a deposit forms, so the connection to a consolidating deposit is justified; its compaction law (`ConsolidatingDeposit`, per column, stress dependent) would replace the global proxy. Not implemented yet, per instructions.
3. The Ag+ amount is not scaled with the 2.5 mL volume (see above).
4. Mesoscopic cloud morphology and separation (MesoCloud) is untouched by these runs; it remains a requirement.
