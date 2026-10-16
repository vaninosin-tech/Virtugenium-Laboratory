# Playbook: bringing a lab experiment to match a reference video (method used for experiment 2, AgNO3 + NaCl)

For an agent that has NOT seen the conversation. Read all of it before touching code. It is the method, the traps, the
customer's rules and the tools. Section 9 applies it to **experiment 1 (Cu + dilute HNO3)**.

Repo: `D:\Claude\virtugenium-lab-transfer\virtugenium-lab-transfer` (React + Three.js, virtual chemistry lab).
Experiment 2 work lives in worktree `D:\Claude\virtugenium-night\wave3-codex-worktrees\20261015065213-4364\stage1`
(branch `night/wave4-int`). Do NOT touch the main working tree, the user's uncommitted files, or other Codex/Claude
sessions. Work in your own `git worktree`, own branch, never merge/push on your own.

## 1. What the customer wants (rules that were learned the hard way)
1. The reference video is the ground truth. "Looks plausible" is not acceptable; **side by side with the video, same
   seconds, full frame** is the only judge. Tests, typecheck, mass balance prove nothing about the picture.
2. Real physics, not tricks: no timers, no scripted timelines, no age-driven behaviour, no scattering of pre-placed
   objects, no decorative particles. Behaviour must emerge from flow, gravity, drag, reaction kinetics, conservation.
3. Mass/amount conservation is exact (reagent consumed = product present, every step, also under tilt/shake).
4. Rendering must not own chemistry: the picture is a view of simulated state.
5. Work in stages; do not start the next stage before the customer accepts the current one. Report honestly:
   say what does NOT match. Never write "looks like the video" unless you looked at frames of YOUR code.
6. Do not rewrite unrelated experiments (1, 3, 4 must stay pixel-identical unless it is your experiment). Edits in shared
   files go behind an experiment-specific condition, smallest hunks, with a test proving other paths are unchanged.
7. Never spend effort on shader polish before the motion/structure logic is right (customer order: logic first).
8. Use the customer's own words as requirements and record each correction (they are right more often than your model).

## 2. The loop that worked (seconds per iteration)
1. Extract reference frames (ffmpeg) and **describe the video second by second** (what forms where, in what shape, what
   moves how). Check for **time-lapse labels** in the video (experiment 2 had x1 / x5 / x50 labels): map video time to
   real time before comparing anything. Never map playback timestamps onto simulation timers directly.
2. Build a **stand** (a small separate page, dark background, camera straight at the tube, simulation LEFT, video RIGHT,
   shared time axis, scrubber, video/real time map, diagnostic views). See `experiment-lab.html` + `src/lab/experimentLab.ts`.
3. Make the stand render **your simulation code**, not a copy of it. Take screenshots at fixed seconds with Playwright and
   build contact sheets with ffmpeg (`tests/_lab2.mjs`, `tests/_metric.mjs`). Look at the full frame next to the video.
4. Change ONE mechanism, re-render, compare, keep or revert. Commit each state (so you can go back).
5. When a result is wrong, first find the **root cause in the code** (read it), and add a **diagnostic view** that shows the
   cause (tracer, source term, nodes/links, grid data). Experiment 2 lessons below came from diagnostics, not from guessing.

## 3. Traps that cost many hours (check these first)
- **Wrong server / wrong code in the frames.** Other sessions run vite on ports 5190-5195. Use an unusual port, read the
  server log for "ready", and fetch a file from it to confirm a marker string of YOUR diff before trusting frames.
  Hidden-started servers die silently on "Port already in use".
- The vite config needs `server.fs.allow: ["D:/Claude"]` because `node_modules` is a junction into the main tree.
- Windows: use `path.resolve`, `node node_modules/typescript/bin/tsc`, `node node_modules/vitest/vitest.mjs run
  --configLoader runner --no-file-parallelism`. PowerShell 5.1 `Set-Content` re-encodes UTF-8 files: edit with node.
- Memory: Chrome + the game + two vite servers starve the machine; background jobs get killed. Close what you do not need.
- Codex agents have no browser: give them numeric acceptance criteria and have a browser-capable agent judge frames.
  Codex also hits a usage limit; its logs then say "usage limit ... try again at HH:MM".
