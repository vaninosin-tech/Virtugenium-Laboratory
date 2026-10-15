# Isolated AgCl cotton aggregate prototype

## Scope and mass rule

`AgclPrototype` is a standalone ledger and dynamics model in SI metres and seconds. It accepts a velocity sampler `(x, y, z) => [u, v, w]`, so a `TubeFlowSolver.flow` adapter or a deterministic mock can supply motion. It never changes production chemistry or rendering code.

The invariant after every pour, capture, erosion, resuspension, fracture, collision and deposition is

`sum(fine.mass) + sum(aggregates.mass) + sediment.mass = injectedMass`.

For an injected existing sediment field, `injectedMass` begins at its initial mass.

Mass is a normalized AgCl amount, matching the production field's solid reservoirs. Transfers use one computed amount for debit and credit. Tests compare the floating point residual to `2e-14` over 24 seeded runs, each with 25 pour parcels and 200 steps. Sediment uses `SilverSedimentField.deposit(column, mass)` and `release`, with the column index `iz * nx + ix`.

## Shape and dynamics

Each aggregate stores dry mass `m`, water void fraction `phi`, position and velocity, three ellipsoid axes, four low frequency radial modes, and a relaxing strain. A renderer can sample `surfaceRadius(direction)` for a smooth irregular body. The axes change before fracture; the radial modes give a lumpy wet cotton outline without crystalline spikes. The modes are sampled only from a seeded xorshift32 generator.

Effective radius is `0.00026 * cbrt(m / (0.01 * (1 - phi)))` metres. Thus equal dry masses expand as porosity grows. A sample of the local symmetric velocity gradient gives `gamma = sqrt(2 * D:D)`, where `D = (grad(u) + grad(u)^T)/2`; rigid rotation contributes zero. Viscous stress is `tau = shearViscosity * gamma`. Strain relaxes toward a shear and size dependent target at rate `3/s`, and porosity compacts with `dphi/dt = -0.0006 * gamma * (phi - 0.08)`. Axes elongate vertically with strain and contract laterally so their product stays one. These are deliberate visual simplifications; the prototype does not model orientation or a fully deformable mesh.

For slip, the density excess is `(1 - phi) * (rho_AgCl - rho_water)` using `rho_AgCl = 5560 kg/m^3`, `rho_water = 1000 kg/m^3`. Settling speed is the Stokes form `2 * densityExcess * g * r^2 / (9 * dragViscosity)`. Velocity relaxes toward sampled fluid velocity plus downward settling. `dragViscosity` defaults to `0.03 Pa s`, an effective unresolved drag, while `shearViscosity` defaults to `0.001 Pa s` for water shear stress. Applying the Stokes form to large, open aggregates and using separate viscosities are artistic approximations, not a calibrated AgCl material law.

Fracture occurs only when `tau` exceeds `0.045 * ((1 - phi)/0.4)^1.5 * (0.01/max(m, 0.0001))^0.18` Pa and mass exceeds `0.0002`. No elapsed age or wall clock enters this rule. The daughter receives a fraction of the parent mass and inherits velocity; parent mass is reduced by the same amount. Touching aggregates merge with mass weighted position, velocity, porosity and strain. The cap of 128 aggregates routes excess poured aggregate mass to the fine phase and suppresses further fracture, preserving the ledger.

The lower boundary is a hemispherical bowl, `bottom + radius - sqrt(radius^2 - x^2 - z^2)`. Aggregate contact transfers its full mass to a sediment column. Fine parcels also deposit on reaching the bowl. A deterministic scenario injects parcels over 40 steps at a moving source, with different masses and porosities; dense large pieces reach sediment while small porous pieces remain at multiple liquid depths.

## Verification

Run from the worktree root:

`node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism src/scenes/laboratory/lib/night/agcl/AgclPrototype.test.ts`

The extra config loader option prevents Vite from writing a temporary bundled config into the shared `node_modules` junction. The requested command without that option failed at startup with `EPERM` on `node_modules/.vite-temp`; it did not execute tests.

`node node_modules/typescript/bin/tsc --noEmit`

Final isolated run: 1 test file passed, 10 tests passed, 0 failed. The full TypeScript check completed with exit code 0 and no diagnostics.

Modified files: `src/scenes/laboratory/lib/night/agcl/AgclPrototype.ts`, `src/scenes/laboratory/lib/night/agcl/AgclPrototype.test.ts`, and this report. `git diff --check` returned exit code 0.

## Limits and integration requests

- The prototype uses upward local Y for gravity and a fixed liquid top. The coordinator must map `VelocityField.gravityUp` and the changing `LiquidMask` level if the tube tilts or drains. The floor and column indexing already match the upright production bowl.
- Shape modes and strain are absent from `FlocAggregate`. `fromFloc` and `toFloc` round trip all existing fields, but a production renderer needs a persistent sidecar keyed by aggregate identity, or these fields added to `FlocAggregate`. Reconstructing with `fromFloc` each frame would reset deformation.
- In coordinator owned `tubeSilverField.ts`, construct one persistent `AgclPrototype` with mask dimensions, radius, bottom, height, `sediment: this.sedimentField`, and a fixed seed. Adapt the flow array with nearest voxel lookup: `ix = clamp(floor((x/radius+1)*nx/2),0,nx-1)`, `iy = clamp(floor((y-bottom)/height*ny),0,ny-1)`, `iz` analogously, `i = mask.index(ix,iy,iz)`, return `[flow[3*i], flow[3*i+1], flow[3*i+2]]`. Keep this sampler live after each `solver.step`.
- Replace only the current floc motion, shear fracture, coalescence and floc deposition section of `advanceFlocs` with `prototype.step(step)` and presentation through `toFloc`. Move newly formed coarse mass out of `coarse[i]` exactly once into `prototype.pour(mask.point(...), mass, 1, porosity)` (or `addAggregate`) before stepping. Do not leave the same mass in `coarse` or `flocs`. Map the prototype fine parcels back into suspension cells or retain them as a separate ledger in `totalSolidMass`; do not count them twice. The injected sediment field already receives deposits, so no copy or second deposit is needed.
- In coordinator owned `tubeReactionVisuals.ts` or the render worker's owned rendering module, sample `effectiveRadius` and `surfaceRadius` plus axes/modes for a soft aggregate silhouette. Current production `FlocAggregate` consumers see only the adapter's base fields.

The prototype has no detailed porous fluid penetration, aggregate orientation, particulate size distribution, or interaction with changing free surface and tilted gravity. Its numerical parameters and deposition threshold need visual and laboratory calibration before production adoption.
