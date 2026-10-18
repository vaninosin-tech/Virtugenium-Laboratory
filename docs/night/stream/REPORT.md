# Experiment 2: physical jet penetration and reactant overlap (experimental `window.__silverStream`)

Status: **implemented behind a flag, validated numerically in the cloud, not seen in the game.** The flag is off by default; the accepted baseline (stage 3, fine suspension, aggregation off, `__silverSubgrid` off) is unchanged and pinned by a test (AgCl extent 0.058 / 0.114 / 0.170 / 0.273 / 0.406 at 1.0 / 1.35 / 1.7 / 2.5 / 4.0 s, recorded before this code existed). The legacy `__silverJetModel` is untouched and is used only as comparison C. Nothing was merged into `main`.

Findings from the earlier diagnosis are kept and not repeated (`docs/night/taskA/REPORT.md`): the pour adds an Ag+-free layer on top, Ag+ is used up there, and most AgCl forms around the old surface.

## 1. What was built
| Piece | File | Role |
| --- | --- | --- |
| Event contract | `lib/tubeDelivery.ts`, `lib/tubePourImpact.ts` | New optional `sourceMouth` (tube mouth centre) on every `DeliveryEvent`, set by `stepTubePour`. Lets the stream be reconstructed deterministically when the measured lip `sourceOutlet` is missing. |
| Stream state | `lib/tubeStreamModel.ts` `streamStateFromEvent` | From the ledger flow Q of the 50 ms step, the lip (measured, else at the mouth plane straight above the impact point), the lip speed Q/A_lip, the free fall and the lip's horizontal motion: impact speed U = sqrt(U_lip^2 + 2 g h), area A = Q/U, radius, momentum flux rho Q U, direction. `source` says `measured` or `reconstructed`. |
| Jet | `TubeStreamModel` | Round submerged turbulent jet, integral top-hat form: `rho Q U = M` constant, `b = sqrt(Q/(pi U))` (so Q = A U at every depth), `dQ/ds = 2 pi alpha b U f_open` with alpha 0.057 and `f_open` the share of the jet perimeter that borders liquid (against the glass it is less than 1). No penetration depth is set: the jet continues to the bowl unless its Reynolds number U b / nu falls below 30. |
| Imposition | `TubeStreamModel.prepare` | Vertical face velocities Q(s)/(footprint area) on the wet columns overlapped by the disc of radius b (weights by overlap, only faces between two wet cells), plus the matching lateral entrainment inflow on the footprint boundary, so every horizontal layer balances. |
| Solver | `lib/tubeFlowSolver.ts` | The imposed faces are known fluxes: the pressure projection excludes them (no pressure coupling, no correction) and solves everything else, so the return flow and recirculation come from the incompressible solve. The baseline impulse and surface-spreading closures are off in this mode (the surface flow of a submerged jet converges, it does not spread outward). Turbulent decay of the resolved flow `exp(-dt C |u| / R)`, C = 0.1. Scalars are moved only by the resulting face velocities; faces with Courant above 0.9 are advected in sub-steps (up to 64), the rest in one pass. |
| Plumbing | `lib/tubeSilverField.ts`, `lib/tubeSilverRuntime.ts` | The runtime hands each 50 ms step's accumulated ledger volume and last event to the field (`streamState`, tube-local axes); only upright tubes use the model. |
Flag: `window.__silverStream = true` (or `{ alpha, dissipation }`). Precedence over `__silverJetModel`. Aggregation stays off.

## 2. Validation (all in the cloud; `tests/night/stream/`)
- **Contract:** Q = A U and rho Q U hold to 1e-12 for measured and reconstructed lips; free-fall speed; undefined without lip, mouth, validity or volume.
- **Integral jet:** momentum flux constant to 1e-9 along the jet, `b = sqrt(Q/(pi U))`, Q monotonic, bowl reached without a preset depth, shallower liquid gives a shallower jet, less entrainment against the glass.
- **Faces:** every imposed face lies between two wet cells (none into air or glass); the vertical flux of each layer equals Q(s) and does not decrease with depth; the imposed faces survive the projection unchanged; the flow outside the liquid is exactly zero; a recirculating return flow exists; the largest imposed cell speed (1.1 m/s) does not exceed the impact speed (1.57 m/s). The mean residual divergence stays below 2 1/s (it includes the intended suction of the incoming volume at the surface).
- **Real delivery path:** nothing chemical before the first valid impact (a missed stream debits the source, starts nothing); delivered = receiving gain = what the source still had; Ag+ and Cl- ledgers closed to 1e-9 at every snapshot; no material in dry cells; flow zero outside the liquid at all snapshots; AgCl never exceeds min(Ag+, delivered Cl-).
- **Opposite order and sandbox with the flag on:** NaCl first, sandbox NaCl alone, empty tube: no silver field, no Ag+. The isolation suite for the default mode is unchanged.
- **Baseline unchanged:** pinned AgCl extents above; whole suite: 533 tests, 531 passed, the same two old failures as before (`wave4a/field`, `wave6perf/flocPerf`), no new failure.

