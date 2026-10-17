# Wave 7 pour report

No browser or video was available to this worker. The checks below are code and unit test results, not visual observations.

## Real game chain

1. A bottle action in `src/scenes/laboratory/lib/standTableActions.ts:143-155` calls `startPour`. `src/scenes/laboratory/lib/useStandMotionStore.ts:20-22,101-107` records its serial as `Date.now()`, runs the contents commit at 820 ms, and ends the 1700 ms motion. `src/scenes/laboratory/ui/StandMotion.tsx:332-337,383-412` chooses the side away from the rod, moves the bottle beside the current mouth, and tips it.
2. `src/scenes/laboratory/ui/StandStation.tsx:127-135` publishes `CLAMP_TUBE_MOUTH.point` and the tube root world matrix each frame. `PourStream.tsx:191-209` reads the bottle world transform, rotates the measured bottle mouth offset, and takes the lowest rim point as the lip. The target x and z come from the current mouth plus 6.5 mm toward the bottle side (`pourTarget`, `PourStream.tsx:127-134`). There is no fixed world injection coordinate.
3. For stage 3 NaCl into AgNO3, `isStageOneSilverPour` at `PourStream.tsx:106-110` selects the silver surface path. `silverStreamEnd` at `PourStream.tsx:121-125` computes `tubeLiquidHeight(volumeMl, tubeEffectiveRadius(0.055))` in tube local coordinates and transforms `(0,height,0)` through `CLAMP_TUBE_MOUTH.root`. The target uses that **world y** and the current near-side x,z. It is now on the computed liquid surface, with no former 4 mm downward offset. `PourStream.tsx:250-276` builds the free span from lip to this target; silver rings cover the entire span while the stream envelope is positive.
4. `PourStream.tsx:234-249` admits the incremental `streamDeliveredMl` only while the stream is drawn, then calls `publishTubePourImpact(point,direction,flowMlPerSecond,ml,serial)`. `tubePourImpact.ts:14-21` calls `deliver` and stores the cloned world impact and cumulative accepted millilitres for that serial. `tubeAmounts.ts:45-67` raises receiver volume and species; `tubeLiquidLevel.ts:1-24` maps its new volume to a new height. The bottle has no source volume registry or decrement.
5. `tubeReactionVisuals.ts:1117-1124` fetches the attached tube's impact and volume. Its local `level.value` is computed at line 1171 from the cavity bounding box and local slosh normal. At lines 1383-1400 the world impact is converted through the cavity's `worldToLocal`, x,z are clamped to 82% of the cavity radius, and inlet y is overwritten to the sloped local meniscus **0.7 mm below** it. Lines 1405-1413 pass the cumulative delivery, rate and local jet direction to `TubeSilverField.advance`. `tubeSilverField.ts:229-230,268-269` subtracts its prior `delivered` fraction and injects only the new amount. Its injector weights cells around the inlet (`tubeSilverField.ts:1070-1097`).

The world impact y is the tube root's transformed axial height. It is not numerically equal to the field's `level.value`: the former is in world coordinates, the latter is a local plane constant. With the authored 55 mm cavity and no slosh they describe the same surface after coordinate conversion. During slosh the consumer places the inlet on its current plane and 0.7 mm below it. The unit test covers 1, 2.5 and 4 ml and three rigid tube tilts to under 1 mm against the shared height function. It does not prove an exact match to an arbitrary authored cavity transform or a dynamic slosh state.

For silver pours, `flowMlPerSecond` is now `STANDARD_POUR_ML * pourFraction(k)^2 / (integral * POUR_MS/1000)`, an instantaneous ml/s rate. The other reactions retain their former `pourFraction(k)^2 * 4` jet-strength proxy to preserve existing behavior; their payload field name is dimensionally inaccurate. `ml` is each accepted increment. `deliveredMl` is cumulative accepted ml per serial. The silver field expects cumulative **0 to 1 standard-pour portions** and `jetStrength` in approximately ml/s: `TubeSilverField.advance` clamps delivery to 1 and its surface solver converts jetStrength with `1e-6` to m³/s (`tubeSilverField.ts:268,297-299`). Because `STANDARD_POUR_ML` is 1, the numerical delivery values currently match. A different standard portion would require conversion in the consumer.

## Tests

