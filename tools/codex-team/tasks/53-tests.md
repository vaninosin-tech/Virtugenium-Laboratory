# Worker "tests": proper tests for the stage-3 AgCl field (tests only)

Read `docs/AGCL_INTERFACES.md` (WAVE 6 OVERRIDE) and `docs/night/stage1/INVESTIGATION.md`. Stage 3 (`window.__silverStage = 3`; import the field dynamically after setting the window property and delete it in `afterAll`, see `tests/night/wave3flocs/flocSystem.test.ts`) uses `TubeSilverField` with a `FlocSystem` (`lib/night/stage1/flocSystem.ts`, read-only for you). You own only `tests/night/wave6tests/` and `docs/night/wave6tests/`, plus cleanup edits inside `tests/night/wave4a/` and `tests/night/stage1/`. Never edit `src/`. If a test exposes a real bug, describe it with a minimal repro in your report.

Write deterministic tests (HIGH grid, pour 1 mL over 3 s at the surface, level rising 0.0262 to 0.0278 m, stream strength 0.33, run to 14 s; see the stand `src/lab/experimentLab.ts` for the exact driving code):
1. Mass: flocs + fine suspension (`suspension[0..2]`) + sediment equals `extent` within 1e-9 at every step, also with a mid-run tilt (`up` = 0.45, 0.893, 0), a shake (agitation 0.8 for 15 steps) and a level change.
2. No NaN and no negative values in `suspension`, `coarse`, node masses and node positions. Node count never above 260. Pending mass is flushed.
3. Determinism: two runs give identical node positions.
4. Entrainment (protects the hydrodynamic fix): at 3 s more than 40 % of the newly formed AgCl forms deeper than 6 mm below the surface, at 8 s the passive tracer mean depth is above 3 mm, at 1 s the median node height is above 0.5 of the liquid height.
5. No pinning: no node stays within 0.6 mm of the surface with speed below 1e-5 m/s for 2 s.
6. Links yield plastically (rest length grows when stretched past `yieldStretch`) and break only when `allowBreakage` is true and the stretch exceeds `breakStretch`.
7. Setting `window.__silverStage` to another number leaves stage 1 behaviour (mass balance) intact.

Also repair, without weakening them, any test under `tests/night/wave4a/` or `tests/night/stage1/` that fails when the whole suite runs in one process because of leaked state (`globalThis.window`, tuning globals named `__silver*`): add cleanup in those files only. Report real counts. One vitest process at a time (`--configLoader runner --no-file-parallelism`), whole suite last.
