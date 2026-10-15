# AgCl render worker report

## Changes

- `src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts`: guarded the camera transform against zero-scale instances; made the 12-step optical-depth integration explicit; clamped density, optical depth, alpha, and output color. The existing floc instances supply all positions and scale. Their overlapping soft density lobes supply the cotton-like silhouette without an animated pattern.
- The worktree already contained `night/render/silverOptics.ts`, `tests/night/render/silverRender.test.ts`, and the `SilverSedimentGeometry` implementation at the start of this attempt. I left their exported signatures intact. The geometry samples deposited column mass, follows the hemispherical floor, compacts with `SilverSedimentField.compaction`, and has a bounded irregular top.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: passed, 0 diagnostics.
- `node node_modules/vitest/vitest.mjs run --no-file-parallelism --configLoader runner tests/night/render/silverRender.test.ts`: 1 file passed, 4 tests passed, 0 failed. These cover optical mapping, invalid inputs, finite and bounded sediment vertices, closed indexed topology, monotonic thickness in mass, and compaction.
- The required Vitest command without `--configLoader runner` failed before collecting tests: Vite tried to write its bundled config in the read-only shared `node_modules/.vite-temp` junction (`EPERM`). The runner config loader completed the same suite without writing there.
- Browser review: attempted headless Chrome with `tests/_review.mjs` against a Vite server using a cache in this worker's directory. `page.goto` timed out after 120 seconds while waiting for `load`. No frames were produced; no visual pass is claimed. The temporary review script, config, and cache were removed.

## Performance and limits

The floc material performs at most 12 midpoint samples per visible fragment of each instance. Each sample evaluates four smooth lobes and the tube floor clip. Cost therefore grows with overlapping flocs; the consumer currently caps its three volume pools at 360, 48, and 16 instances. There is no new simulation or texture allocation in this worker's change. The sediment geometry updates 561 vertices per frame and computes normals after update.

No LOW or HIGH browser image was obtained. A human should inspect both qualities against light and dark backgrounds during initial pour, dense suspension, and settling, checking for visible voxel bands, washed-out white, floating flocs, sediment shape, and frame time.

## Integration requests (coordinator-only files)

1. In `tubeReactionVisuals.ts`, the liquid backdrop's AgCl branch currently subtracts `0.4` from every `silverField.texture` sample and sets `scatteredLight` to blue-gray `vec3(0.63, 0.71, 0.76)`. For a milky suspension that remains visible at low density, use `max(0.0, texture(uBaField, uvw).r)` for AgCl and a bounded neutral white scattering color. Clamp the `background * 1.32` input and final mix to `[0,1]`. The existing `uBaField`/`uBaActive` uniforms already receive `silverField.texture`.
2. In `tubeLiquidMaterial.ts`, its AgCl optical paths likewise subtract `0.4` from the field and should be calibrated against the same Beer-Lambert extinction curve. Keep the shader density and color mix nonnegative and bounded to 1. This file is coordinator-owned.
3. In `tubeReactionVisuals.ts`, the sediment overlay creates a large mass-derived central proxy curd and four fixed satellites. It can dominate the mass-proportional `SilverSedimentGeometry` and resemble a dome. Draw the geometry as the primary layer and constrain or remove that overlay after visual review. This worker cannot edit the consumer.
