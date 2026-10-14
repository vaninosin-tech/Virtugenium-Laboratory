# AgCl overnight interface contract

Derived from the repository at the base commit of this run. Paths are relative to the repo root; library code lives in `src/scenes/laboratory/lib/` (abbreviated `lib/` below). Tests run with `npx vitest run --no-file-parallelism <path>`; typecheck with `npx tsc --noEmit`.

## Why workers are restricted
Another Codex session and other Claude sessions keep editing the main working tree (flow solver, pour channel, reaction visuals, experiment 1). Workers branch from a committed snapshot and cannot see uncommitted work. To avoid merge conflicts, no worker edits the shared production modules listed under "Coordinator-only". Work goes into NEW files, plus the narrow files each worker owns.

## Shared coordinate system and units
- Tube liquid is a voxel grid `LiquidMask(nx, ny, nz, radius, bottom, height)` in `lib/tubeVolumeField.ts`; SI metres and seconds. Typical tube: radius 0.007, height 0.055. Grid sizes: `TUBE_SIMULATION.jetFlow` (LOW 8x18x8, HIGH 12x24x12) in `lib/tubeSimulationConfig.ts`.
- Gravity direction is `VelocityField.gravityUp` (unit THREE.Vector3 "up" in tube-local space); `mask.update(up, level)` re-masks the liquid when the tube tilts or the level changes.
- Fixed simulation step: `TUBE_SIMULATION.field.stepSeconds` = 1/20 s. Amounts are normalized (1.0 is about stoichiometric reagent), see `lib/tubeAmounts.ts` (`TUBE_CAPACITY_ML = 5`, `STANDARD_POUR_ML = 1`).

## Fluid / pouring API (read-only for all workers)
- `TubeFlowSolver` (`lib/tubeFlowSolver.ts`): `constructor(mask, options)`, `refreshMask()`, `step(dt, inlet, direction, impulse, ...)`, `transport(values: Float64Array, dt, diffusivity)`, `diagnostics()`, `scalarDiagnostics(values)`; public `flow: Float32Array` (3 floats per cell).
- Pour channel: `lib/tubePourImpact.ts` (`publishTubePourImpact`, `tubePourImpact(id)`, `pourFraction`, `pouredMl`, `clearTubePourImpact`).
- Volume/level: `lib/tubeLiquidLevel.ts` (`tubeLiquidHeight`, `tubeEffectiveRadius`, `tubeLiquidFill`).
- Existing flow tests: `lib/tubeFlowSolver.test.ts` (pattern for mask + solver setup).

## Chemistry / solids API (AgCl draft; read-only except where owned)
- `lib/tubeSilverField.ts`: `class TubeSilverField(quality, radius, bottom, height, silverAmount)` with fields `species["Ag+"|"Cl-"]`, `suspension: Float64Array[3]` (size classes), `coarse`, `flocs: FlocAggregate[]` ({position, velocity, mass, porosity, shape, segregated?}), `tracer`, `productSource`, `sedimentField`, `pixels: Float32Array`, `texture: THREE.Data3DTexture`; methods `advance(dt, up, level, inlet, delivery, agitation, jetStrength, jetDirection)` and `diagnostics()` (suspended, coarse, settled, formed, massBalanceError, upper/lowerTurbidity, meanSpeed).
- `lib/tubeSilverSediment.ts`: `SilverSedimentField(nx, nz)` (conserved bottom reservoir: `values`, `deposit`, `release`, `settle`, `mass`) and `SilverSedimentGeometry` (render geometry following the hemispherical floor).
- `lib/tubePrecipitationPhysics.ts`: `precipitatePair(...)`, `settleParticleClass(...)`; `reactR2` in tubeSilverField.
- Mass rule: solid AgCl mass = suspension classes + coarse + flocs + sediment; total formed equals reagent consumed (`massBalanceError` near 0).

## Rendering API
- `lib/tubeSilverVolumeMaterial.ts`: `makeSilverVolumeMaterial(radius, bottom)` (raymarched suspension material fed by `TubeSilverField.texture`).
- Consumer: `lib/tubeReactionVisuals.ts` (coordinator-only). Public signatures above must stay stable.

## Module ownership and conflict resolution
- `fluid` worker owns: `src/scenes/laboratory/lib/night/fluid/`, `tests/night/fluid/`, `docs/night/fluid/` (all NEW; read-only use of production code).
- `agcl` worker owns: `src/scenes/laboratory/lib/night/agcl/`, `tests/night/agcl/`, `docs/night/agcl/` (all NEW isolated prototype and tests; read-only use of production code).
- `render` worker owns: `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`, `src/scenes/laboratory/lib/night/render/`, `tests/night/render/`, `docs/night/render/`, and the class `SilverSedimentGeometry` inside `lib/tubeSilverSediment.ts` (do not change `SilverSedimentField` or any exported signature). It consumes data produced by `TubeSilverField` and creates no particle/formation system of its own.
- Coordinator-only (nobody edits): `lib/tubeFlowSolver.ts`, `lib/tubeFlowDebug.ts`, `lib/tubeLiquidLevel.ts`, `lib/tubeAmounts.ts`, `lib/tubeReactions.ts`, `lib/tubeReactionVisuals.ts`, `lib/tubeLiquidMaterial.ts`, `lib/tubeSimulationConfig.ts`, `lib/tubePourImpact.ts`, `lib/tubePrecipitationPhysics.ts`, `lib/tubeSilverField.ts`, `lib/tubeVolumeField.ts`, `lib/tubeBarium*.ts`, `lib/tubePermanganate*.ts`, `lib/tubeNOBubbles.ts`, all UI, stores, `package.json`, lockfile, other experiments, drag/hover/pour controls.
- Needed changes to coordinator-only files go into the worker report as integration requests (exact suggested diff), never applied.
