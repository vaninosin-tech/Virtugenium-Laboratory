# Wave 9 runtime report

## Files modified

- Added `src/scenes/laboratory/lib/tubeSilverRuntime.ts` and `tubeSilverGeometry.ts`.
- Changed `tubeDelivery.ts`, `tubePourImpact.ts`, `tubeAmounts.ts`, `pourIntoTube.ts`, `standTableActions.ts`, `useStandMotionStore.ts`, `useReagentStorageStore.ts`, `useTestTubeStorageStore.ts`, and `ui/PourStream.tsx`.
- Updated `standTableActions.test.ts`; added `tests/night/wave9runtime/runtime.test.ts`.
- This report. The four dirty files under `docs/night/stage1/` and `docs/night/wave7reagents/` were already dirty at worker startup and were not edited by this worker.

## Data flow and API

`useStandMotionStore.ts:103-114` exports `simNowMs()`, `setSimulationPaused(boolean)` and `onSimulationTick(listener)`. One 25 ms interval at lines 156-177 samples elapsed wall time into a monotonic simulation time. Paused time is excluded. A long timer stall advances elapsed simulation time on the next pulse. `pouredMl` caps the integral at one standard portion, and `stepTubePour` subtracts the previous cumulative value, so a stalled pulse requests only the remaining volume.

`standTableActions.ts:153-170,300-315` binds the clamped and held bottle pour to that timer. `PourStream.tsx:142-178` reads the same clock solely for drawing. Rendering, camera changes, and shader compilation are not on the delivery path. `tubePourImpact.ts:25-52,83-105` is the publisher: debit the source, validate and record the event, then apply receiving chemistry. `useReagentStorageStore.ts:84-87,135-146` owns source volume and event IDs; missed and overflow volume are debited, duplicate IDs are not. An empty source yields no event, and the visible stream is suppressed.

For stage 3 NaCl, `tubeSilverRuntime.ts:32-98` owns one lazily constructed `TubeSilverField` per receiving tube. It preflights capacity, tube slot and wet field cells; calls `deliver`; commits contents on the first valid event; inserts chloride with a 50 ms field step; and appends the event ID. `silverRuntime.tick(simMs)` advances later fixed steps from the simulation timer. `field(tubeId)`, `journal(tubeId)`, `diagnostics(tubeId)`, and `reset(tubeId?)` are exported on `silverRuntime`. Diagnostics carry all four first-event stamps, point, surface, volume and IDs. The physical point is transformed by the inverse clamp root; the numerical inlet is placed on the highest wet voxel beneath it. `clearTubeAmount` and tube replacement reset the field.

`tubeSilverGeometry.ts` centralizes the authored nominal radius 0.007 m, bottom 0 and height 0.055 m plus the same effective-radius and field-height formulas as the visuals. The visuals still derive their actual bounding box at mount, so the owner of `tubeReactionVisuals.ts` must connect those dimensions and the runtime field as described below.

## Tests run

- `node node_modules/typescript/bin/tsc --noEmit`: pass (final run).
- Focused final run: 4 files, 40 passed, 0 failed (`wave9runtime`, `standTableActions`, `useTestTubeStorageStore`, `tubeAmounts`). The new runtime file contributed 7 passed tests.
- Full suite, one process: 57 files, 52 passed and 5 failed; 355 tests passed, 5 failed, 6 expected failures (366 total). This was before the last held-tube callback edit; focused tests and typecheck were rerun afterward.
- Timed-out `tests/tubeReactionVisuals.test.ts` rerun alone: 33 passed, 0 failed.
- No browser or visual verification was performed.

## Integration requests outside ownership

