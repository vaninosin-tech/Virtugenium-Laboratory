# Wave 6 game renderer report

## Changes

- Experiment 2 selects the AgCl volume for silver stages 1 and 3. The default stage remains 1. Setting `window.__silverStage = 3` before creating the tube visuals now selects the stage 3 field and renderer together.
- The volume binds `uDense`, `uOverlap`, `uHaze` (fine suspension), `uTint` (water tint), and `uChip` (coarse fragments) to the field's five textures. Each update sets `uTime` to `silverField.ageSeconds` after advancing the field.
- The dense box height is `fieldHeight + 0.75 * radius`, matching the stand. Its render order remains `-0.25` so the stream can draw afterward.
- For a real NaCl impact, `jetStrength` receives `impact.flowMlPerSecond` in mL/s. `TubeSilverField` converts this to SI flow with `* 1e-6`. An attached tube without a NaCl impact gets zero stream strength; the existing unattached demonstration fallback remains 1 mL/s.
- The selection, bindings, geometry, and time update are guarded by the silver stage volume path. Experiments 1, 3, and 4 retain their existing material and mesh paths. A test compares their render-tree state and shader sources with the stage 3 selector on and off.

## Checks

- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/tubeReactionVisuals.test.ts`: 29 passed, 4 failed. Two existing AgCl integration tests timed out at the default 5 seconds. The two new tests initially failed because the test's Node window stub lacked `location` and timer methods.
- Reran that file alone after fixing the stub: `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism --testTimeout 20000 tests/tubeReactionVisuals.test.ts`: 33 passed, 0 failed.
- Full suite once at the end: `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism --testTimeout 20000`: 49 files passed, 2 files failed; 326 tests passed, 3 failed, 2 expected failures. The failures are field assertions in `tests/night/stage1/field.test.ts` (two) and `tests/night/wave4a/field.test.ts` (one). Neither file is owned by this worker, and the game renderer changes do not affect their direct field simulations.
- The full suite rewrote `docs/night/stage1/slices.txt`. It was restored byte-for-byte from `HEAD`; `git hash-object` equals `HEAD:docs/night/stage1/slices.txt` (`4094a6509b346c727ca6c57413cc4e34f4881d57`). Git still lists it as modified because its index refresh cannot create the worktree's external `index.lock` in this sandbox.

## Human review in the real game

No browser or visual comparison was run. With stage 3 enabled before experiment 2, inspect the rising cotton just above the water line, fine smoke and water tint during the NaCl pour, chips after agitation, and whether the pour stream remains visible in front of the volume. Confirm experiments 1, 3, and 4 visually against their existing reference behavior.

## Integration request

`src/scenes/laboratory/ui/PourStream.tsx` is outside this worker's ownership. Its `isStageOneSilverPour` currently returns true only for `stage === 1`, so stage 3 does not get the silver stream's render order 5, depth setting, and positioning. The owning worker should change its stage condition to `(stage === 1 || stage === 3)` while keeping its reagent and contents checks unchanged. The game volume stays at render order -0.25, but this selector is needed to preserve the stand's silver stream behavior in the full game.

```diff
-  return stage === 1 && (reagentId === "nacl" && contents.includes("agno3")
+  return (stage === 1 || stage === 3) && (reagentId === "nacl" && contents.includes("agno3")
```
