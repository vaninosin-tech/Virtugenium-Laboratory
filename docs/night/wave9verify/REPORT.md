# Wave 9 verify report

## Files modified

- `src/scenes/laboratory/lib/tubeReactionVisuals.ts`: Stage 3 looks up the runtime-owned field by tube ID, binds its five textures, and keeps the dense mesh hidden until the field exists. It no longer constructs, advances, replays events into, syncs chemistry from, or disposes that field. Stage 1 retains its former integrator. The existing shader prewarm has a per-renderer/program registry and a deferred, idempotent stand hook.
- `tests/tubeReactionVisuals.test.ts`: covers empty stage 3, runtime texture binding, remount reuse, no visual advance, warmup scheduling, and unchanged rendering state for experiments 1, 3, and 4.
- `tests/night/wave9verify/runtimeIntegration.test.ts`: guarded runtime integration assertion. It skips with an explicit reason until the runtime worker's module lands in a combined checkout.
- `tests/_wave9/captureRealGame.mjs`, `capturePure.mjs`, `capturePure.test.ts`: real-game action script, CDP screencast, frame-time and runtime diagnostics export, stamp formatting and ffmpeg command generation, with pure helper tests. Browser capture was not run here.
- This report.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: pass, zero errors.
- Focused Vitest run of visuals, capture helpers, and runtime integration: 36 passed, 1 skipped, 1 stage-1 tilt test timed out at the default 5 seconds. The timed-out visuals file was rerun alone with `--testTimeout 15000`: 35 passed, 0 failed.
- Earlier focused run of visuals and capture helpers: 36 passed, 0 failed.
- Full suite once with `--testTimeout 15000`: 354 passed, 3 failed, 6 expected failures, 1 skipped across 58 files. The three failures are outside verify ownership: `wave4a/field.test.ts` measured surface 0.002497 versus required 0.005; `wave4b/PourStream.test.ts` measured endpoint 0.255 versus required 0.251; `wave6perf/flocPerf.test.ts` measured total mass deviation 0.0551008 versus required below 1e-12. These are assertion failures, not timeouts.
- The CDP script and video output were not run or visually inspected because this worker has no browser.

## Integration requests

1. In `standTableActions.ts`, import `warmSilverShaderForStand` from `./tubeReactionVisuals`, then put this one-line call inside the bottle action callback immediately before `startPour`: `if (reagentId === "nacl" && clamped.contents.includes("agno3")) warmSilverShaderForStand();`. The visual update already calls the hook when an AgNO3 tube is attached. The hook queues prewarm on the next task and does not wait for it before delivery.
2. The runtime worker must expose the promised runtime on `window.__silverRuntime`, including `field(tubeId)` and `diagnostics(tubeId)`. Stage-3 visuals and the capture script use that global. The runtime module did not exist in this isolated worktree, so delivery, pause-clock, field-creation, and stamp integration assertions could not execute here. Run `tests/night/wave9verify/runtimeIntegration.test.ts` after combining the workers and reconcile the diagnostics stamp property names if the runtime API differs.
3. The full-suite failures above belong to field, PourStream, and floc physics owners. Verify did not edit those paths.

## Capture command

With the game server running, set `URL` and `OUT` as desired and run `node tests/_wave9/captureRealGame.mjs`. The script clicks the real sandbox actions using `runStandAction`, performs no manual prewarm, and writes JPEG frames, `frames/concat.txt`, `diagnostics.json`, and `ffmpeg.txt`. The latter contains commands to assemble and stamp the video. A screencast frame timestamp and a page `requestAnimationFrame` sample are both retained; gaps above 100 ms are listed with wall and simulation timestamps.

## Worktree scope

Four pre-existing dirty files outside verify ownership (`docs/night/stage1/slices.txt` and three `docs/night/wave7reagents/` files) were left untouched.
