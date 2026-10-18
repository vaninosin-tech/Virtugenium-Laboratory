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

## 9. Correction: the real game starts with 1 mL of AgNO3, not 2.5 mL
The first AgNO3 portion that the game pours into the tube is the standard 1 mL (read in the Windows game: `tubeAmount(...).volumeMl = 1` after the AgNO3 pour); 2.5 mL is only the seed for contents that predate a pour. The tables above, the Task A profile and the lip-height / coefficient brackets were computed with a 2.5 mL start. The comparison was rerun with the real 1 mL start (`INITIAL_ML=1`, same pour curve, LOW grid):

| t (s) | A baseline AgCl | B stream | C legacy jet |
| ---: | ---: | ---: | ---: |
| 1.00 | 0.092 | 0.455 | 0.177 |
| 1.35 | 0.183 | 0.706 | 0.462 |
| 2.50 | 0.410 | 0.896 | 0.823 |
| 4.00 | 0.585 | 0.969 | 0.966 |
Stream penetration 10.9 mm (the bowl; the liquid is 8.7 mm deep before the pour and 17.4 mm after), entrained 2.4 mL/s, impact speed 1.63 m/s. The conclusions of section 6 hold: the physical stream gives entrainment-limited bulk overlap, not localized near-surface overlap. The pinned baseline numbers in `compare.test.ts` are for the 2.5 mL start (default); run with `INITIAL_ML=1` to reproduce this table (that run fails the pinned-baseline assertion on purpose).

Review aid for judging the liquid: `?agnoMl=3.9` or `window.__silverAgnoMl = 3.9` scales the live AgNO3 pour to that volume (0.5 to 3.9 mL); off by default.

---

# 10. Review iteration: scenario, numerical coupling, free surface (answers to the eight decisions)
Everything below is CPU-only in the cloud, on the verified scenario **1 mL AgNO3 + 1 mL NaCl** (LOW grid, game pour curve, aggregation off, liquid 8.7 mm before and 15.3 mm after the pour). `__silverStream` stays experimental and off; the baseline, the pouring envelope and the legacy jet are untouched (default runs reproduce the pinned baseline numbers). Test files: `tests/night/stream/coupling.test.ts`, `surface.test.ts`, `final.test.ts`; Windows script: `tests/_stream/tracePourInputs.mjs`.

## 10.1 Priority 1: the actual scenario and pouring inputs
- **Scenario confirmed from the runtime.** After the AgNO3 pour the Windows game reported `volume: 1` (`tubeAmount`), and the code adds the NaCl portion as the standard 1 mL (`STANDARD_POUR_ML`). So the acceptance scenario is 1 + 1 mL. The 2.5 mL tables of sections 3 to 6 were a geometry-sensitivity case and must not be compared with the 1 mL results (section 9 already reran the comparison).
- **Pouring inputs are NOT yet validated.** The 13 cm fall, 1.6 m/s impact and 3 mN momentum flux came from the reconstructed lip (mouth plane). Nothing here is a measurement. `tests/_stream/tracePourInputs.mjs` (read-only; run it in the Windows game) records for every ledger event: simulation time, measured or reconstructed outlet position and source type, free-surface height, the fall (measured, reconstructed and used), outlet speed, impact speed (and the reconstructed one), delivered increment, Q(t), impact area, momentum flux, impact position and direction, receiving volume, solver and stream-preparation time, and checks the scenario before the pour. Output `<OUT>/<NAME>_pour_trace.json/.csv`. If the animation does not supply the lip for an event the row says `reconstructed` and the console warns; those rows are not measurements.

## 10.2 Priority 2: does "transport sub-steps, then react once" misplace the AgCl?
Audit of the order in `TubeSilverField.advance` (stream mode): delivery/inject Cl- -> stream faces + projection -> Ag+, Cl-, tracer transport (slow faces in one pass, fast faces in up to 64 sub-steps) -> fine suspension transport -> **precipitation once per 50 ms** -> floc system. So yes: in one step Cl- is carried through the jet column before any reaction is evaluated. A coupled option was added (experimental, `window.__silverStreamCoupling = n | 'auto'`, needs the stream flag): the step is cut into n sub-steps, each transports Ag+, Cl-, tracer and fine AgCl with the frozen faces and then reacts with dt/n (same kinetics, same stoichiometry, same flow). Controlled study (identical flow: the passive-scalar buoyancy feedback is switched off in this study, identical delivered mass, identical grid):

