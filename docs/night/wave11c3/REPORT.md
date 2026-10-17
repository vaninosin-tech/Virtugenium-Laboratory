# Wave 11 C3: reactant contact and fine suspension

## Scope and result

No production constant or field code was changed. The controlled trials show that stronger dissolved-ion mixing increases AgCl formation, but the same trials broaden the formation region and reduce fine-field contrast. The current 12 x 24 x 12 grid and surface/wall flow remain unable to resolve branching, hanging extensions, or transparent internal holes. There is no evidence here for selecting a new physical mixing coefficient. Diagnostic C's fine-AgCl transport remains `1e-9 m2/s` plus `0.02` of the solver eddy term.

The diagnostic test and its generated data are the only additions. It replays stage 3 with aggregation disabled, a 1.0 mL initial liquid amount, two 0.02 mL ledger parcels accumulated for each 50 ms field step (1.0 mL delivered by 1.25 s), and a fixed impact at x=6.5 mm. This follows the `wave10diag` stepped-delivery pattern and the same `TubeSilverField.advance` used by the runtime. Its event clock starts at first delivery, whereas the supplied browser dumps start at the NaCl click and first impact occurs near 600 ms. Consequently, compare the states at equal delivered amount or late time, not their early wall-clock labels. The final 2.0 mL liquid height matches the dump's 44.2566 mm. The older C1 replay used a 2.5 mL initial level; that changes the flow and should not be used as a progress baseline.

## What progress measures

`silverAmount=1.15` is the initial normalized Ag+ amount. A complete 1.0 mL NaCl delivery supplies 1.0 normalized Cl- amount. `advance` inserts only `max(0, min(1, delivery)-delivered)`. `extent` is the cumulative **formed AgCl amount**, where 1.0 is the product from the full NaCl portion, not a fraction of the initial 1.15 Ag+. `progress=min(1, extent)` is a dimensionless capped display fraction. Every cell passes its *per-cell amounts* `Ag+`, `Cl-`, the wet-cell count, `ksp=0.0005`, `dt=0.05 s`, and the sum of its three suspension classes to `precipitatePair`. The latter multiplies each amount by the wet-cell count to obtain a normalized concentration, computes saturation `A*B/ksp`, and returns zero at or below saturation 1. Above saturation it computes the local equilibrium amount and consumes a fraction `1-exp(-rate*dt)`, with `rate=(42 or 60)*(saturation-1)/(saturation+3) /s`; the 60 branch applies when suspended solid is already present. The result is capped by both reactant amounts. For equal unit concentrations in 1000 wet cells, a fresh cell consumes over 80% of its locally available pair in one 50 ms step. This is much faster than the 9 s bulk progress, so delivery and intercell contact govern the bulk history.

## Real-game dump audit

The seven supplied dumps have aggregation off and contain per-cell amounts, not already normalized concentrations. The following totals sum the wet cells. `Overlap` is `sum(min(Ag+,Cl-))`, an amount available if every co-located pair reacted instantly. `Cl at Ag` is the fraction of dissolved Cl- in cells where Ag+ exceeds 10% of the initial mean per-wet-cell Ag+ amount. Trace Ag+ occupancy is not useful for this measure.

| ms after click | Delivered = Cl + extent | Ag+ | Cl- | Extent | Overlap | Cl at Ag |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 900 | 0.39157 | 1.10957 | 0.35114 | 0.04043 | 0.000401 | 0.000510 |
| 1500 | 1.00000 | 1.07856 | 0.92856 | 0.07144 | 0.000488 | 0.000171 |
| 2500 | 1.00000 | 1.03299 | 0.88299 | 0.11701 | 0.001071 | 0.000217 |
| 4000 | 1.00000 | 0.98978 | 0.83978 | 0.16022 | 0.001294 | 0.000280 |
| 6000 | 1.00000 | 0.95593 | 0.80593 | 0.19407 | 0.000814 | 0.000470 |
| 9000 | 1.00000 | 0.91672 | 0.76672 | 0.23328 | 0.001158 | 0.000319 |
| 12000 | 1.00000 | 0.87528 | 0.72528 | 0.27472 | 0.001445 | 0.000454 |

