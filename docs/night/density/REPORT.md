# Experiment 2: solution-density review and the corrected NET density model (CPU)

Scenario of record: 2.5 mL AgNO3 0.1 mol/L + 1 mL NaCl 0.1 mol/L, Ag+ 0.25 mmol, no jet. Flags: `window.__silverDensity = true | { model: "net" | "solid", scale?, cap?, iterations?, unitMol? }` (off by default; `net` is the complete composition model, `solid` the diagnostic). Tests: `tests/night/density/{accounting,lockExchange}.test.ts`, `tests/night/longrun/longrun.test.ts` (env `AGG`, `DENS=net|solid`, `DEPOSIT`, `CHECK`, `NDT`, `GROWTH`, `PROBE`). Nothing here was seen in the game.

## 1. Origin of the factor of about 100
It is not a units error. The solver applies `a = loadStrength * activeCount * loadWeight` (m/s2, times the 50 ms step) to the face velocities; units, gravity direction and the time step are consistent (see 2). The incoming-solution buoyancy in the accepted baseline is `buoyancy (0.1) * loadStrength (0.005 m/s2)` = 0.5 mm/s2 per unit of mean-cell tracer; both numbers are tuned constants ("tuned against the reference video", `tubeSilverField.ts`). The physical value for the same quantity is `g (rho_AgNO3 - rho_NaCl) / rho0 * V_NaCl / V_liquid`:
- 1 mL + 1 mL (old scenario): 48.6 mm/s2, ratio 97 (the "about 100").
- 2.5 mL + 1 mL (scenario of record): 27.8 mm/s2, ratio 56.
The in-code comment formula (about 9.8 in load units against the chosen 0.1) already showed the gap; it was a deliberate tuning, so the accepted baseline holds the incoming solution in a layer that physical density would not hold. Not changed in the baseline. The aggregate load `flocMass * 0.005` is likewise tuned: the physical AgCl load per unit concentration is about 6.6 times larger.

## 2. Consistency checks of the coupling
- Lock exchange in the real field and solver (heavy 0.1 mol/L AgNO3 left, water right, closed tube, no pour): peak horizontal speed 26.2 mm/s at full contrast against Benjamin's 0.5 sqrt(g' H) = 25.3 mm/s; 11.0 against 12.7 at a quarter contrast; 4.1 against 6.3 at 1/16 (more damped, as expected for small forcing). Baseline without coupling: 0.00. So density units, g, the Boussinesq normalisation (rho0 = 1010) and the explicit time integration reproduce the gravity-current scale.
- Stability of the explicit coupling: worst N dt (N^2 = g/rho0 d rho/dz over vertical pairs, capped densities) is 0.63 in the first seconds and 0.17 to 0.36 later, for aggregation off and on (limit about 2). Not the cause of the motion in section 5. Viscous damping 0.26 1/s, velocity cap 0.09 m/s (not reached, 26 mm/s peak), pressure projection 6 iterations by default (divergence about 1 1/s under physical forcing, so the flag uses 120: divergence 0.000).
- Solution densities: apparent molar excess masses reproduce tabulated 0.1 mol/L densities within 1.5 kg/m3 (AgNO3 14.2 vs 14.0, NaCl 4.2 vs 5.3, NaNO3 5.7 vs 6.3); an error of 1 kg/m3 is 7 to 20 percent of the contrast, so the absolute strength carries that uncertainty.

## 3. The net formulation and what was audited
Density excess of a parcel (kg/m3) is the sum over each species once: AgNO3 (Ag+ left), NaCl (Cl- left), NaNO3 (dissolved product, Na+ minus Cl-, from charge balance), AgCl solid (fine suspension plus aggregates, i.e. `flocMass` and the unresolved sections), relative to the receiving solution. Deposited AgCl is not in the liquid. Per mole converted, AgNO3 + NaCl -> AgCl + NaNO3 changes the parcel density by -0.0092 kg (about 5 percent of the reagent excess it replaces): the contraction. Omitting either the NaNO3 product or the solid breaks that neutrality by more than a factor of 5 (test). Audit of the earlier `net` option of `__silverFineWeight`: it did include the NaNO3 product, but it added to the tuned baseline loads (tracer buoyancy 56 times too weak, aggregate load 6.6 times too weak), so it mixed tuned and physical terms. The complete model (`__silverDensity`, model `net`) replaces both tuned terms; `solid` (solid weight added to the tuned loads) double counts and is kept only for comparison (it produces 65 mm/s flows, see below). Concentrations are capped at the 0.1 mol/L feed value for the density (injection puts amount in without its volume; the old injection reaches 18 times the mean), a guard on an injection artefact, not tuning.

