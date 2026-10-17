# Wave 8 delivery report

## Files modified

- `src/scenes/laboratory/lib/tubeDelivery.ts`: global step deduplication and requested source volume in events.
- `src/scenes/laboratory/lib/tubePourImpact.ts`: validated publisher, time-based step and clock, stage-three legacy guard.
- `src/scenes/laboratory/lib/tubeAmounts.ts` and `tubeAmounts.test.ts`: stage-three NaCl seed guard and regression test.
- `src/scenes/laboratory/ui/PourStream.tsx`: silver delivery from the clock, drawing from the same target geometry.
- `tests/night/wave8delivery/delivery.test.ts`: fake-time delivery, misses, remount, level and total tests.
- `docs/night/wave8delivery/REPORT.md`: this report.

## Data flow

`useStandMotionStore.startPour` records a `Date.now()` serial and clears the pour after `POUR_MS` (1700 ms). `PourStream.tsx:155-176` resolves the attached tube and reagent, then starts `observePourClock` in `tubePourImpact.ts:53`. That clock samples every 30 ms and sends the capped stand timestamp to `stepTubePour` (`tubePourImpact.ts:80`). The step integrates `pouredMl`, measures the current `tubeAmount` surface with `tubeLiquidHeight`, transforms it by the tube root matrix, and aims 0.0065 m toward the mouth side. The corresponding drawing uses `silverStreamEnd` and `pourTarget` (`PourStream.tsx:121-132, 249`); `useFrame` at line 211 does not publish stage-three delivery.

`publishDeliveryEvent` (`tubePourImpact.ts:21`) calls `recordDelivery` (`tubeDelivery.ts:62`) before `deliver`; only a valid event updates the receiving volume, species, and `tubePourImpact`. The ledger rejects a repeated `(serial, step)` globally. Invalid events retain `requestedMl` for source accounting and contribute zero to `deliveredMl`. `seedTubeAmounts` (`tubeAmounts.ts:39`) ignores NaCl from AgNO3 plus NaCl contents in stage 3, even after a visual remount. The old publisher is ledger-backed for other experiments and rejects stage-three NaCl.

The stand uses wall-clock time. A throttled timer catches up on the next tick to the elapsed `pouredMl`, capped at one portion; natural completion applies the unsampled tail. Clearing `pour` before its deadline stops the timer without applying the tail. There is no game pause flag in the stand store: pausing rendering alone does not pause the stand clock. A true pause requires a paused elapsed-time field in `useStandMotionStore` and is outside this worker's ownership.

## Tests

- `node node_modules/typescript/bin/tsc --noEmit`: pass.
- Focused delivery, amounts, and wave 7 stream tests: 19 passed, 0 failed.
- Full suite, one process: 55 files, 51 passed and 4 failed; 345 tests passed, 4 failed, 2 expected failures (351 total). The `tubeReactionVisuals.test.ts` timeout passed when rerun alone: 33 passed, 0 failed.
- No browser or visual verification was performed.

## Coordinator integration requests

The source reagent store has no volume field. To account for misses and capacity overflow, add a per-container source millilitre balance to `useReagentStorageStore` and debit each step's `requestedMl`, including invalid events. Do not debit the admitted `ml` alone.

The 820 ms `startPour` callback in `standTableActions.ts` still commits `contents` even after a miss. The stage-three contents commit should be driven by the first valid delivery event, including when the first timer tick occurs after 820 ms. The amount and silver field are protected by the ledger, but `contents` can still claim NaCl after a miss.

Exact proposed `tubeReactionVisuals.ts` diff to read the ledger directly for stage-three silver input (the current impact object is already derived from a validated event):

```diff
@@ imports
+import { deliveredMl } from "./tubeDelivery";
@@ silverField.advance
-          attachedNow ? (impact?.reagentId === "nacl" ? impact.deliveredMl : 0)
+          attachedNow ? (silverStage() === 3 ? deliveredMl(attachedNow.instanceId, "nacl")
+            : impact?.reagentId === "nacl" ? impact.deliveredMl : 0)
```

Exact `tubeSilverField.ts` diff: **empty**. Its `advance` already consumes a cumulative delivery total and subtracts `this.delivered` at line 268. A new field instance can reconstruct from that total, but no new ledger event or receiving-tube `deliver()` call is produced by its construction.

`tubeReactionVisuals.ts:561` still calls `seedTubeAmounts` during visual construction. The stage-three NaCl guard makes that harmless for chloride, but eliminating all render-time baseline seeding would require moving the initial AgNO3 seed to its actual fill action, owned by the coordinator.

## Remaining issues

Three assertions in untouched tests remain failing: `tests/night/wave4a/field.test.ts:90` (surface raft 0.002497 versus minimum 0.005), `tests/night/wave4b/PourStream.test.ts:10` (old fixed surface height 0.251 versus calibrated 0.255), and `tests/night/wave6perf/flocPerf.test.ts:76` (old mass snapshot differs by 0.0551008466). The fourth full-suite failure was the 5 s timeout at `tests/tubeReactionVisuals.test.ts:262`, which passed when that file was rerun alone. The first full-suite run also timed out its test at line 410; both passed in the first isolated rerun (33/33). These files and the silver physics files are outside delivery ownership.

The full suite generated diagnostics in `docs/night/stage1` and `docs/night/wave7reagents`; they were restored byte-for-byte to the committed content and are absent from the final diff. No browser or visual result is claimed.
