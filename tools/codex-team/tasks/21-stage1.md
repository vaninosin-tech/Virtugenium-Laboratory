# Worker "stage1": REBUILD of the AgCl representation, stage 1 only (primary cotton-like mass, in the mixing region)

The customer REJECTED the previous result. A human compared real frames: the liquid was uniformly milky from 2 s on (a "white column" with no origin) and the "flocs" looked like many identical grey capsule-like spots scattered over the whole volume. That is a decorative effect, not a physical precipitate. Stop refining it. Do not tweak the old implementation.

## Root cause you must remove
Aggregates are drawn as pools of identical instanced geometry (`silverCotton`, `silverLinks`, `silverBedCurds`, `flakes`, `curdGeometry` in `lib/tubeReactionVisuals.ts`, material in `lib/tubeSilverVolumeMaterial.ts`) plus a fine suspension that fills the liquid. Replace this representation. Discrete repeated instances must not be the primary representation of the precipitate any more.

## New representation (build exactly this stage, nothing more)
The dense, connected, wet-cotton-like precipitate is a CONTINUOUS 3D density field of the "dense phase", `dense(x,y,z,t)`, living on the existing liquid grid of `TubeSilverField`:
- Source: only where Ag+ and Cl- really overlap, i.e. the local product/consumption term already computed by `TubeSilverField` (`productSource`, `precipitatePair`). Mass-consistent: what leaves Ag+/Cl- appears in `dense` (stage 1 may route 100% of formed solid to the dense phase; fine suspension and sediment are later stages, keep the mass accounting exact: `dense + (everything else, empty for now) = consumed reagent`).
- Transport: advected by the real flow field via `TubeFlowSolver.transport` (same as the other scalars), gravity/settling of the dense phase with a drag that depends on local density (dense cotton sinks as a connected mass, not as separate pellets), deformation = stretching/curling follows from the advecting flow. No timers, no random scattering, no pre-placed positions.
- Rendering: a ray-marched volume of that field with sub-grid cotton detail: density = smooth threshold of (field value + domain-warped fractal noise) so the mass is irregular, connected, porous, with a visibly denser core and soft ragged translucent edges, curls and hanging strands. The noise must be anchored so it deforms WITH the mass (e.g. carry material coordinates / warp by the integrated flow) instead of swimming over a moving shape. White, no emission, mild soft self-shadowing (a few light samples toward the light) so the core reads denser than the rim. Bounded step count (state it), no per-frame allocation, no shader-compile stall at reaction start.

## Stage-1 diagnostic view (default ON for now)
Introduce `lib/silverStage.ts` exporting `silverStage()` which returns `window.__silverStage` if it is a number, else `1`. While `silverStage() === 1` experiment 2 shows ONLY:
1. the real pouring stream (existing `PourStream`, untouched),
2. the local mixing region, drawn as a faint tinted translucent volume from the product-source/overlap field (so a human can see where Ag+ x Cl- meet), clearly distinguishable from the solid,
3. the dense cotton mass.
It must NOT show: fine milky suspension (the liquid before/around the mass stays clear), instanced flocs/curds, sediment on the floor, fragments. Keep those code paths inactive in stage 1 rather than deleting working mass-accounting code; they come back in later stages.
Experiments 1, 3 and 4 must stay pixel-identical: every edit in shared files is behind the experiment-2 (silver) condition, smallest hunks; add a test or static check proving the non-silver paths are untouched.

## Acceptance (what the human will check on browser frames; you cannot run a browser)
- Pour starts: first a thin stream, then the white mass appears AT the point where the stream mixes with the liquid in the tube, and nowhere else. Before the stream arrives the tube is completely clear.
- The mass is one dominant connected cotton-like formation (denser inside, ragged soft edge, some strands), not a set of equal ovals; it is carried by the stream momentum, hangs/sinks and slowly deforms. No uniform milkiness.
- It differs between pours/orders only through physics (stream position and speed), never through a script.

## What you can and must verify without a browser
- Deterministic scenario tests: the mass appears only in cells where `Ag+*Cl-` overlap occurred; zero dense mass before the first reagent arrives; total solid mass equals the consumed reagent at every step (also after tilt/shake/level change); position of the centre of the dense mass follows the stream (compare wall vs centre pour); dense mass connectivity: one dominant connected component (count components above a threshold and report it); no NaN; determinism.
- A text diagnostic: ASCII slices (x-y and x-z mid planes) of `dense`, `Ag+`, `Cl-` and the overlap at several times after pour start, printed by a test and saved to `docs/night/stage1/slices.txt`, so a human can see formation and location without a browser.
- Unit tests of every pure function in the noise/threshold/density mapping (bounded 0..1, deterministic, no NaN).
- `node node_modules/typescript/bin/tsc --noEmit` clean; full suite one vitest process at a time, specific files first, the whole suite last; keep memory use low. Report real counts. All existing tests that are not about the old representation must stay green; if an old test asserts the old representation (instanced flocs), adapt it only where stage 1 intentionally disables that path and say so in the report.
Write `docs/night/stage1/REPORT.md`: design, parameters, numbers, tests, honest list of what you could not verify visually, and how to switch stages (`window.__silverStage`). Do not claim visual results.