1. `tubeReactionVisuals.ts` still creates a second field at lines 1072-1074, advances it at 1413-1442, and disposes it at 2057. The `verify` owner must use `silverRuntime.field(attachedTubeId)` for stage 3, allow that binding to become available after the first event, and skip render-time `advance` and `dispose` for the runtime-owned field. The required selection and stepping changes are:

   ```diff
   +import { silverRuntime } from "./tubeSilverRuntime";
   -  const silverField = kind === "silver-chloride" && hasLiquid
   +  let silverField = kind === "silver-chloride" && hasLiquid && silverStage() !== 3
        ? new TubeSilverField(/* existing arguments */) : null;
   +  // On each visual update, bind silverField to silverRuntime.field(attachedNow.instanceId)
   +  // when stage 3 is selected; update the volume-material texture uniforms then.
   -        if (ledger3 && ledger3.length) { /* render-time replay */ }
   +        if (silverStage() === 3) { /* read the runtime field; do not advance it */ }
   -      silverField?.dispose();
   +      if (silverStage() !== 3) silverField?.dispose();
   ```

   The texture rebinding is necessary because a visual can mount before the first valid event. It cannot be completed in this worker's owned paths. The visual's actual `radius`, `box.min.y`, `size.y`, and `fieldHeight` should also be passed to the shared geometry configuration before the first event or verified equal to its nominal constants.

2. The four `it.fails` cases in `tests/night/wave8integration/delivery.test.ts` cannot be flipped by a change to `recordDelivery`: that function is deliberately a ledger validator and the harness calls it directly, bypassing the only publisher. The test owner should replace the harness's direct `recordDelivery(...)` call in `step()` with `publishDeliveryEvent(input, context, new THREE.Vector3(0,-1,0), pourFlowMlPerSecond(k))`, create a receiving `StoredTestTube` slot in setup, and inspect `silverRuntime.field(ID)` rather than constructing and replaying a separate field. Then change all four `it.fails(` to `it(`. The field-location assertions may require the coordinator's `TubeSilverField.inject` fix below. No claim is made that those four pass yet.

3. The coordinator-owned `TubeSilverField.inject` currently returns without delivery if its top-row patch contains no wet cell (`tubeSilverField.ts:1076-1106`). The runtime works around this by selecting the highest wet voxel below the impact, but the old direct-field harness remains affected. The exact intended fix is to calculate `topWetRow` from the highest active voxel within 0.003 m of the inlet x/z, then use that row for `inPatch`; do not return when the physical meniscus falls between voxel rows.

4. `tests/night/wave8delivery/delivery.test.ts` reuses source ID `bottle` across tests without clearing source storage. Add `useReagentStorageStore.setState({ sourceMl: {}, debitedEvents: new Set() });` to its `beforeEach`. The current full-suite failure delivered 0.6980609197 mL because the prior test had consumed 0.3019390803 mL from that same one-millilitre NaCl bottle.

5. Three other unchanged assertions failed: `wave4a/field.test.ts:90` expects a 0.005 m surface raft but measures 0.0024971032 m; `wave4b/PourStream.test.ts:10` expects old y=0.251 m while calibrated `tubeLiquidHeight` gives 0.255 m; `wave6perf/flocPerf.test.ts:76` has an old HIGH mass snapshot off by 0.0551008466. Their owners should determine whether the expected values or physics need correction.

## Remaining limitations

- Stage 3 is not fully integrated into the real visuals until request 1 lands. A visual currently owns its own field and can diverge from the runtime field.
- The four Wave 8 expected-failure cases remain expected failures because their harness bypasses the publisher. This worker did not edit the non-owned test file.
- The owned regression tests cover atomic first impact, duplicate IDs, miss, source exhaustion, remount identity, pause, render absence, levels and mass conservation. They do not yet exercise every real experiment 1, 3 and 4 action through a complete 3D scene; those paths retain the same recipe in `tubeAmounts`, but final-volume equivalence was not proven end to end.
- The publisher now preflights the ordinary stage-3 refusal cases before recording a valid ledger row, and repeat wrong-order attempts still commit contents without duplicate penalties. There is no rollback if an unexpected exception occurs inside a store callback or the field refuses injection after the ledger record. A single transactional store API would close that last failure mode.
