# Experiment 2, 2.5 mL AgNO3 configuration: settling audit and 180 s CPU run

Test: `tests/night/longrun/longrun.test.ts` (env `AGG`, `START`, `CHECK`, `END`, `BUOY`). CPU only, nothing seen in the game. No stream, no buoyancy flag.

> Update (part 2 below): Ag+ is now initialised physically (2.5 units = 0.25 mmol for 2.5 mL of 0.1 mol/L). The numbers in the first part were produced with the old normalised 1 to 1.15 units and are superseded; part 2 repeats the comparison.

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


# Part 2: corrected amounts, fine-suspension weight, A to D comparison, bed integration

All results CPU only (`tests/night/longrun/longrun.test.ts`, env `AGG`, `FINE=solid|net`, `DEPOSIT=1`, `START=2.5`). Nothing seen in the game.

## 1. Amounts corrected
The game field now starts with Ag+ = AgNO3 volume x 0.1 mol/L (`tubeSilverRuntime.ts`): 2.5 mL gives 0.25 mmol = 2.5 field units (1 unit = 0.1 mmol = the 1 mL NaCl portion). Test `tests/night/amounts/silverAmount.test.ts` checks Ag+ present + AgCl formed = 0.25 mmol and Cl- present + AgCl = delivered chloride at every sample, AgCl <= 0.10 mmol, and 0.150 mmol Ag+ left (1.5000 units at 15 s and later; chloride 99.96 % consumed by 15 s). The 1 mL regression gives 0.10 mmol. Directly constructed fields keep the old default amount (bit-identical regression tests). One baseline test (`defaults.test.ts`, silverAmount 1.15) was changed on purpose to 2.5 and says so. Effect: with 2.5 times more Ag+ available, chloride is consumed faster (formed 0.96 at 10 s, 1.00 at 30 s, against 0.63 and 0.93 before).

## 2. Fine-suspension weight (`window.__silverFineWeight`, off by default)
a = g (rho_s - rho_l)/rho_l * phi from the fine suspension only (three fine classes), phi = solid volume / occupied liquid volume, concentrations capped at the 0.1 mol/L feed value (injection puts amount in without its volume). Aggregates stay loaded by `flocMass` only (no double counting); the tuned incoming-solution buoyancy is kept. Pressure projection uses 120 iterations while the flag is on. Mode `solid` is the literal request; mode `net` subtracts the dissolved reagent mass that left the liquid when the AgCl formed (see `tubeBuoyancy.ts`). Both are shown because forming a solid inside a parcel is nearly density neutral: only separation of solid from its liquid makes weight. Scale check: the tuned tracer buoyancy is -0.5 mm/s2 per band, the fine weight of the same suspension is 1 to 170 mm/s2, about 100 times larger; the physical reagent contrast is about 100 times larger than the tuned one (code comment: 9.8 vs 0.1 in load units). So the new term dominates the existing reagent buoyancy until that is reviewed.

## 3. A to D at 2.5 mL AgNO3 + 1 mL NaCl (units: 1 = 0.1 mmol AgCl, the maximum)
Centroid in mm of 25.1 mm; deposited and masses in units; ledger error below 1e-13 everywhere.
| config | t, s | formed | fine | aggregate (sections+flocs) | deposited | centroid | share top / bottom sixth | cloud fluid velocity, mm/s | max abs w, mm/s |
|---|---|---|---|---|---|---|---|---|---|
| A fine, no weight, no agg | 10 | 0.960 | 0.960 | 0 | 0 | 21.9 | 0.79 / 0 | +0.19 | 0.79 |
| | 30 | 1.000 | 1.000 | 0 | 0 | 23.4 | 0.99 / 0 | +0.08 | 0.37 |
| | 60 | 1.000 | 1.000 | 0 | 0 | 23.8 | 1.00 / 0 | +0.05 | 0.37 |
| | 180 | 1.000 | 1.000 | 0 | 0 | 23.8 | 1.00 / 0 | +0.05 | 0.37 |
| B fine weight (solid) | 10 | 1.000 | 1.000 | 0 | 0 | 8.1 | 0.01 / 0.24 | +0.03 | 3.0 |
| | 30 | 1.000 | 1.000 | 0 | 0 | 8.2 | 0.01 / 0.23 | -0.002 | 0.07 |
| | 60 | 1.000 | 1.000 | 0 | 0 | 8.1 | 0.01 / 0.24 | -0.002 | 0.06 |
| | 180 | 1.000 | 1.000 | 0 | 0 | 8.0 | 0.01 / 0.25 | -0.002 | 0.05 |
| B net | 10 / 30 / 60 / 180 | 1.000 | 1.000 | 0 | 0 | 9.6 / 9.6 / 9.7 / 9.7 | 0.06 / 0.21 (10 s) | ~0 | 2.2 then 0.03 |
| C aggregation only | 10 | 0.998 | 0.291 | 0.707 | 0.0005 | 6.4 | 0.06 / 0.50 | -1.20 | 13.4 |
| | 30 | 1.000 | 0.041 | 0.923 | 0.036 | 1.3 | 0 / 0.94 | -0.66 | 1.9 |
| | 60 | 1.000 | 0.012 | 0.788 | 0.199 | 1.0 | 0 / 0.98 | -0.56 | 1.5 |
| | 180 | 1.000 | 0.004 | 0.242 | 0.754 | 1.65 | 0.03 / 0.95 | -0.15 | 0.41 |
| D aggregation + fine weight | 10 | 1.000 | 0.321 | 0.678 | 0.0003 | 8.4 | 0.01 / 0.22 | -0.01 | 2.4 |
| | 30 | 1.000 | 0.133 | 0.865 | 0.0022 | 7.7 | 0.01 / 0.32 | -0.22 | 4.5 |
| | 60 | 1.000 | 0.073 | 0.915 | 0.0116 | 7.0 | 0.01 / 0.40 | -0.12 | 2.7 |
| | 180 | 1.000 | 0.027 | 0.875 | 0.0974 | 6.6 | 0.02 / 0.45 | -0.16 | 3.9 |
| D net | 180 | 1.000 | 0.031 | 0.892 | 0.0767 | 7.6 | 0.06 / 0.40 | -0.09 | 3.0 |