At 9 s, 0.76672 of the chloride remains dissolved despite 0.91672 unreacted silver. Only 0.001158 normalized amount is instantaneously co-located in the same cells, and only 0.032% of the chloride lies where Ag+ reaches 10% of its initial cell mean. The limited progress is therefore primarily **segregation and slow contact**, not insufficient total reagent or a global rate cap. The solver's finite precipitation rate may affect a newly contacted cell for one or two steps, but cannot explain the large separated reservoirs. The dump source at 900 ms is centered at `(4.81,19.91,0.90) mm` with 2.92 mm RMS spread; 96.7% of its mass lies in rows 3 and 4. At 9 s its centroid has migrated to `(1.17,29.26,0.21) mm`, RMS spread 5.13 mm, with 82.2% in row 6 and 16.0% in row 5. These are actual local reaction locations, not artificial source geometry.

## Deterministic 50 ms mass history

The corrected baseline replay (`mix1.csv`) has exact reagent and product accounting each step. `Fine` is suspension class 0 and `tint` class 1. Class 2, coarse, flocs, and sediment are zero with aggregation off; the file records them at every step. Time starts with first field insertion.

| ms | Delivered | Ag+ | Cl- | Extent | Fine | Tint | Overlap | Source |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | .04000 | 1.13475 | .02475 | .01525 | .01523 | .00002 | .001049 | .015250 |
| 500 | .40000 | 1.10561 | .35561 | .04439 | .04391 | .00048 | see CSV | .002661 |
| 1000 | .80000 | 1.07881 | .72881 | .07119 | .06984 | .00135 | see CSV | .002691 |
| 2500 | 1.00000 | 1.01010 | .86010 | .13990 | .13380 | .00610 | see CSV | .001770 |
| 4000 | 1.00000 | .96723 | .81723 | .18277 | .16975 | .01302 | see CSV | .001266 |
| 6000 | 1.00000 | .93300 | .78300 | .21700 | .19292 | .02408 | see CSV | .000652 |
| 9000 | 1.00000 | .89236 | .74236 | .25764 | .21517 | .04247 | .001114 | .000690 |
| 14000 | 1.00000 | .82543 | .67543 | .32457 | .24724 | .07732 | see CSV | .000638 |

The first source centroid is `(5.76,20.71,0.00) mm`; every source cell at that first step is within 2.984 mm horizontally of the 6.5 mm impact. Its source is entirely in row 4. At 9 s, the source is 18.9% in row 5 and 79.5% in row 6, centroid `(1.10,29.12,0.03) mm`, RMS spread 5.18 mm. Subsequent source cells can extend beyond 3 mm because dissolved reactants have flowed and mixed; this is not an added injection source. The full source row fractions, centroids and spread for sampled times are in `summary.json`.

## Controlled mixing comparison at 9 s

`__silverMix` is the fixed **effective numerical/subgrid mixing coefficient** passed to transport for both dissolved ions and the incoming tracer. The stage 3 default is `2e-6 m2/s`. It is not the molecular diffusion coefficient (about `1.9e-9 m2/s` for Cl- and `1.7e-9 m2/s` for Ag+). `__silverEddy` scales a speed-dependent eddy diffusivity computed by the flow solver; its default is `0.3`. Neither parameter changes the suspended fine-AgCl coefficient. Stage 3 inherits stage one's gentle jet path, so `__silverJet` scales the local momentum impulse with default `0.1`. `__silverBuoy=0.1` gives the incoming lighter solution an upward body force through its tracer; `__silverSpread` enables the near-surface radial momentum closure; `__silverAlpha=0.2` sets its radial speed factor and `__silverDelta=1.5 mm` its depth decay. These are stage 3 defaults, all held fixed in the table.

