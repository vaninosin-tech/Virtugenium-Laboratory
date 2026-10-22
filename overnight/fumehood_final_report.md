# FumeHood_Modern — Overnight Build Final Report

FINAL STATUS: NEEDS HUMAN REVIEW

## Result

Maximum iteration budget (8) reached without achieving FINAL PASS.
Master source has been restored to the best-scoring checkpoint (iteration 4).

- Best iteration: 4
- Best total score: 93.0 / 100
- Deterministic score: 55 / 55 (no failures)
- Visual score: 38 / 45 (required >= 40 for PASS)
- Total score requirement (>=93) was met, but the visual-score sub-threshold (>=40/45) was not, so PASS criteria were not satisfied (spec section 18, rule 3).

## Final dimensions (measured, iteration-4/master geometry)

- Width: 1.600 m
- Depth: 0.863 m
- Height: 2.300 m
- Worktop top Z: 0.900 m
- Opening: 1.300 m x 0.940 m
- Sash glass thickness: 0.008 m
- Triangle count: 884
- Material count: 8

## Remaining deterministic failures

None. Deterministic validator scores 55/55 on the master (iteration-4) geometry.

## Remaining top visual defects

1. **Chamber brightness/read (persistent, unresolved).** The work chamber in QA_Front
   reads flatter/darker than the reference's bright, open glass-fronted chamber; baffle
   slots are only weakly legible through the glass. Present since iteration 4.

2. **Diagonal light-leak/shadow streak on lower cabinet doors (persistent, unresolved,
   root cause identified).** A diagonal bright streak/patch is visible across the lower
   doors in both 45-degree QA views. Iteration-8 diagnostic work (this run) conclusively
   ruled out every previously-suspected cause:
   - Confirmed present, pixel-identical, in the original iteration-4 checkpoint render
     (overnight/qa/iter_04/QA_Left45.png) — it predates all iterations 5-8 and is NOT
     caused by any KeyLight/FillLight resize, material, or modifier change made in later
     iterations (those had been wrongly blamed in iterations 6-7).
   - Reproduced identically with the SeamBevel modifiers on the 4 base doors removed
     (isolated test, single-camera render).
   - Reproduced identically with Mat_BodyOffWhite Specular IOR Level lowered 0.5 -> 0.15
     (isolated test).
   - Reproduced identically with EEVEE fast_gi ray_count/quality/resolution/step_count
     substantially increased (2->16 rays, 0.25->1.0 quality, half-res->full-res).
   - Reproduced identically with EEVEE use_fast_gi disabled entirely.
   Because the pattern does not change under any lighting-quality, material, or modifier
   change, it is almost certainly a genuine cast shadow/light-leak from real scene
   geometry (e.g. a seam/gap between BaseCabinet and the chamber/worksurface structure
   above it letting a light source graze through and fan across the door fronts), not a
   render-noise or reflection artifact. This needs direct geometry inspection of the
   BaseCabinet/WorkSurface seam and the FillLight/KeyLight shadow rays, which is beyond
   the safe single-iteration fix budget at the max-iteration boundary.

3. **Material distribution / interior brightness.** Chamber interior tone reads darker
   than the target light interior-neutral language, tying into defect 1.

## Iteration 8 actions taken (all reverted)

Iteration 8 attempted three spec-compliant, non-KeyLight fixes (bevel seams on base
doors, non-destructive UpperHood tint, small global exposure lift) plus root-cause
diagnostics on the recurring door-streak defect. The diagnostics were valuable (see
above) but no combination produced a passing visual score, and per spec section 20
Regression Control the master has been restored to the iteration-4 checkpoint rather
than kept in a partially-tested state. All iteration-8 changes were discarded; nothing
was committed to the master beyond the checkpoint reload.

## Node / structure verification

All required stable nodes present and correctly structured on the iteration-4 master:
FumeHood_Root, BaseCabinet, BaseDoor_01..04, WorkSurface, Chamber_Left/Right/Back/Ceiling,
RearBaffle, FumeHood_Sash, Sash_Handle, Interior_LED, UpperHood, ExhaustModule,
ControlPanel, Page_Display. Sash is a separate object, correctly placed. Display is on
the right front column. Four base doors, recessed plinth present.

## Paths

- Source (restored to best checkpoint): blender-source/FumeHood_Modern_MASTER.blend
- GLB: not exported (PASS criteria not met; spec forbids exporting/finalizing without PASS)
- Best checkpoint: overnight/checkpoints/iter_04.blend
- QA renders (current master state): overnight/qa/iter_04/
- QA renders (iteration 8 diagnostics, discarded): overnight/qa/iter_08/

FINAL STATUS: NEEDS HUMAN REVIEW
