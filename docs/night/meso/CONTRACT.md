# Experiment 2: mesoscopic cloud and consolidating deposit, prototypes

Status: CPU prototypes, not wired into the game, no flag enabled, nothing visually validated.

## Files and owners
- M1 (cloud morphology): `src/scenes/laboratory/lib/night/meso/mesoCloud.ts`, `tests/night/meso/mesoCloud.test.ts`.
- M2 (sediment, consolidation): `src/scenes/laboratory/lib/night/meso/consolidatingDeposit.ts`, `tests/night/meso/consolidatingDeposit.test.ts`.
- Neither touches the stream model, the solver, the stage-3 field or the pouring envelope.

## Interface contract
Mass ownership (one owner at a time): `M_total = M_suspended + M_aggregated + M_deposited`.
- `MesoCloud.addFromCoarse(amounts)`: takes AgCl formed in coarse cells. It is a refined copy of the fine suspension, not a reservoir. A consumer reads either the coarse field or `restrictTo(out)`, never both.
- `MesoCloud.advect(faces, dt, spacing, kappa)`: coarse staggered faces from `TubeFlowSolver`, conservative, non-negative, fast faces sub-stepped.
- `MesoCloud.components(fraction)`: connected-component count, the measurable form of separation.
- `ConsolidatingDeposit.deposit(column, kg)`: the ONLY entry of deposit mass. The caller must be the modelled settling or bottom-contact path (existing `SilverSedimentField` handoff). No timer or height feeds it.
- `ConsolidatingDeposit.consolidate(dt)`, `creep(dt)`: load-dependent void ratio and slope-limited creep, both conserve solid mass.
- Outputs for a renderer: `restrictTo` (cloud), `height(column)`, `bulkVolume()`, `meanPorosity()` (deposit). Bulk volume derives from mass, solid density and void ratio.

## Verified on CPU (tests/night/meso, 12 tests pass)
- Restriction returns exactly the added coarse amounts.
- Cloud mass conserved to 1e-12 over 400 steps in a closed vortex, no negative cells.
- A refined grid keeps a higher peak than the coarse grid in the same flow.
- A bar with a seed neck, pulled in x and squeezed in y by an imposed planar extension, splits (1 component to more than 1). Mass conserved. The flow is imposed, so this shows the grid can represent necking and separation, not that the real field does it.
- A shear of the bar gave a connected S shaped ribbon, no separation. Separation needs extension, not shear alone.
- Deposit: solid mass conserved to 1e-12 through deposit, consolidation and creep; a heavier column ends denser; void ratio never rises; bulk volume matches mass/rho*(1+e).

## Honest limits
- Deposit size: the 14 mg AgCl of the 1 mL + 1 mL case gives about 1.6 mm loose (e0=30) over a 5e-5 m2 floor, 0.94 mm after 5 h of the assumed law. The law parameters (e0, eC, sRef, m, tau) are placeholders chosen as soft-soil scale, not measured for AgCl. After 1 minute compaction is about 1 percent, so within the experiment time the deposit is loose.
- The cloud has not been run on the real field flows; the real velocity field has residual divergence (up to 34.7 1/s in top rows) so the shadow run may show leak-like artefacts that need checking first.
- No integration with `TubeSilverField`, no rendering, no performance measurement in the game. Cost of MesoCloud at refine 3 on the 12x24x12 grid: 82944 cells, not measured on Windows.
- Phase 0 (stream gate) still needs the user's Windows data; stream remains off by default.
