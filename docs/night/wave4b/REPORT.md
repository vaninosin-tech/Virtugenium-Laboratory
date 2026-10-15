# Wave 4B: stage-one AgCl pour stream

## Root cause and fix

`PourStream` ended 26 mm below the clamped tube mouth, while the liquid surface is roughly 95 mm below it at the initial 2.5 ml fill. Extending the stream to that surface makes its span exceed the existing 100 mm draw cutoff, which otherwise removes the entire mesh. The clear stream also used a low-alpha blue-grey colour and normal depth testing. The stage-one branch hides the separate internal film, air bubbles and splash, leaving no other visible indication of the incoming liquid. Its dense field is transparent with `depthWrite = false` at order -0.25; the liquid and glass are transparent, but the stream had no explicit order over them.

For stage-one AgCl only, `PourStream` now aims 4 mm below the measured liquid surface, allows the longer span, draws at order 5 with depth testing disabled, and uses a brighter, more opaque cyan-white shader branch. The existing non-silver endpoint, 100 mm cutoff, render order 0, depth test and shader calculation remain in use for experiments 1, 3 and 4. The tube reaction visuals still hide the film, bubbles and splash, and the dense volume mesh is unchanged.

## Verification

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed with zero errors after the final draw-predicate extraction.
- Focused Vitest: the first two runs each passed 2 files and 34 tests. After the final predicate extraction, a default-timeout run passed 32 tests and timed out in two existing AgCl simulation tests; a repeat with a verified 20-second test timeout also passed 32 and timed out in the same two tests under substantially slower execution. The new stream tests passed in all runs. Tests cover the stream endpoint, long-span draw predicate, draw order, material depth flags, silver selection, non-silver draw state, and the dense mesh's visibility and depth write.
- Final full Vitest, one process with a 60-second test timeout: 49 files, 47 passed and 2 failed; 321 tests, 316 passed, 3 failed and 2 expected failures. The two stage-one field assertions failed: early floor fraction was 0.01413 versus the 0.005 upper bound, and the wall-pour x center was 5.388 versus center-pour 5.425. Those field tests and implementation belong to fieldA. The third failure was the existing `TubeVolumeField` HIGH soft CPU budget, 20.64 ms versus its 20 ms threshold. The stream and reaction visuals tests passed in this full run. The run changed `docs/night/stage1/slices.txt`, which was already modified on entry and is outside pourB ownership; it was left untouched.

## Human browser check

Capture experiment 2 while pouring NaCl into AgNO3. Confirm a continuous narrow stream leaves the bottle lip, reaches the meniscus and continues a few millimetres into the liquid; confirm it stays readable against the white AgCl volume without drawing across the tube rim or bottle. Compare experiments 1, 3 and 4 against their prior frames. No browser was available in this worker, so visual appearance and GPU shader compilation are unverified.

## Integration

No changes to `tubeSilverField.ts` or `tubeSilverVolumeMaterial.ts` are requested. The fieldA stage-one test failures need resolution in that worker's owned files. The `TubeVolumeField` CPU-budget failure and intermittent reaction visuals timeouts need a quiet performance check; those paths were not edited here.
