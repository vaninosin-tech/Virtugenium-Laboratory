# Worker "fluid": independent diagnostics, profiling and physics checks of the tube liquid solver

Read-only use of `lib/tubeFlowSolver.ts`, `tubeVolumeField.ts`, `tubePourImpact.ts`, `tubeLiquidLevel.ts`. You write NEW files only in your owned paths. If you find a solver defect, do not fix it: write a minimal failing test (marked `it.fails` or in a clearly named "known-defect" describe so the suite stays green) plus an integration request with the suggested diff in `docs/night/fluid/REPORT.md`.

Build, in priority order:
1. Deterministic harness (`src/scenes/laboratory/lib/night/fluid/harness.ts`): builds LiquidMask + TubeFlowSolver for a given fill/tilt, runs one continuous virtual pour of 1.0 ml and coasting afterwards, with an inert tracer. Reuse the setup pattern from `tubeFlowSolver.test.ts`.
2. Physics checks as vitest tests: tracer mass conservation and non-negativity/boundedness; no flow through walls and the hemispherical bottom; divergence of the projected velocity stays small; momentum injected by the pour is transferred to the liquid and flow keeps moving after the pour stops, then decays monotonically (viscous damping); a stream near the wall differs from the central stream (trajectory / centre of tracer mass); gravity-up change (tilt) is handled; liquid level rises with volume consistent with `tubeLiquidLevel`; determinism (same inputs, bit-identical outputs); LOW vs HIGH grid agreement of integral quantities within stated tolerances. Choose tolerances from measured behaviour and state them.
3. Profiling script (`tests/night/fluid/profile.mjs` or a vitest test that prints numbers): ms per `step` and `transport` at LOW and HIGH grids. Report only what you measured; no claims about real-time frame budgets beyond that.
4. Diagnostics report `docs/night/fluid/REPORT.md`: measured numbers, ASCII/CSV tables (no binary images required), pass/fail/pending per check, reproduction commands, defects found, integration requests.

Quality bar: every test must be able to fail for a real reason; no tests that only assert the code ran. Run the tests you added plus `npx tsc --noEmit` before finishing.