## 4. A to D at 2.5 mL + 1 mL (units: 1 = 0.1 mmol AgCl; centroid in mm of 25.1; CPU node one core, runs in parallel so absolute times are inflated)
| config | t, s | fine | aggregate | deposited | centroid | share top / bottom sixth | fluid velocity (mass weighted), mm/s | max abs w, mm/s | density excess top / bottom, kg/m3 |
|---|---|---|---|---|---|---|---|---|---|
| A baseline | 10 / 30 / 60 / 180 | 0.96 / 1.0 / 1.0 / 1.0 | 0 | 0 | 21.9 / 23.4 / 23.8 / 23.8 | 0.79 / 0.99 / 1.0 / 1.0 (top) | +0.19 / +0.08 / +0.05 / +0.05 | 0.79 / 0.37 / 0.37 / 0.37 | 17.6 / 11.1 at 10 s, 33.7 / 2.3 at 180 s |
| B net, no aggregation | 10 / 30 / 60 / 180 | 1.0 | 0 | 0 | 7.4 / 7.3 / 7.3 / 7.0 | 0.02 / 0.31 | -0.04 / -0.003 / -0.003 / -0.003 | 1.9 / 0.24 / 0.08 / 0.08 | 7.2 / 18.5 (stable stratification) |
| C aggregation, tuned loads | 10 / 30 / 60 / 180 | 0.29 / 0.04 / 0.01 / 0.00 | 0.71 / 0.92 / 0.79 / 0.24 | 0.0005 / 0.036 / 0.199 / 0.754 | 6.4 / 1.3 / 1.0 / 1.65 | bottom 0.50 / 0.94 / 0.98 / 0.95 | -1.2 / -0.66 / -0.56 / -0.15 | 13.4 / 1.9 / 1.5 / 0.41 | 3.8 / 35 at 10 s |
| D net + aggregation | 10 / 30 / 60 / 180 | 0.30 / 0.13 / 0.07 / 0.03 | 0.70 / 0.87 / 0.91 / 0.89 | 0.0004 / 0.0034 / 0.0125 / 0.0821 | 7.8 / 7.1 / 6.95 / 6.8 | 0.01 / 0.27 to 0.03 / 0.38 | -0.16 / -0.34 / -0.36 / -0.36 | 6.3 / 10.1 / 10.3 / 11.9 | 7.4 / 17.1 to 8.0 / 19.5 |
| D solid (diagnostic) | 180 | 0.03 | 0.92 | 0.0477 | 8.4 | 0.03 / 0.19 | -3.5 | 67 | double counting |

Ledger error below 1e-13 everywhere. CPU, mean per 50 ms step under parallel load: A 4.6, B 9.4, C 9.9, D 15.0 ms; sequential 30 s runs earlier: A 3.9, B 8.1 (mostly the 120-iteration projection).

Reading:
- B (net, no aggregation): the surface-concentrated cloud overturns within 10 s and becomes a stable stratified milky column (18.5 against 7.2 kg/m3), the flow dies to 0.08 mm/s, nothing deposits (no slip relative to the liquid). Collective descent exists but only as a one-off overturn.
- C: aggregates (tuned weight 6.6 times too light) are carried to the floor within 30 s and 75 percent is deposited by 180 s.
- D: stratified, persistent suspension (89 percent still suspended at 180 s) and slow deposition (8 percent), which is the qualitative combination asked for. BUT its flow does not decay: max |w| 6 to 12 mm/s and mean |w| 1.4 mm/s persist for 180 s, while B decays to 0.08. By the stop rule this result is not accepted.

## 5. STOP: sustained motion in D, causes tested
Found: with the physical aggregate weight the aggregate (section) mass field develops grid-scale structure (neighbour-deviation roughness 0.14 at 5 s rising to 0.9 at 20 to 60 s, against 0.1 to 0.3 for the fine suspension and for B) and a circulation of about 1 cm/s persists in a stable stratification (N about 3.6 rad/s). The fastest cells sit just above the bottom layer, density rows 15 / 14 / 12 kg/m3 with +-1.7 kg/m3 horizontal spread. Tests, none of which used damping:
- shear kernel of the aggregation switched off: identical result (the shear term is negligible at these sizes);
- collisions switched off (sections only receive mass and move): identical roughness and flow, so the collision update is not the source;
- sections transport sub-cycled to Courant 0.12 (a single pass moves at most 12 percent of a cell per face per step, so it can follow only about 2.5 mm/s; implemented as `__silverSectionSubcycle`, automatic with the density flag): no change, so a lag of the aggregates behind the flow is not the cause;
- explicit-coupling stability: N dt at most 0.63, rejected;
- subgrid diffusion of the sections, kappa 1e-7 m2/s: no change; 1e-6 m2/s: the flow falls to about 3 mm/s but roughness still reaches 0.9 and the flow does not die.
Not established: what sustains the circulation. Known: it needs aggregates carrying physical weight, it is absent for the fine suspension alone, and the aggregate population has no subgrid mixing of the kind the fine suspension has (diffusivity 1e-9 plus the eddy term). Candidates for the next step, each needing its own test: (a) insufficient mixing of the aggregate fields (concentration-field resolution and diffusion), (b) a one-step lag of the aggregate load (`flocMass` is rasterised after the flow step), (c) the first-order clipped donor-cell transport of the sections. No tuning iteration was run. Consequence: configuration D and the sediment numbers from D are provisional; A, B and C are unaffected.

## 6. Decisions needed
- Keep `net` as the preferred direction (agreed) but not as a default: B is clean, D is not.
- Whether to give the aggregate population the same subgrid mixing as the fine suspension (physically motivated, but a model change, not a check).
- The baseline tuned buoyancy stays; the 56 times gap is documented, not corrected.

## 7. Addendum: viscosity of the momentum solver
The flow solver diffuses momentum with 2e-7 m2/s (`TUBE_SIMULATION.jetFlow.molecularDiffusivity`), 5 times below the kinematic viscosity of water (1e-6) and with a uniform damping of 0.26 1/s. With the corrected density and aggregation (config D) the sustained mean |w| at 60 s is 1.1 mm/s at 2e-7, 0.42 mm/s at 1e-6 and 0.008 mm/s at 4e-6 (experimental `window.__silverViscosity`, default unchanged). So part of the sustained motion in D is under-damped grid-scale motion; at water's viscosity it remains at about 3.9 mm/s peak. Viscosity 4e-6 is above water's and above a Smagorinsky estimate at this grid (about 2e-7 to 4e-7), so it is a diagnostic, not a proposal. D stays provisional; the question to settle is the momentum damping of the solver at the grid scale. The same sensitivity appears on the HIGH flow grid with net density (MesoCloud report, section 5).