`CV` is the fine-field coefficient of variation over wet cells; `TV` is wet-face total variation divided by fine mass. Shape entries are number of six-connected components / cells above 10% and 50% of positive-cell p95. `S/V` is the 10% region surface-to-volume ratio in 1/m, a filament/sheet proxy. `Aspect` is the occupied bounding-box maximum/minimum dimension. `Away` is the fraction of fine mass more than 3 mm horizontally from impact. The CSV also records a thresholded spatial overlap volume: cells where Ag+ and Cl- exceed 10% of their respective nominal mean concentrations, multiplied by cell volume. It is **zero in every 9 s configuration**, while the amount-based `Overlap` remains nonzero at dilute interface concentrations. `CPU` is p50/p95 ms per measured field step, excluding metric collection, after 20 warm-up steps; timings are machine and load dependent.

| Run | Extent | Ag+ / Cl- left | Overlap | Cl at Ag | CV / TV | 10% / 50% shape | S/V / aspect | Away | CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mix 0.5x | .1987 | .9513 / .8013 | .00119 | .000291 | 2.01 / .958 | 1/324, 1/120 | 710 / 2.37 | .57 | 2.79 / 5.50 |
| **Baseline** | **.2576** | **.8924 / .7424** | **.00111** | **.000358** | **1.82 / .930** | **1/402, 1/153** | **635 / 1.97** | **.61** | **2.67 / 4.94** |
| Mix 2x | .3355 | .8145 / .6645 | .00114 | .000480 | 1.68 / .937 | 1/404, 1/169 | 624 / 1.97 | .65 | 3.81 / 10.37 |
| Mix 4x | .4519 | .6981 / .5481 | .00115 | .000773 | 1.58 / .962 | 1/420, 1/198 | 606 / 1.97 | .69 | 3.31 / 7.79 |
| Eddy 0.5x | .2262 | .9238 / .7738 | .00121 | .000308 | 1.83 / .947 | 1/395, 1/143 | 642 / 1.97 | .61 | 3.16 / 6.16 |
| Eddy 2x | .3082 | .8418 / .6918 | .00088 | .000479 | 1.79 / .918 | 1/401, 1/160 | 630 / 1.97 | .62 | 3.06 / 6.28 |
| Eddy 4x | .3917 | .7583 / .6083 | .00091 | .000795 | 1.77 / .909 | 1/396, 1/156 | 630 / 1.97 | .62 | 3.94 / 8.03 |

All configurations were numerically stable: no NaN, no negative concentration, and maximum full reagent/solid conservation error `9.8e-15` (far below `1e-12`). The first source cells are within 2.984 mm of impact for all 6.5 mm trials. Even 4x does not make a second concentrated component or a filamentary sheet. Although the 2x and 4x coefficients improve bulk conversion, they lower CV and generally lower S/V, meaning more spread and less spatial contrast. They are comparison settings, not physical coefficient estimates; none is accepted as a production default. A combined high-mix/high-eddy run was not warranted because both single-parameter trends point toward smoothing. The current baseline is the accepted configuration, so its PPM sequence serves both baseline and accepted state.

## Flow structure and impact position

The 10% and 50% iso-regions are single connected components in every 9 s run. At baseline the 10% region contains 402 cells, volume `2.52e-6 m3`, S/V `635 1/m`, and aspect `1.97`. The 50% region contains 153 cells, volume `9.59e-7 m3`. Skeleton endpoints were not computed; S/V and aspect are the explicit structure proxies. There is advection: 61% of fine mass is more than 3 mm from the impact by 9 s. The baseline mean absolute horizontal-plane vorticity proxy is `0.0122 1/s`. Its Richardson-like ratio is `92` at 9 s, using the model's tracer buoyancy gradient divided by squared vertical horizontal-velocity shear. It is a closure-based stability indicator, not a measured density Richardson number. The poured solution is modeled lighter and accumulates over heavier liquid, a stabilizing arrangement. The low vorticity and high ratio are consistent with the lack of resolved overturning, branching, and internal gaps. The grid width is 1.17 mm, the vertical spacing 4.60 mm, the contact patch radius 3 mm, the closure is radial, and the real impact is only 0.5 mm from the 7 mm inner wall. This resolves few cells across any fine extension and damps shear through projection and viscous closure. These numerical data do not establish a visual appearance in WebGL.

