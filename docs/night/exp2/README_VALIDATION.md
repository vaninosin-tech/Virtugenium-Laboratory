# Experiment 2: Windows validation procedure (no real-game recording exists yet)

Nothing in this branch has been seen in the real game. CPU slices and tables are not visual acceptance. To produce the recording:

1. `cd /d/Claude/vl-claude`, `git pull origin claude/epic-brown-yxujey`, `npm install` if `package.json` changed, start the dev server on port 5201 (`npm run dev -- --port 5201`).
2. Scenario of record (code default): 2.5 mL AgNO3 0.1 mol/L in the tube (Ag+ 0.25 mmol), then 1 mL NaCl 0.1 mol/L poured. `window.__silverAgnoMl = 1` restores the old 1 mL, do not use it here. Check in the console before pouring: `window.__silverDensity` must be `undefined` for A, and the flags below for B to D.
3. Four configurations (identical pour, camera and vessel), set in the console BEFORE the NaCl pour, or by the script:
   - A baseline: no flags.
   - B: `window.__silverDensity = { model: "net" }`
   - C: `window.__silverAgg = 1`
   - D: B and C together, plus `window.__silverDeposit = true` for the consolidating bed.
   Extra experimental switches (leave off unless asked): `window.__silverViscosity = 1e-6` (water, the baseline uses 2e-7), `window.__silverSectionSubcycle = 1`.
4. Camera, verified in the code: the existing recorder `tests/_wave15/baselineRecord.mjs` used only the developer spectator cameras `wide` and `close` (`DiagnosticCamera.tsx`: a side view across the bottle direction, camera 2 cm above its target, fov 30 or 20), NOT the game's own camera. A `game` mode was added: it leaves `__diagCamera` unset and presses Q to open the game's tube close-up (the horizontal side view of `CameraRig.tsx`). `runValidation.mjs` uses `CAMERA=game` by default. Check the first frames of the video: the tube must be seen horizontally from the side, filling the frame.
5. Scripted recording (A and B by default, with FPS): `node tests/_exp2/runValidation.mjs` (all four, 60 s of simulation at clock scale 0.5; `ONLY=A,D DURATION_MS=180000 SLOW=0.5` for 180 s; the 180 s run at 0.15 takes about 20 minutes). The recorder's "wide" and "close" cameras are its own; compare them with the accepted side camera first. If the video step fails (ffmpeg path), run ffmpeg by hand on `record/<camera>/frames/simulation.ffconcat`.
6. Manual alternative: Windows Game Bar (Win+G) or OBS on the game window with the side camera, one take per configuration, same length.
7. What to look at, in order: white AgCl forming; dense irregular regions; continued milkiness; stretching and deformation; narrowing and separation of regions; collective downward motion; bottom deposit; compaction of the deposit under additional loading. Send the videos, and the console lines `window.__silverDensity`, `window.__silverAgg`, `window.__silverDeposit` for each.
8. Performance: run `node tests/_wave13/measureFpsPour.mjs` with `INIT` set to each configuration (median and p10 FPS, worst frame, solver peak); the CPU numbers in the reports are node timings on one core, not game numbers.