## 3. A / B / C with identical delivered liquid (LOW grid, game pour curve, 2.5 mL AgNO3 + 1 mL NaCl)
Reconstructed lip at the mouth plane: fall 13 cm, impact 1.57 m/s, momentum flux 3.2 mN, jet radius 0.55 mm at impact, penetration 20.5 mm (the bowl), entrained flow 4.3 mL/s (about 3 times Q), speed at the bowl 0.07 m/s.

| t (s) | A baseline AgCl | B stream AgCl | C legacy jet AgCl | A occupied cells | B occupied | C occupied |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.70 | 0.014 | 0.029 | 0.012 | 1.8% | 4.6% | 1.2% |
| 0.85 | 0.037 | 0.227 | 0.053 | 3.6% | 27.7% | 3.3% |
| 1.00 | 0.058 | 0.459 | 0.100 | 5.4% | 42.0% | 5.5% |
| 1.35 | 0.114 | 0.792 | 0.248 | 8.0% | 61.2% | 10.5% |
| 1.70 | 0.170 | 0.833 | 0.399 | 12.2% | 64.8% | 17.8% |
| 2.50 | 0.273 | 0.879 | 0.570 | 18.5% | 75.1% | 46.0% |
| 4.00 | 0.406 | 0.924 | 0.865 | 29.8% | 78.4% | 80.5% |
| 6.00 | 0.506 | 0.952 | 0.988 | 38.3% | 81.9% | 86.3% |
(AgCl is the fraction of the 1 mL chloride converted; the ledger allows at most 1.)

Where the AgCl forms (absolute height, share of everything formed up to 1.7 s; surface 18.6 mm before, 25.1 mm after):
- A: 11 to 21 mm, peak 18 mm (old surface).
- B: **0.7 to 17 mm, peak 3.6 to 6.5 mm (the bowl)**; 0.9% above the old surface, 0.6% above 21 mm.
- C: spread from 2 to 22 mm with a second peak at 18 mm; 21% above the old surface.

Newly formed against transported AgCl: formation is tracked per step (`productSource`) separately from the fine-suspension field. In B the AgCl formed along the whole jet path within each 50 ms step (Courant up to 39), so the fine field at the bowl is mostly newly formed there by Cl- that the jet carried down together with entrained Ag+; the later redistribution is the slow recirculation (below 0.025 m/s after 2.5 s).

Near the surface: in B the top three wet rows hold 0.3 to 1.6% of the AgCl while the pour runs (A: 34 to 72% early, 3.6 to 22% later) and 2.7 to 8.5% afterwards. The top rows are no longer Ag+-free (0.44 to 0.84 of bulk at 0.85 to 1.35 s against 0.04 to 0.7 in A), but the Cl- is carried away before it reacts there.

Other checks: largest cell speed in B 1.11 m/s (the imposed jet column, below the 1.57 m/s impact speed), 0.15 m/s at the end of the pour and below 0.03 m/s after 2.5 s; flow outside the liquid zero in all runs.

