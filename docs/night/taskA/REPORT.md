# Task A: missing near-surface AgCl, resolved to its cause in the model (CPU); fix and game check still open

Status: **cause identified, not fixed, not seen in the game.** The cloud session has no game rendering, so rendering is judged only from what the model hands to the renderer. No effect was added; no AgCl was put into air or surface cells.

## Harness
- `tests/night/taskA/depthDiagnostics.test.ts`: one pouring event (2.5 mL AgNO3 + 1 mL NaCl, the game's pour curve, 50 ms steps, ledger-rate jet strength, inlet on the highest wet voxel within 3 mm of the stream) on the LOW (game, 12 x 24) and HIGH (16 x 32) grids, aggregation off. Per row: wet fraction, Ag+ and Cl- concentration, incoming-NaCl tracer, AgCl formed this step (`productSource`), cumulative formed, fine suspension, net transport (change of the fine AgCl minus formation, so formation and carrying are separated), vertical velocity. Also formation by absolute height, the strain rate, and three mixing controls. Run with `--reporter=verbose` to see the tables.
- `tests/night/taskA/surfaceProfile.test.ts`: the same pour through the real `silverRuntime`.
Both only assert the mass ledger and one internal step per call. The aggregate-population mass is zero by construction in these runs (aggregation off); it is covered by the Task B runs.

## Result 1: where the AgCl forms (identical on LOW and HIGH)
Cumulative AgCl formation by absolute height at 1.7 s (surface 18.57 mm before the pour, 25.07 mm after):
- LOW: 9.4 mm 0.9%, 10.9 5.3%, 12.3 9.8%, 13.8 13.6%, 15.2 17.3%, 16.7 21.0%, **18.1 22.4%**, 19.6 7.3%, 21.0 2.0%; nothing above 21 mm.
- HIGH: same shape, peak 16.9 to 18.0 mm, 0.8% at 21.2 mm, nothing above.
All AgCl forms between about 9 and 21 mm. The peak sits at the **old surface (18.6 mm)**, with the jet's carrying of Cl- down to about 9 mm below it. Nothing forms in the 4 to 6 mm that the incoming solution adds on top.

## Result 2: formation, not transport, puts the AgCl where it is
The "net transport" column (change of the fine AgCl in a row minus what formed there) is within 0.3 of one step's formation and mostly below 0.1 during the pour, on both grids; the cumulative-formed share and the fine-AgCl share per row agree. The AgCl is not carried down from the surface: it forms at depth and stays. Row numbers counted from the top shift as the surface rises 6.5 mm, which made the earlier "AgCl sits 1 to 3 rows below the tracer" look like motion; by absolute height it does not move.

## Result 3: why nothing forms at the top: chemical overlap (the reagents do not meet there)
Mean concentrations in the top wet row (units where the whole tube holds Ag+ 1.15):

| time | Ag+ | Cl- | share of the step's formation in that row |
| --- | ---: | ---: | ---: |
| 0.70 s (LOW) | 1.05 | 0.16 | 60% |
| 0.85 s | 0.089 | 1.7 | 6.7% |
| 1.00 s | 0.028 | 2.3 | 1.4% |
| 1.35 s | 0.004 | 1.6 | 0.0% |
| 4.0 s | 0.002 | 2.6 | 1.0% |

HIGH: top-row Ag+ 0.029 at 0.85 s and 0.001 from 1.0 s on.
The top layer is NaCl solution with essentially no Ag+; the lower layers are Ag+ liquid with no Cl-; AgCl forms in the band where they overlap. Two causes inside the model:
1. **The incoming 1 mL raises the surface and arrives as an Ag+-free layer.** Rows that become wet when the level rises carry no Ag+ (correct for added NaCl solution). The first drops react with the Ag+ at the old surface within about 0.15 s (60% of the first step's formation is in the top row at 0.7 s) and use it up; the surface then rises over that AgCl.
2. **Vertical mixing is very weak, so Ag+ does not reach that layer.** Vertical velocities are about 0.1 to 1 mm/s; the strain rate has mean 0.1 to 0.7 and 95th percentile 1 to 3.6 s^-1 (peak 6 to 16 s^-1); the Ag+ in the top three rows is still 0.009 of its bulk value at 4 s. The plunging stream of the real pour mixes far more.

## Result 4: strong mixing alone is not the answer (existing options, not a fix)
LOW, same pour. Default: Ag+ in the top three rows 0.051 at 1.7 s, AgCl in the tube 0.170 (0.406 at 4 s). With the existing `__silverJetModel`: Ag+ reaches the top (1.5), AgCl in the tube 0.399 (0.865 at 4 s: the over-mixing found earlier), but only 0.1% of the AgCl is in the top three rows (1.9% at 4 s): the jet pushes it down. `__silverSubgrid` changes almost nothing (0.185 and 0.426). So the empty top is limited by overlap, and the one existing mixing model that fixes the overlap carries the AgCl away again and over-mixes the tube.

## Result 5: grid geometry (the 0.4 to 0.6 mm gap) is not the cause
- The gap between the last wet row and the surface changes sign and stays within half a cell: LOW -0.42 to +0.63 mm (cell 1.45 mm), HIGH -0.46 to +0.31 mm (cell 1.09 mm). That is the signature of `LiquidMask.update` classifying a cell as wet when its **centre** is below the surface (whole-cell wet/dry), not of a coordinate error.
- Partly filled cells exist (top-row wet fraction 0.55 to 0.96 in `LiquidMask.cellVolumeMl`) but chemistry and transport treat every wet cell as a full cell (`precipitatePair(..., m.activeCount, ...)`: concentration = amount x number of wet cells), so a partial cell holds and reacts as if full. This is a real inconsistency, not what empties the top: the AgCl is missing because Ag+ is missing, on both grids, including HIGH with the smaller gap.
- Shader side (read, not seen): `wet()` accepts points up to `uLevel + 3.5 mm` and the textures clamp to the edge, so the half-cell gap is covered in the render. Whether that looks right needs the game.

## Verdict
| Candidate | Finding |
| --- | --- |
| chemical overlap | **Primary cause.** Top layer has Cl- and almost no Ag+; AgCl forms 4 to 9 mm lower. |
| transport | Secondary: too weak to bring Ag+ up; the existing strong-mixing model carries the AgCl away and over-mixes. Existing AgCl is not carried down from the top. |
| grid geometry | Not the cause. Whole-cell classification gives a gap up to half a cell and partial cells are treated as full: a latent inconsistency, no effect on this finding. |
| rendering | Not the cause of the empty top: the renderer receives almost no AgCl there. Not examined visually. |

## Not done
- The fix. A physically motivated plunging-jet entrainment (Ag+ and the incoming solution mixed to a justified penetration depth, without the over-mixing of the jet flag) needs a decision and a check against the reference **stages**, not times; it must keep `M_fine + M_sections + M_nodes + M_pending + M_sediment = extent`.
- Game check (black background, optics modes) and the synchronized images and video: `docs/night/WINDOWS_VERIFICATION.md`.