- Ray-march banding looks like rings/stripes in the data. Show the raw grid (`?view=dense`) before changing physics.
- Per-cell "settling / packing / angle of repose / height caps" give SAND (layers, flat piles, terraces). Wet cotton or
  curd needs cohesive, deformable, porous aggregates carried by the liquid.
- Hand-tuned buoyancy/jet constants can switch mixing off completely (a too-strong buoyancy kept the poured solution in a
  2 mm layer and AgCl formed only there). Check the tracer depth profile and where the product forms.
- A node/particle budget that dumps the surplus mass on the nearest node grows one giant blob. Merge, do not pile up.
- `undefined` written into a Float64Array becomes NaN silently (index past length). Test finiteness every step.
- Time-lapse video: do not compare a late video frame with a late real second; map it.

## 4. Architecture used for experiment 2 (reuse the pattern)
Hybrid Eulerian-Lagrangian:
- Eulerian grid (`lib/tubeSilverField.ts`, `lib/tubeFlowSolver.ts`, `lib/tubeVolumeField.ts`): fluid velocity (staggered
  faces, projection), dissolved reagents, passive tracer, fine suspension. Reaction source from supersaturation
  (`lib/tubePrecipitationPhysics.ts`, `precipitatePair`) consumes reagents exactly.
- Lagrangian floc system (`lib/night/stage1/flocSystem.ts`): nodes (sub-clusters) joined by links; carried by the local
  fluid velocity plus a slip from gravity-buoyancy-drag for a porous aggregate (Df about 1.9, solid fraction falls with
  size); links yield plastically (no elastic recovery) and break only past a strength; contact packing; compaction by
  LOAD (never age); erosion of fine particles from loose parts into suspension ("smoke"); mass handed over exactly.
- A hydrodynamic closure for a plunging jet (`SurfaceSpread` in `tubeFlowSolver.ts`) plus buoyancy of the lighter poured
  solution; both validated by a passive tracer BEFORE enabling the reaction.
- Renderer (`lib/tubeSilverVolumeMaterial.ts`): ray-marched volume of the density that follows the aggregate structure;
  noise adds only small-scale detail; per-pixel jitter and enough steps against banding.
- Stand views: `?view=material|tracer|source|nodes|dense` (diagnostics 1-5), `?t=` seek, `?pour=`.
Parameters live in named constants and `globalThis.__silver*` overrides for quick tuning from the console.

## 5. Staged plan the customer required (keep this order)
Test A fluid tracer only (entry, slowing, spreading, circulation, after the pour stops) -> Test B where the product is
generated (diagnostic source view) -> Test C large aggregates with fragmentation DISABLED: deformable, irregular,
transported, not rigid, not sinking too fast, visible at several depths -> Test D controlled breakup (force exceeds link
strength; mass transfers to smaller aggregates / fine suspension; deformation before separation) -> Test E surface
persistence and bottom accumulation without anchoring anything -> Test F fine suspension, optical density, sediment,
final comparison video. Evidence for each: changed files, mechanism, a continuous video (front and side), numeric
mass-conservation diagnostics, remaining limitations.
Strict rejection: sand-like behaviour, one rigid falling mass, anything disappearing by a timer, fragmentation depending
on age, a flat lid/shelf, a tall narrow pile, mainly isolated round spots, turbulence rendered independently of mass,
reference used for appearance only and not for motion.

## 6. Tools (all in the stage1 worktree; copy or adapt)
- `experiment-lab.html`, `src/lab/experimentLab.ts`: the side-by-side stand. Reference video is `public/ref/<name>.mp4`
  (not committed to git; copy it). The video-to-real-time map is a small table at the top of the file.
- `tests/_lab2.mjs`: Playwright screenshots at `TIMES=1,2,...` (env `OUT`, `VIEW`, `POUR`, `KEEPOPEN`, `VOFF`).
- `tests/_metric.mjs`: crude white-profile score against the video (only a hint; the eyes are the judge).
- `D:\Claude\virtugenium-night\shot.ps1`, `lab.ps1`: helpers to render contact sheets.
- Contact sheet recipe: `ffmpeg -i t3.png -i t6.png ... -filter_complex "[0]crop=330:770:150:0,scale=250:-1[a];..;hstack=N"`.
- Continuous comparison video: screenshots every 0.2 s, rename to f001.png..., `ffmpeg -framerate 5 -i f%03d.png
  -c:v libx264 -pix_fmt yuv420p out.mp4`.