The separate impact diagnostic changes only the *event impact points* used in replay. It leaves `tubePourImpact.ts` and game geometry unchanged. The first local source stays within 2.984 mm for all three positions.

| Impact radius | Extent at 9 s | Overlap | Fine CV / TV | 10% region cells, S/V | Mean vorticity | Away |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 mm | .3356 | .000740 | 1.47 / 1.061 | 436, 552 1/m | .0013 1/s | .57 |
| 3.5 mm | .3077 | .000871 | 1.65 / .944 | 398, 622 1/m | .0115 1/s | .51 |
| **6.5 mm, game** | **.2576** | **.001114** | **1.82 / .930** | **402, 635 1/m** | **.0122 1/s** | **.61** |

The central impact reacts faster in this replay but creates a broader, rounder fine region with much lower vorticity. The wall-adjacent position has more asymmetric shear and concentration contrast but less conversion. Neither creates branches or holes at this resolution, so moving the game's impact is not recommended from these data.

## Artifacts and verification

Each of the nine configuration CSVs has 280 rows at 50 ms spacing through 14 s, including all reagent and solid classes, source statistics, overlap, contrast, vorticity, stability proxy, timing, positivity, and mass error. `summary.json` contains sampled row distributions, component volumes and CPU quantiles. The 35 baseline PPMs are central vertical slices at 0.5, 1, 2.5, 4, 6, 9 and 14 s for fine AgCl, Ag+, Cl-, local source and speed. Each channel uses a fixed grey scale across time (fine and ions `.002` per cell, source `.00005` per cell, speed `.02 m/s`); they are numerical images only, with no WebGL visual claim.

- `tsc --noEmit`: passed.
- Focused `wave11c3/mixing.test.ts`: 1 passed, 0 failed (corrected 1 mL initial condition); it asserts exact deterministic formation samples, first-source location, stepwise conservation, positivity and finite values across all runs.
- The first whole-suite run had 376 passed, 4 failed, 4 expected failures across 64 files. The final whole-suite run, after the corrected replay, had 371 passed, 9 failed, 4 expected failures across the same 64 files. Both runs retain the existing numerical failures: `wave4a/field.test.ts` surface-raft golden (`0.0024971` versus minimum `0.005`), `wave4b/PourStream.test.ts` endpoint (`0.255` versus `0.251`), and `wave6perf/flocPerf.test.ts` HIGH total (distance `0.05661764468314012` from golden). No production code changed, so this work does not alter those three numbers.
- The other six failures in the final run are timing-related: two 5 s `tubeReactionVisuals` tests, one 30 s `_g1_motion` test, and three `tubeVolumeField` tests (one soft CPU budget and two 5 s timeouts). Rerun together, the three files had 46 passed and 3 timeouts; `tubeVolumeField` passed 13/13. Rerun singly, `tubeReactionVisuals` had 33 passed and 2 timeouts, while `_g1_motion` timed out again. Earlier in the run `tubeReactionVisuals` passed 35/35 alone. These outcomes show substantial host load sensitivity, not a changed C3 code path. They remain validation limitations and should be rerun by the coordinator on a quiet host.

There is no integration blocker or requested production diff. A future improvement would need a separately validated subgrid contact/entrainment model or finer flow representation with measured morphology and CPU cost; merely increasing dissolved-ion numerical mixing is unsupported by this investigation.
