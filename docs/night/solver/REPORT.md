# Experiment 2: flow-solver audit, energy budget and viscosity comparison (CPU)

Code under test: `TubeFlowSolver` (staggered faces, explicit momentum step, SOR pressure projection) with the experimental density coupling. Tests: `tests/night/solver/solverAudit.test.ts` (harness in `harness.ts`), field-level audit in `tests/night/longrun/longrun.test.ts` (`AUDIT`, `NU`, `QUALITY`, `SFACES`). Energies are per unit reference density, volumes as the solver uses them (every wet cell is a full cell). Nothing here was seen in the game. The A/B recordings in the real Windows game have NOT been made (section 7).

## 1. How the solver is discretised (from the code)
- Momentum per step: first-order upwind advection of each face velocity by the cell-centred velocity, the per-step transfer clipped to 0.1 of the neighbour difference (so it follows at most 0.1 h/dt, about 2 mm/s); explicit Laplacian `dt * nu * laplace` with nu = `TUBE_SIMULATION.jetFlow.molecularDiffusivity` = 2e-7 m2/s (a tuned constant, 5 times below water's 1e-6, no documented reason) and Neumann (zero gradient) values where a neighbour is missing; a uniform Rayleigh damping exp(-0.26 dt) of all momentum; body force from the load; pressure projection by Gauss-Seidel/SOR (omega 1.65 when `iterations` is given, 1.0 and 6 iterations by default), pressure restarted from zero every step.
- Boundaries: faces towards a dry cell or the domain edge are zero (no flux through side walls, the curved bottom or the rigid lid: verified, max |u_n| = 0). Tangential motion is free-slip: there is no wall friction anywhere except the uniform damping, which acts as the wall-drag proxy. The curved bottom is a staircase of full cells; partial cells at the bottom and the surface count as full cells in the solver (volume 1 per cell).
- Viscosity integration: explicit, nu dt (1/dx2 + 1/dy2 + 1/dz2) = 0.09 (LOW) and 0.21 (HIGH) for nu = 1e-6, limit 0.5; stable for both values at both grids. 4e-6 would reach 0.8 at HIGH (unstable), so it is not a candidate.

## 2. Tests (all pass)
| test | result |
|---|---|
| no forcing | kinetic energy decays monotonically at LOW and HIGH (0 steps with growth); the energy falls below 1e-4 in 20 s |
| uniform density | exact equilibrium (|u| < 1e-12) at both grids |
| stable stratification | residual currents 0.06 mm/s (LOW) and 0.21 mm/s (HIGH): the staircase bottom is not exactly hydrostatic; this is a numerical boundary error of that size |
| viscous diffusion | small-flow decay rate 0.585 /s at 2e-7 and 0.796 /s at 1e-6, difference 0.211 against 0.148 predicted by nu k2 of the discrete mode (ratio 1.4); Rayleigh damping alone is 0.26 /s. At the scale of the tube the molecular viscosity is a small part of the damping; it acts at the grid scale (k2 about 1e7 1/m2: 2 /s at 2e-7, 10 /s at 1e-6) |
| overturning | heavy over light, 14 kg/m3: buoyancy work equals the released potential energy within 15 percent at both grids, energy dissipates (KE + dissipation + dPE < 0), the motion dies (KE below 1e-3 of the peak), scalar Courant at most 0.9; released PE 1.56e-9 (LOW) and 1.72e-9 (HIGH): grid difference 10 percent |
| projection | residual divergence max: 6 iterations 0.20 1/s, 120 iterations 7e-5 (LOW); HIGH needs more: 120 gives 1.9e-3, 400 gives 2.5e-6 |
| boundaries | no flux through walls, curved bottom or lid; wall-adjacent vertical velocity reaches 11.8 mm/s (free-slip) |

## 3. The numerical errors found
1. Scalar transport above its stability limit (class F, energy injection). The explicit donor-cell transport is single pass; during an overturn the Courant number reached 1.16 (LOW) and 4.36 (HIGH). The advected density then lags the flow while the buoyancy force acts on it: at HIGH the buoyancy work was 30 times the released potential energy (6.0e-8 against 2.0e-9 over 20 s) and a motion persisted with 10 times more dissipation than energy released. The solver already had sub-stepping of the fast faces for the physical stream; it is now also used when the density coupling is on (`classifyFast` for `load.iterations`). With it: work 1.8e-9 against 1.7e-9 released, max Courant 0.90, motion decays. Regression test included (the failure is reproduced by disabling the sub-stepping).
2. Aggregates advected with a non-divergence-free velocity (class C/E, grid-scale). `SectionalPopulation.transport` moved the aggregate mass with the average of the two cell-centred velocities, which is not divergence free on the staggered grid; the aggregate weight then piled up and drove the flow: in config D (net density + aggregation) the buoyancy work over 40 to 60 s was 5.5e-10 against 1.6e-11 released (34 times) and a circulation of mean |w| 1.1 mm/s (peak 10 mm/s) persisted for 180 s. With the aggregates advected by the solver's staggered face velocities (`__silverSectionFaces`, automatic with the density flag) the work is 2.4e-11, the flow decays to 0.08 mm/s peak at 60 s, and the energy budget closes. This also explains the earlier "viscosity sensitivity" of D: it was the symptom of this error, not a viscosity problem. The accepted aggregation without the density flag keeps the old advection (unchanged) and has the same inconsistency, masked by its weak tuned weight.
3. Projection iterations (class C). The baseline default of 6 iterations leaves 0.2 1/s of divergence under density forcing and injects energy (1.45e-8 against 2e-9 released at 20 iterations); the density flag uses 120, which is sufficient at LOW but not at HIGH (1.9e-3 1/s; 400 needed).
4. Staircase bottom (class D, small). Stable stratification leaves 0.06 to 0.21 mm/s of spurious current. The slow drift that remains at HIGH after the fixes (mean |w| 0.1 mm/s, KE 1e-13 against 7e-16 at LOW at 60 s) is of that size.
Not an error: continuing motion driven by real density differences (class A) was found only as the overturn itself and the sub-mm/s drift above; viscosity (class B) is not the cause of anything persistent (see 4).

## 4. Controlled viscosity comparison (with fixes; 2.5 mL + 1 mL; node, one core, sequential runs)
| grid | config | nu | centroid at 10 / 30 / 60 s, mm | mean abs w, mm/s | KE at 60 s | deposited at 60 s | step cost mean / p99 ms |
|---|---|---|---|---|---|---|---|
| LOW | B | 2e-7 | 7.40 / 7.34 / 7.26 | 0.389 / 0.018 / 0.005 | 7.3e-16 | 0 | 8.0 / 13.5 |
| LOW | B | 1e-6 | 7.11 / 6.96 / 6.88 | 0.285 / 0.019 / 0.005 | 5.0e-16 | 0 | 8.0 / 13.6 |
| LOW | D | 2e-7 | 7.77 / 7.77 / 7.70 | 0.446 / 0.018 / 0.005 | 6.0e-16 | 0.0096 | 13.9 / 27.7 |
| LOW | D | 1e-6 | 7.38 / 7.28 / 7.21 | 0.290 / 0.019 / 0.005 | 3.5e-16 | 0.0108 | 13.8 / 25.9 |
| HIGH | B | 2e-7 | 8.74 / 7.40 / 6.13 | 0.382 / 0.102 / 0.112 | 1.6e-13 | 0 | 20.3 / 34.7 |
| HIGH | B | 1e-6 | 8.21 / 6.72 / 5.49 | 0.317 / 0.107 / 0.089 | 6.6e-14 | 0 | 19.8 / 31.5 |
| HIGH | D | 2e-7 | 8.91 / 7.61 / 6.30 | 0.404 / 0.105 / 0.114 | 1.6e-13 | 0.0132 | 40.6 / 90.5 |
| HIGH | D | 1e-6 | 8.38 / 6.92 / 5.66 | 0.348 / 0.107 / 0.088 | 6.2e-14 | 0.0153 | 38.3 / 82.0 |
At LOW the two viscosities differ by 0.3 mm in the centroid and by less than 1e-3 of the motion after 30 s: once the numerical errors are removed viscosity no longer matters for the trajectory, and the measured step cost is the same (explicit term). At HIGH the 1e-6 run settles somewhat lower in kinetic energy (6.6e-14 against 1.6e-13). The viscosity stays at the baseline 2e-7 (no result depends on the change enough to justify touching the accepted baseline); water's 1e-6 is the physically defensible value and is available as the experimental `__silverViscosity`. HIGH costs 2.5 to 3 times LOW per step and is not suitable for the game; the game field is LOW.

## 5. Config D after the fixes (answer to "where does the persistent motion come from")
- Before: class C/E/F combined, mostly item 2 above (the energy injection was measured: work 34 times the released energy).
- After: motion decays (mean |w| 0.005 mm/s at 60 s on LOW; 0.1 mm/s at HIGH, the staircase level), the density-driven cloud settles into a stable stratified column, aggregates deposit slowly (0.0096 of the AgCl at 60 s, 0.063 at 180 s on LOW at 2e-7).
- D is therefore no longer blocked by the stop rule; it remains experimental.

## 6. What this changes for the cloud and for MesoCloud
With the numerical errors removed the density flow is a single, decaying overturn at both grids. On HIGH, the MesoCloud shadow run (x2) now has strain 0.23 1/s at 15 s (it was 17.7) and no fragmentation noise (components at 10/25/50 percent of the peak 1/6/6, was 1/13/54); the significant-region count is still one with no split or merge. So the earlier conclusion in `docs/night/meso/SHADOW_REPORT.md` that the flow solver prevented separation is replaced: a trustworthy flow field now exists and in it the fine cloud still does not separate significant regions in 40 s. Whether separation needs the pour jet, larger flocs or a different representation is open; MesoCloud is unchanged (per the instruction).

## 7. Real-game recording and FPS (NOT done)
No recording was made: the cloud container has no Windows game and the instruction not to run the browser here stands. The existing recorder only had developer spectator cameras (`DiagnosticCamera.tsx`), not the game's accepted close-up; a `game` mode (game camera, Q close-up) was added to `tests/_wave15/baselineRecord.mjs` and `tests/_exp2/runValidation.mjs` records A and B with FPS (`ONLY=A,B`, `CAMERA=game`). Procedure and checks: `docs/night/exp2/README_VALIDATION.md`. CPU step costs above are node timings; the game FPS is unknown.