- ffmpeg path: `C:\Users\Aiyrell\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe`.
- Codex team runner (parallel Codex workers in worktrees): `tools/codex-team/run.mjs`, task files in `tools/codex-team/tasks/`,
  `docs/AGCL_INTERFACES.md` for file ownership. Give Codex tests, wiring, numeric physics; keep shader and visual
  judgement with the browser-capable agent.

## 7. Protocol for every iteration
1. Read the code you are about to change; do not claim a mechanism without reading it.
2. Change one thing. `tsc --noEmit` clean. Targeted vitest, full suite last, one process at a time.
3. Render stand frames at the same seconds as the video; put frame and video next to each other; look at the FULL frame.
4. Write down what matches and what does not (numbers where possible). Commit. Tell the customer honestly.
5. Update tests that asserted a representation you intentionally replaced; mark each with a comment saying why.

## 8. Facts about the customer and process
- Language: Russian. Short replies, no flattery, no emojis, no em-dashes in prose; say plainly what is not done.
- They watch the stand in their own browser (`http://127.0.0.1:<port>/experiment-lab.html`); keep a vite running for it.
- They want the next result only after their confirmation of the previous stage, but allow "continue in order without
  asking" when they say so explicitly.
- Their corrections to the physics model of experiment 2 (all were right): cotton must be cohesive, not sand; the stream
  creates the cotton, not trapped air; the solution is poured ONTO the surface; new cotton displaces the old downward;
  smoke comes from the loosest parts and tints the water slowly; cotton must harden into a curd heap, not accumulate in
  the column; the liquid column of the reference is about two tube diameters; the video is time-lapsed.

## 9. Applying this to experiment 1 (Cu + dilute HNO3)
Starting material in the repo:
- Reference video: `C:\Users\Aiyrell\Downloads\copper_room_temperature_reference.mp4` (640x780, 10 s). First extract
  frames every 0.5 s, check for time-lapse labels, and describe it second by second (copper piece, bubbles of NO on the
  metal, blue Cu(NO3)2 colour spreading in streams, colourless NO turning brown NO2 in the air/at the mouth, heating if
  any). Customer rule from the docs: experiment 1 is the customer's top priority and was tuned by Codex rounds already.
- Docs: `docs/codex/EXP1-sources-and-flow.md`, `docs/codex/EXP1-plumes-spec.md`, `docs/codex/32-exp1-dilute-nitric-realism.md`,
  `docs/realism/chemistry_four_experiments_corrected.md`, `docs/realism/local-reaction-onset.md`,
  `docs/realism/game-rules-amounts.md`, `docs/codex/HANDOFF.md`. Code: `lib/tubeVolumeField.ts`, `lib/tubeFlowSolver.ts`,
  `lib/tubeNOBubbles.ts`, `lib/createCopperPile.ts`, `lib/tubeReactionVisuals.ts` (copper path), `lib/tubeLiquidMaterial.ts`.
- There is already a `tests/_review.mjs` (game-based Playwright capture with `EXP=1`, `HEATED=1`) and a diagnostics hook
  `window.__exp1Diagnostics`. Do not break experiments 2-4.
Plan: (1) frames + second-by-second description + side-by-side stand for experiment 1 (the stand pattern needs a copper
sphere/pile and NO bubble representation instead of a precipitate); (2) diagnostics: tracer of the blue plume, source of
Cu2+ at the copper surface, where NO bubbles nucleate and how they rise; (3) mechanisms from physics (dissolution rate at
the metal surface, density-driven plumes of the heavier blue solution sinking, gas bubble growth/detachment/buoyancy,
NO + O2 -> NO2 in the headspace and its diffusion); (4) staged acceptance exactly as in section 5, adapted: liquid
colour field -> bubbles -> gas -> final. Judge only by frames next to the video.