Reading:
- A: everything rises into the top sixth and stays; no mechanism lowers it. Stationary because it cannot move relative to the liquid and the fine AgCl has no weight (density excess in the top sixth 34 kg/m3, bottom 2).
- B: with weight, the surface-concentrated cloud overturns within about 10 s (Rayleigh-Taylor like, centroid 22 to 8 mm) and ends as a stable stratified milky column that then stands still (flow below 0.07 mm/s from 30 s). It never reaches the bottom: the fine suspension has no slip relative to the liquid, so nothing deposits. Collective descent happens, but only as the one-off overturn.
- C: aggregates load the liquid and are carried to the floor (centroid 1 mm by 30 s), 75 % deposited by 180 s. This is the fast, "everything sinks" result.
- D: the fine weight builds a stable density stratification that suppresses the aggregate-driven overturn: 87 % stays suspended at 180 s (centroid 6.6 mm), deposit 10 %. The milky suspension persists and settles slowly, which resembles the target appearance more than C, but this rests on the unreviewed 100 times stronger weight and on the aggregation model with its known limits; not validated.
- `net` differs from `solid` by 1 to 3 mm in the centroid, less than the difference between configurations.
- CPU (node, one core, sequential 30 s runs, mean / p99 per 50 ms step): A 3.9 / 6.8 ms, B 8.1 / 13.9, C 9.4 / 14.0, D 13.4 / 22.0. The fine weight roughly doubles the cost (projection iterations). Not measured in the game.

## 4. ConsolidatingDeposit behind the ledger (`window.__silverDeposit = true | params`, off by default)
`SilverSedimentField.values` remains the conserved ledger; with the flag a 12-layer bed per column (`ConsolidatingDeposit`, hemispherical floor from `ConsolidatingDeposit.bowl`) receives mass only through `deposit()` (the same call the sections and flocs already make), places mass outside the vessel circle in the nearest valid column, relaxes void ratio toward a stress dependent equilibrium, creeps on the free-surface elevation (floor + bed) above a yield slope, and loses mass only through `release()` (resuspension, from the top). After each step the ledger is set from the bed's column masses. The old global proxy (`compaction`, porosity 0.90 to 0.55) is bypassed. Heights for the sediment texture come from the bed. Tests: `tests/night/meso/depositIntegration.test.ts` (ledger and conservation 1e-12, mass outside the circle, wall material slides toward the centre, compaction by load, flag on/off at field level with total balance below 1e-12).

Review of the old porosity law: `settle()` raises `compaction` by dt/35 whatever the mass (porosity 0.81 at 10 s and 0.55 at 60 s in run A with zero sediment); `settleCurd()` takes the largest single column load and saturates (p/(p+0.5), time constant 10 s), so a trivial load of 1 Pa already drives the whole field to 0.55 within a minute. Both are proxies, not load dependent per column.

Run C + bed, 180 s: ledger error 6e-14; deposited 0.754 units (10.8 mg AgCl); bed mean porosity 0.894 (self weight about 1 Pa), equivalent bowl fill 0.93 mm; thickness 0.56 mm in about 36 central columns, nearly uniform (the suspension is laterally uniform, and no discrete flocs were promoted, so nothing makes it lumpy); lateral creep moved 0.002 mg. Visible? A 0.5 mm layer on a 14 mm tube is thin; whether it reads on screen is a question for the real-game recording. Irregular, curdy structure does not emerge from this transport: it would need discrete floc deposition or the mesoscopic morphology work. Compaction: with the load of this small deposit the bed stays loose (porosity 0.89); strong compaction needs larger deposited mass, which the tests exercise (a 5-unit column compacts more than a 0.05-unit one). The relaxation time 300 s and the stress scale 1 Pa are placeholders, not measured for AgCl.

## 5. Still open
- Cloud stretching and separation on the real flow (MesoCloud shadow run): next.
- Decision on the tuned reagent buoyancy being about 100 times below its physical contrast (affects B and D strongly).
- Real-game recording of any of A to D; the Windows gate for the stream model is still unfinished.
