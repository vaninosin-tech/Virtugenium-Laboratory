# Worker "agcl": isolated prototype of deformable, porous, cotton-like AgCl aggregates

The shared fluid/chemistry interfaces are unstable (another session is editing the solver). Build an ISOLATED prototype and tests in your owned paths; do not modify `tubeSilverField.ts` or any production file. Study `lib/tubeSilverField.ts` (`FlocAggregate`, `advance`), `tubePrecipitationPhysics.ts` and `tubeSilverSediment.ts` first, and design the module so it could be adopted later behind a small adapter.

Prototype requirements (`src/scenes/laboratory/lib/night/agcl/`):
- Aggregate model: mass (conserved), porosity, effective size and drag derived from porosity, an anisotropic soft shape (e.g. ellipsoid plus low-frequency irregular deformation modes) so it reads as wet cotton: irregular, porous; not a snowflake, not a hard rock.
- Dynamics from an INJECTED velocity sampler `(x, y, z) => [u, v, w]` (works with `TubeFlowSolver.flow` or a mock): gravity, drag, buoyancy of the porous body, shear estimate from the local velocity gradient. Deformation first (elongation/compaction driven by shear and porosity); fragmentation only when shear stress exceeds a strength that depends on aggregate properties; no timers; fragments conserve mass exactly; collision/aggregation conserve mass.
- Mass exchange among fine suspension, aggregates and bottom sediment is exactly conservative (state the invariant, test with floating-point tolerance across many random seeds). Hemispherical bottom boundary: aggregates deposit into sediment columns like `SilverSedimentField.deposit`.
- Aggregates at several depths from one continuous pour (inject mass over time at a moving source). Show non-uniform settling (sizes/porosities settle at different speeds; some stay in the upper liquid while others reach the bottom early) in a deterministic scenario with a mock velocity field.
- Seeded RNG only; fully deterministic.

Tests (`*.test.ts` beside the module or under `tests/night/agcl/`): mass conservation, fragmentation independent of wall-clock/start time, deformation precedes fragmentation, non-uniform settling, boundedness/no NaN, determinism, adapter round-trip to/from the `FlocAggregate` shape.

Write `docs/night/agcl/REPORT.md`: model with equations and parameter meanings, what is physically motivated vs artistic, test results with real counts, limitations, and the exact adapter/integration requests for coordinator-only files. Run your tests and `npx tsc --noEmit` before finishing. Do not fake results.