- `node node_modules/typescript/bin/tsc --noEmit`: passed, exit 0, after the final changes.
- Focused `tests/night/wave7pour/PourStream.test.ts` and `src/scenes/laboratory/lib/tubeAmounts.test.ts`: 10 passed, 0 failed. The new tests cover stage 3 selection, surface contact and clamp movement, positive delivery only while drawn, cumulative completion with the real end subscription's remainder rule, receiving volume and height.
- Focused run including the older `tests/night/wave4b/PourStream.test.ts`: 11 passed, 2 failed, 13 total. One failure was an initial test assertion fixed in the owned wave 7 test. The remaining old test expects the former 4 mm below-surface endpoint.
- Whole suite, one process, `--configLoader runner --no-file-parallelism`: 329 passed, 7 failed, 2 expected failures, 338 total across 53 files. Failures: three 5 s timeouts in `tests/tubeReactionVisuals.test.ts`; assertion failures in `tests/night/wave4a/field.test.ts`, `tests/_g1_motion.test.ts`, and `tests/night/wave6perf/flocPerf.test.ts`; and the obsolete endpoint assertion in `tests/night/wave4b/PourStream.test.ts`. This run preceded the final change that restored legacy non-silver gating; the affected owned tests and typecheck passed afterward. The full suite was not repeated.
- Standalone rerun of timed-out `tests/tubeReactionVisuals.test.ts`: 32 passed, 1 timed out (the stage-one tilt test). The other two timeouts passed when run alone.
- Final focused rerun after the last owned test assertion: 10 passed, 0 failed.

## Remaining issues and exact coordinator integration requests

1. `tubeReactionVisuals.ts:558-559` can seed NaCl directly from tube contents if a stage 3 tube remounts after the 820 ms contents commit without `options.pour` being true. This raises `tubeAmount` volume without a stream impact. `LabTestTubeInstance.tsx:118-135` derives `options.pour` only from a newly observed contents change. Keep NaCl excluded from stage 3 seeding, so only the real `publishTubePourImpact` path delivers it. Requested replacement:

   ```diff
   -    if (attached) seedTubeAmounts(attached.instanceId,
   -      options.pour ? attached.contents.slice(0, -1) : attached.contents);
   +    if (attached) {
   +      const seedContents = options.pour ? attached.contents.slice(0, -1) : attached.contents;
   +      seedTubeAmounts(attached.instanceId,
   +        silverStage() === 3 && attached.contents.includes("agno3")
   +          ? seedContents.filter(id => id !== "nacl") : seedContents);
   +    }
   ```

2. `tests/night/wave4b/PourStream.test.ts:10` encodes the rejected 4 mm subsurface endpoint. Requested exact test diff:

   ```diff
   -    expect(end.y).toBeCloseTo(0.251, 3);
   +    expect(end.y).toBeCloseTo(0.255, 3);
   ```

3. The `PourStream.tsx:143-181` completion path now requires an observed silver stream frame and uses its last impact, updated to the current surface, for the tiny tail. If rendering is fully suspended during the entire 0.35 to 0.76 pour interval, no silver impact is published, although `startPour` still commits the contents at 820 ms. A robust product fix needs the coordinator-owned stand or reaction lifecycle to defer the contents commit until an actual impact has been accepted, or to define a deterministic paused-frame completion policy. This cannot be resolved in the owned UI files without changing the game action contract.
4. Source bottles have no volume accounting. `deliver` changes only the receiver; no bottle amount is stored or decremented. The minimal cross-module change is a source-volume registry keyed by bottle instance, decrementing it by the **accepted** return of `publishTubePourImpact`, with an initial bottle volume policy. No source-loss result is claimed.
5. `tubeReactionVisuals.ts:1406-1410` correctly passes zero delivery for an unattached stage 3 tube. Other stages still use `smoothstep(ageSeconds)` when unattached. The non-silver branches at lines 1283-1284 and 1345-1347 also have unattached timer delivery. `sandbox/setupSandbox.ts:175-176` intentionally publishes a synthetic impact for diagnostics. These are separate from the stage 3 real player path.
6. The non-silver pour payload still labels its legacy jet proxy as `flowMlPerSecond`. Converting those experiments to physical units would change their simulations and requires separate coordinator review against the preservation rule.

No files outside wave 7 pour ownership were edited.
