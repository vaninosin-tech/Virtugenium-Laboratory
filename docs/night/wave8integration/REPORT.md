# Wave 8 integration report

## Scope

Deterministic stage 3 delivery scenarios use the `tubeDelivery` ledger as the sole delivery input to `TubeSilverField`. The harness advances at 50 ms intervals without a browser or WebGL renderer.

## Known integration defect

`TubeSilverField.inject` in `src/scenes/laboratory/lib/tubeSilverField.ts` computes `topWetRow` from the continuous meniscus height and only gives weights to that row and the row below. Immediately after the meniscus crosses a voxel boundary, the mask may still have no active cells in those rows. `sum < 1e-20` returns without updating `delivered`, so valid ledger increments are missed. The field later catches up to some, but not all, of the ledger total.

Minimal repro: create a stage 3 `TubeSilverField("LOW", 0.007, 0, fieldHeight)` with `fieldHeight = max(0.055, tubeLiquidHeight(5, tubeEffectiveRadius(0.055)) + 0.007 * 0.25)`. Advance at 50 ms, pass cumulative `deliveredMl("receiving", "nacl")`, and set `level = tubeLiquidHeight(2.5 + deliveredMl, tubeEffectiveRadius(0.055))`. Record a valid surface event at each positive `pouredMl(t / 1700)` increment. At 850 ms the ledger is 0.301939080 mL but `field.delivered` is about 0.002019 mL.

`tubeDelivery.recordDelivery` currently does not update `tubeAmounts`. After seeding AgNO3 and recording 0.301939080 mL of valid NaCl events, remount seeding leaves `tubeAmount(ID).volumeMl` at 2.5 and `species["Cl-"]` at 0. The required values are 2.801939080 mL and 0.301939080 chloride, each applied once.

Expected failures retained with exact assertions in `tests/night/wave8integration/delivery.test.ts`:

- Valid surface impact: field delivery must equal ledger delivery through the full pour.
- Stop halfway: field delivery must equal the stopped ledger amount.
- Remount: the tube amount and a new field must reflect the ledger once, with no NaCl seeded from contents.
- Render interruption: the field must accept the cumulative ledger total after gaps.

The remaining four scenarios pass: before-surface rejection, tube miss, impact position movement, and liquid-level tracking. `events.md` contains the scenario 2 event table from the actual harness run.

## Integration request

The coordinator owns `tubeSilverField.ts`. In `inject`, select the actual highest active wet rows at the impact patch, or otherwise ensure the normalized injection weights remain nonzero as the meniscus moves between voxel centres. Preserve top-two-row placement and mass accounting. Agent 1 owns `tubeDelivery.ts` and `tubeAmounts.ts`; synchronize accepted events to amount state exactly once. Flip the four `it.fails` cases after the field and amount state accept all valid ledger increments.

## Verification

Files added:

- `tests/night/wave8integration/delivery.test.ts`: eight deterministic scenarios and the ledger-driven recorder helper.
- `docs/night/wave8integration/events.md`: actual event table from scenario 2.
- `docs/night/wave8integration/REPORT.md`: this report.

`node node_modules/typescript/bin/tsc --noEmit` passed. The targeted Vitest file passed with 4 passed and 4 expected failures. The full suite, run with `--configLoader runner --no-file-parallelism`, finished with 340 passed, 6 expected failures, and 4 failures across 350 tests (51 passed files, 4 failed files). Two expected failures are in other existing tests.

The four full-suite failures are outside this worker's ownership:

- `tests/tubeReactionVisuals.test.ts`: the stage-one tilt test timed out at 5 s. Rerunning that file alone gave 32 passed, 1 timed out (about 7.2 s for the timed-out test).
- `tests/night/wave4a/field.test.ts`: surface raft 0.002497 is below the asserted 0.005.
- `tests/night/wave4b/PourStream.test.ts`: stream end y is 0.255 rather than the expected 0.251.
- `tests/night/wave6perf/flocPerf.test.ts`: the HIGH total mass differs from the pinned expected value by 0.0551008466.

No visual claims. No files outside the owned test and docs directories were changed.