| run | reaction interval | AgCl @1.0 / 1.35 / 2.5 / 4.0 s | centroid of newly formed AgCl (mm) | within 3 mm of the surface | L1 of the formation profile vs n=128 |
| --- | --- | --- | ---: | ---: | ---: |
| accepted split | 50 ms, once | 0.455 / 0.706 / 0.896 / 0.969 | 6.18 | 2.6% | 0.032 |
| coupled n=2 | 25 ms | 0.444 / 0.720 / 0.943 / 0.988 | 6.14 | 4.1% | 0.046 |
| n=4 | 12.5 ms | 0.472 / 0.787 / 0.957 / 0.991 | 5.98 | 3.5% | 0.055 |
| n=8 | 6.25 ms | 0.474 / 0.783 / 0.956 / 0.991 | 6.05 | 3.2% | 0.034 |
| n=16 | 3.1 ms | 0.474 / 0.783 / 0.956 / 0.991 | 6.11 | 3.2% | 0.020 |
| n=32 | 1.6 ms | 0.470 / 0.781 / 0.955 / 0.991 | 6.17 | 3.5% | 0.011 |
| n=64 | 0.8 ms | 0.471 / 0.781 / 0.955 / 0.991 | 6.23 | 3.7% | 0.002 |
| n=128 (reference) | 0.4 ms | 0.470 / 0.780 / 0.955 / 0.991 | 6.24 | 3.7% | 0 |
Final liquid depth 15.3 mm, vertical cell 1.45 mm. Mass conserved to 1e-13 and no negative concentration at every resolution.

Against your thresholds:
- **Between the two finest (n=64 and 128), all four pass:** total AgCl differs 0.0%, centroid 0.01 mm (limit: one cell 1.45 mm and 5% of the depth, 0.77 mm), near-surface share 0.1 percentage points, L1 0.002.
- **Convergence is demonstrated from n=4 on:** the L1 error against the finest run falls 0.055, 0.034, 0.020, 0.011, 0.002 (n=4 to 64). It is not monotone at the coarse end (n=1 and 2 give 0.032 and 0.046): those runs are pre-asymptotic, because at 50 ms the peak Courant number is 137 and the solver's sub-step cap (64) leaves the fast faces above Courant 1, where the donor limiter clips the flux. I had not noticed this; it is a numerical error of the as-built stream run (and of any n=1 or 2 run).
- **The accepted splitting against the converged answer:** the *position* of the newly formed AgCl is not an artefact of the splitting (centroid 6.18 against 6.24 mm, near-surface share 2.6 against 3.7%, L1 0.032: all within your limits). The *amount* is: the as-built run under-predicts the total AgCl by 9.4% at 1.35 s and 6.2% at 2.5 s (fails the 5% limit). So my earlier statements that the AgCl "forms along the jet path" and that the peak at the bowl is a splitting effect were not supported: the formation profile is set by where the jet fluid, already carrying entrained Ag+, mixes, not by the order of operations. The penetration result of sections 3 to 6 stands in position and is slightly low in amount.
- **Cost:** about 8 to 16 ms per pouring step for n=4 to 16 (median), against about 18 ms for the as-built split in that run; the first run of a series pays the JIT warm-up, so treat the cost column as indicative (the final comparison below gives mean values in a warm process). Nothing here accelerates the chemistry: the kinetics are the same function evaluated more often.

## 10.3 Priority 3: free-surface boundary
Measured on the as-built stream run (coupled n=8, 0.85 to 1.15 s):
- **Local inconsistency:** the stream draws Q out of the top-row cells it enters while no surface face supplies it, so the pressure solve feeds them laterally. Residual divergence in the top two rows is 2.8 to 25 1/s against 0.3 to 2.8 below (stream flux over one cell volume Q/V = 960 1/s); the mean over the whole liquid is 0.9 to 8.6 1/s.
- **Double counting:** the net lateral volume flux into the jet layers realised by the final faces is **3.0, 0.9 and 2.2 times** the entrainment the integral model prescribed (0.85, 1.0, 1.15 s). The extra comes from the pressure solve through the free boundary faces: the jet entrains twice during the intervals when the surface suction is active, and an inward surface flow of about 0.1 m/s appears near the stream.
- **Isolated correction (experimental, `window.__silverStream = { surfaceRise: true }`):** the stream volume Q is a source in the top-row cells it enters and the same volume leaves uniformly through the top row (the rising free surface). Net source zero to float32 round-off (below 1e-6 of Q): no liquid is created, the vessel volume, the volume-to-height mapping and the delivery accounting are untouched. With it the realised/prescribed entrainment is 0.88, 0.92, 0.97 and the inward surface flow falls to 29, 11 and 23 mm/s (entrainment from the surface layer is still expected to converge on the jet).
- **Impact of the correction:** total AgCl -17.5% at 1.35 s and -9.3% at 2.5 s, the formation centroid moves up 1.5 mm (one cell), near-surface share +4.1 percentage points, L1 of the formation profile 0.27. That exceeds the thresholds, so the as-built stream had a measurable numerical error at the surface; the correction is kept as an isolated experimental option. The pressure residual in the top rows remains (it comes from the per-cell imbalance of the imposed faces, not from the surface source).

