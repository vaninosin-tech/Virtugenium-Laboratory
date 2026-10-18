# Task A: dense AgCl formations missing right below the liquid surface (CPU diagnosis only)

Status: **investigation started, not concluded, no fix**. Only the CPU model could be examined in the cloud session. Surface impact, meniscus clipping in the shader and volumetric rendering were read in the code but **not looked at in the game**, so nothing below is a visual finding.

## Harness
`tests/night/taskA/surfaceProfile.test.ts` drives the real stage-3 runtime (`silverRuntime`: validated delivery events on the game's pour curve, 50 ms fixed steps, the game's LOW grid 12 x 24 x 12, jet rate in mL/s) with aggregation off, and prints the vertical profile of the fine suspension and of the incoming-NaCl tracer for 2.5 mL AgNO3 + 1 mL NaCl. It asserts only the mass ledger. Run it with `--reporter=verbose` to see the printout.

## What the CPU model shows (aggregation off)
Cell height 1.45 mm; free surface 18.57 mm before the pour, 25.07 mm after.
1. **The precipitate is not where the NaCl enters.** At 0.8 s the incoming-NaCl tracer has 41% in the top wet row, while the fine AgCl there is 0.0% (46% sits one row down). At 1.0 s: tracer 29% in the top row, AgCl 0.5%. AgCl exists only 1 to 3 rows (1.5 to 4.5 mm) below the tracer maximum, and by 1.3 s (pour finished) the top row holds 0.0% and the first three rows below 3.2% of the AgCl, with the peak at 4 to 6 rows (6 to 9 mm) down.
2. **The surface layer stays thin for seconds.** Top-row share of AgCl: 0.1% at 1.7 s, 1.0% at 2.5 s, 3.8% at 4 s, 8.8% at 6 s, 17% at 10 s, 20.5% at 14 s. The top row becomes the densest only late (mean 1.3e-3 against about 0.8e-3 lower down at 14 s).
3. **Local concentration stays low in absolute terms.** The field has 1740 wet cells, so a fully converted, perfectly mixed tube would have 5.75e-4 per cell. The largest cell value anywhere is about 1.4e-3 at 1.3 s and 2.5e-3 at 14 s, i.e. never more than about 4.4 times the fully mixed value. Against the mean at that moment the contrast is large early (about 23 at 1.3 s: max 1.4e-3 against 6.1e-5) and small late (about 6 at 14 s). Whether this is too low for the dense curd of the reference cannot be said from the CPU numbers; the 1.45 mm grid smears the 3 mm contact patch over a few cells.
4. **The top wet row ends below the surface.** Row edges leave the free surface 0.41 mm above the last wet row at the end of the pour (0.63 mm at 1.0 s). The shader's `wet()` accepts points up to `uLevel + 0.0035` and the volume textures use clamp-to-edge, so what is drawn in that last half millimetre depends on the shader (not checked visually).
5. The Cl- is injected only into the top two wet rows within 3 mm of the inlet (`inject()` in `tubeSilverField.ts`); the product forms through `precipitatePair` and is then advected, so the lag in (1) comes from reaction/transport inside the model, not from the injection depth. The mechanism (kinetics against jet advection) was not separated.

## Not examined (needs the Windows game)
Whether the missing surface structure is visible in the render (shader sampling above the last wet row, `uLevel` against the real meniscus, the `ClampToEdge` lookups, the light taps), the bottle stream hitting the surface, and the HIGH quality grid (the runtime uses LOW; the diagnostic above is LOW only).

## Suggested next steps
1. In the game, record the pour with `window.__diag.setBackground("black")` and the optics modes (`setOpticsMode`) to separate extinction from scattering near the surface, and compare with this profile.
2. Test whether finer vertical resolution or a surface cell (partial wet row) changes the top-row share (the mask update is in `tubeVolumeField.ts`).
3. Separate kinetics from transport: switch off advection of the product in the first 0.5 s on a copy of the field and see whether the AgCl then appears under the tracer.
4. Any change here must keep `M_fine + M_sections + M_nodes + M_pending + M_sediment = extent` to 1e-12 and not force the reference video's timing.