## 4. Robustness (inputs and coefficients, not tuning)
- **Lip height (the one unmeasured input):** fall 13, 6, 3, 1.5, 0.5 cm gives impact 1.6 to 0.32 m/s and momentum flux 3.2 to 1.1 mN. Penetration stays 20.5 mm (the bowl) in all cases; AgCl at 1.35 s 0.79 to 0.66, occupied cells 61 to 56%, share above the old surface 1.0 to 1.9%. The measured lip in the game (`sourceOutlet`) replaces the reconstruction.
- **Entrainment coefficient** 0.03 / 0.057 / 0.09 (literature spread): entrained 2.4 / 4.3 / 6.4 mL/s, AgCl at 1.35 s 0.66 / 0.79 / 0.89.
- **Turbulent decay** C = 0.03 / 0.1 / 0.3: AgCl at 1.35 s 0.79 / 0.79 / 0.80; at 2.5 s 0.89 / 0.88 / 0.87.
- **Grid:** HIGH 16 x 32: AgCl 0.52 / 0.80 / 0.88 at 1.0 / 1.35 / 2.5 s against 0.46 / 0.79 / 0.88 on LOW. No resolution increase was needed.
- The sub-step splitting of the transport (fast faces only) changed B by about 5% against a first all-faces version (0.83 to 0.79 at 1.35 s); the conclusions are unchanged.

## 5. Cost (cloud CPU, single thread; FPS cannot be measured here)
Per 50 ms step during the pour (median / 95th percentile / worst): A 7.1 / 23 / 42 ms, B 18 / 33 / 34 ms, C 16 / 50 / 50 ms of `advance` wall time. Of B: solver step 5.9 ms (of which pressure projection 5.1 ms with 120 iterations, face forcing 0.02 ms), stream preparation 0.5 ms, the rest is sub-cycled transport (median 44 sub-steps on the fast faces). The extra cost applies only while the stream is active (about 0.7 s per pour); afterwards the solver uses 40 projection iterations in this mode. Median and 10th-percentile FPS, and the worst frame time, must be measured in the Windows game (`NAME=stream INIT="window.__silverStream=true" node tests/_wave13/measureFpsPour.mjs` against `NAME=baseline`).

## 6. Answers to the stop condition
- **A. Does the stream now produce plausible reactant overlap?** It produces *physically coherent* overlap for the inputs the game supplies, but of the wrong kind for the near-surface white structure: with Q about 1.4 mL/s and a 0.3 to 1.6 m/s jet, the integral model entrains about 3 times Q within 20 mm, i.e. more than the tube holds during the pour. The reaction becomes **entrainment-limited and bulk** (79% of the chloride converted 0.65 s after the pour starts; 61% of the cells occupied at 1.35 s), not localized, and the AgCl forms along the jet path and at the bowl. This holds across the lip-height, entrainment, decay and grid brackets. It is not "near-instantaneous" at the first contact: the first 0.1 s still shows the AgCl near the stream (68% within 3.5 mm at 0.7 s), but it is on the jet path down to the bowl, not at the surface.
- **B. Do the upper white structures remain absent despite correct transport?** Yes, and more so than in the baseline: the top rows hold 0.3 to 1.6% of the AgCl during the pour. The empty-top cause identified before (Ag+-poor top layer) is removed, but the jet now carries the Cl- below the surface before it reacts.
- **C. Is the remaining discrepancy a particle-cloud representation problem?** Not established. The discrepancy with the reference, if the reference shows a near-surface cloud, is currently a *mechanics-input* question: the pour rate and the stream speed that reach the tube. The game's authoritative pour (1 mL in about 0.7 s on a smooth envelope, lip about 13 cm above the surface) is an input I did not change; with a slower, gentler pour (smaller Q U) the same model would penetrate less. I did not retune the jet and did not move to the mesoscopic representation: the stop condition ("transport correct but structures absent") is not met in a form that justifies it, because the transport result itself disagrees with the expected behavior and the dominant uncertainty is an input the Windows run can measure.

## 7. What is left for the Windows game
See `docs/night/WINDOWS_VERIFICATION.md` section 5: measured lip (`sourceOutlet`) and the real impact speed; flag-on recording against the reference stages; FPS; the render check for any near-surface AgCl; decision on the pour envelope if the reference stream is gentler.

## 8. Known limits of the model
Momentum flux conserved (pressure and weight neglected); free surface treated with the baseline mask (the added volume enters as new rows, the surface suction in the top row is the only inconsistency, below 2 1/s mean divergence); no air entrainment or foam; no stream breakup above the surface; entrainment from the surface layer is not distinguished from the side; the jet is straight; only upright tubes; wall friction on a stream against the glass is approximated only through the open share of the perimeter; LOW-grid jet column is one or two cells wide (HIGH agrees within the quoted spread).