## 10.4 Priority 4: settling of single microscopic particles (documented, not implemented)
Stokes, water, AgCl 5560 kg/m3: v = 2 (rho_s - rho) g r^2 / (9 mu) gives 2.5e-8 m/s for r = 0.05 um (0.0005 mm in 20 s) and 4.0e-7 m/s for r = 0.2 um (0.008 mm in 20 s), confirming your numbers. Individual fine particles therefore stay suspended; nothing in the fine-suspension settling was changed. Collective effects (a dense reacting parcel is denser than the clear liquid and can sink as a plume) are not covered by this estimate; the stage-3 field does not load the liquid with the fine suspension (only floc mass is used in `loadWeight`). This is recorded as a candidate for the later, separate task you described, not touched here.

## 10.5 Priority 5: the controlled comparison (1 mL + 1 mL, same delivery history, passive-scalar buoyancy feedback on)
| | A baseline | B stream as built | B corrected (n=8 + surface rise) | C legacy jet |
| --- | --- | --- | --- | --- |
| AgCl @1.0 / 1.35 / 2.5 / 4.0 s | 0.092 / 0.183 / 0.410 / 0.585 | 0.455 / 0.706 / 0.896 / 0.969 | 0.371 / 0.645 / 0.866 / 0.942 | 0.177 / 0.462 / 0.823 / 0.966 |
| centroid of newly formed AgCl (mm, of 15.3) | 7.14 | 6.18 | 7.56 | 7.22 |
| newly formed within 3 mm of the surface | 6.2% | 2.7% | 7.3% | 9.9% |
| fine AgCl in the top three rows @0.85 / 1.0 / 1.35 s | 88% / 19% / 1.3% | 35% / 7.7% / 6.5% | 51% / 18% / 16% | 49% / 11% / 2.6% |
| cells where Ag+ and Cl- overlap @0.85 / 1.0 / 1.35 s | 1.5% / 0.1% / 0% | 37% / 7.6% / 3.8% | 27% / 21% / 14.5% | 2.6% / 2.1% / 2.6% |
| fluid |u| max @0.85 s (m/s) | 0.014 | 1.00 | 1.00 | 0.27 |
| cost per pouring step: advance mean / peak (ms) | 10.2 / 31 | 17.5 / 36 | 14.0 / 19 | 9.6 / 25 |
| solver mean / projection mean (ms) | 1.6 / 0.5 | 7.1 / 5.7 | 4.2 / 3.6 | 5.0 / 3.1 |
Newly formed AgCl by height (share of all formed, mm above the bowl bottom): A 2 to 15 mm with its peak at 6.5 to 8 mm; B as built 1 to 12 mm, peak 5 mm; B corrected 1 to 15 mm, peak 8 to 9.4 mm; C 1 to 14 mm, peak 5 mm. Velocities stay inside the vessel (zero outside), conservation 2e-14 or better and no negative field in all four.
Reading:
- In this scenario the **baseline already forms most of its AgCl in the lower and middle part** (centroid 7.1 mm of 15.3), but slowly (0.18 at 1.35 s) because Ag+ and Cl- overlap in only 0 to 1.5% of the cells after 0.85 s.
- The stream mainly enlarges and prolongs the **overlap** (14 to 37% of the cells against 0 to 1.5%), which makes the reaction 3 to 4 times faster; the corrected version also keeps **16% of the fine AgCl in the top three rows at 1.35 s** (baseline 1.3%, as built 6.5%) and a centroid close to the baseline's. Whether that matches the reference is for the Windows comparison: nothing was tuned towards it.
- The corrected configuration costs about 4 ms more per pouring step than the baseline in the mean (solver 4.2 against 1.6 ms, projection 3.6 against 0.5 ms); frame rate is not measurable here.

## 10.6 Answers to the three stop-condition questions of the review
- **Is the computed jet physically and numerically consistent with the actual game scenario?** Numerically: the as-built run had two errors (Courant above the sub-step cap at the pour peak; double-counted entrainment at the free surface). The coupled stepping (n=4 and finer) removes the first; the surface-rise option removes the second (realised/prescribed 0.88 to 0.97). Physically: not established, because the pouring inputs (lip height, speed, Q(t)) are still the reconstruction; the Windows trace is the next step.
- **Is the position of the precipitation credible?** The position is robust to the splitting. It changed by one cell with the surface correction. It has not been compared with the real game or the reference.
- **Next problem:** if the Windows trace confirms the inputs and the corrected stream is still visually far from the reference, stop tuning fluid momentum and move to the mesoscopic representation. Not decided here.

## 10.7 How to try the corrected configuration (experimental, off by default)
In the console before the pour: `window.__silverStream = { surfaceRise: true }; window.__silverStreamCoupling = 8;`. For the recording scripts: `INIT="window.__silverStream={surfaceRise:true};window.__silverStreamCoupling=8;"`. For the as-built stream: `window.__silverStream = true`. Nothing else changes.
