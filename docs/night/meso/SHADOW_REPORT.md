# MesoCloud x2 with active region, subgrid mixing and connectivity diagnostics (CPU)

Code: `src/scenes/laboratory/lib/night/meso/{mesoCloud,cloudTopology}.ts`. Harness: `tests/night/meso/shadow.test.ts` (env `CONFIG=A|B`, `REFINE`, `MIX=none|eddy`, `ETA`, `KAPPA`, `TOPO=1`, `QUALITY`, `END`, `MARKS`, `SHADOW_OUT`). Scenario of record: 2.5 mL AgNO3 + 1 mL NaCl, aggregation off; A = accepted baseline, B = `__silverDensity {model: "net"}`. The cloud is a shadow: it receives only the AgCl formed per step and moves with the field's own solver faces; it feeds nothing back and no renderer reads it. Nothing was seen in the game. Slices: `docs/night/meso/shadow2/` (left the field's fine suspension, right the refined cloud, same scale, mid plane; CPU slices only).

## 1. What was built
- Resolution x2 as the practical target; x3 kept for comparison only.
- Active region: work only in coarse blocks holding mass plus their 26 wet neighbours, rebuilt before every call so the region moves and grows with the cloud; blocks below 1e-13 of the total are frozen, never zeroed (they stay in `mass`, `restrictTo`, `components` and wake up when a neighbour exports into them); while the pour needs sub-stepped faces the whole wet domain is active; mass is created nowhere. Tests: drifting cloud conserves mass to 1e-12 and does not clip the leaving edge; the active-region result equals the full-domain computation to 1e-9; frozen dust is kept; face interpolation equals the direct definition at refine 1, 2, 3 (dry cells, random faces). A leak found on the way (diffusion into a partner outside the list) was fixed and is covered.
- Unresolved mixing: kappa = 1e-9 + eta * eddy(parent cell) * 0.02, where `eddy` is the flow solver's own eddy diffusivity and 0.02 the scale the coarse fine-suspension closure uses (FINE_EDDY_SCALE); eta = (h_fine / h_coarse)^(4/3) (Richardson) = 0.40 at x2. Explicit, conservative, cut into sub-steps so kappa dt / h^2 <= 1/8. Mass conserved to 1e-12.
- Connectivity at four physical thresholds (0.5, 1, 2, 4 times the mean-cell density): connected-region count, mass, volume, lobes, thinnest neck between the two heaviest lobes (distance transform plus widest path, tested on a synthetic dumbbell), topology events by cell overlap between snapshots (split, merge, birth, death) with the neck width before a split and the diffusion length, regions lighter than 2 percent of the total mass treated as dust, and cumulative transport and mixing contributions to the change of the field. Test: a split is found only when the concentration structure changes.

## 2. Performance (node, one core, mean / p99 per 50 ms step; field step shown for scale)
| | MesoCloud | parts (interpolate / advect / mixing) | active blocks | field step |
|---|---|---|---|---|
| x3 whole grid (previous version, A) | 36 to 39 ms | | all | |
| x3 active, B | 15.3 ms (p99 25) | 6.0 / 7.0 / 1.9 | 1722 of 3456 | 8.4 ms |
| x2 active, B | 5.6 ms (p99 19) | 2.3 / 2.4 / 0.7 | 1717 of 3456 | 8.9 ms (flow, 120-iteration projection, net density, reaction) |
| x2 active, A | 4.0 ms (p99 8) | 1.9 / 1.4 / 0.5 | 1322 of 3456 | 4.0 ms |
The optimisation of the interpolation (stencil weights per block offset, one validity pass) took x3 from 24 to 15 ms and x2 from 8.5 to 5.6 ms. The active region saves only 40 to 50 percent of the blocks because the cloud fills most of the column; it would help more for a compact plume. Aggregation cost, rendering cost and the game frame time are not part of this measurement; they need the Windows run.

## 3. Subgrid sensitivity (B, x2; sum of squares per mass as the structure measure; grid-scale roughness = deviation from the 6-neighbour mean)
| mixing | peak (coarse 3.7) | gap fraction (coarse 0.08) | structure | roughness (coarse 0.008) |
|---|---|---|---|---|
| none (only the scheme's own diffusion) | 8.3 | 0.23 | 2.75 | 0.035 |
| eta x0.25 | 8.1 | 0.21 | 2.68 | |
| eta x1 (default, closure consistent) | 7.5 | 0.17 | 2.53 | 0.023 |
| eta x4 | 6.0 | 0.10 | 2.10 | 0.014 |
| eta x16 | 3.2 | 0.006 | 1.40 | |
At x1 the refined cloud keeps 92 percent of the unmixed structure and its roughness is a smooth 0.02 (no two-cell noise), so thin structures are not wiped out and not left as grid-scale filaments; at x16 the structure is as smooth as the coarse field, which is the "too much diffusion" end. The choice x1 follows from the existing closure, not from tuning to a picture.

## 4. Cloud morphology and separation on the real flow
- Folded, curled bands and transparent gaps inside a connected body appear during the first seconds of B (see `configB_x2_t005.png` to `t020.png`): the coarse field shows a smooth gradient at the same time. Refined peak density is about twice the coarse one.
- Connectivity: in A and B, at every threshold from 0.5 to 4 times the mean, the regions that hold at least 2 percent of the mass are ONE region for the whole 40 s. Split, merge events among significant regions: none (A: 0/0, B: 0/0 at all thresholds). Many small dense fragments exist at 4 times the mean (5 to 15, each below 2 percent of the mass); whether they would read as separate puffs depends on rendering and is not claimed. Thinnest neck: not defined (fewer than two heavy lobes).
- Contributions: transport accounts for 97 percent of the summed field change (cumulative L1 88 against 2.2 for mixing), so the structure that exists is made by transport, not by diffusion.
- No visible separation can be claimed, and none of the observed region changes is a separation of significant regions.

## 5. STOP: why separation does not appear (limiting mechanism, no tuning iteration)
Tested, with the outcome:
- Stretching available: the resolved strain integrated along the cloud is 17 to 24 in B within 10 s (A: 2 to 8), well above the 3 to 5 needed; not the limit.
- Diffusion: no mixing at all (x2 and x3) gives the same single significant region; one small lobe (3 percent of the mass) splits off at 4 times the mean; not the limit.
- Concentration resolution: x3 against x2 changes the fragments at 4 times the mean but not the significant regions; not the limit.
- Density feedback: with it (B) the flow is stronger and folds the cloud, without it (A) the cloud is a slanted wedge; neither separates.
- Flow resolution: on the HIGH flow grid (16 x 32 x 16, x2 meso) the density-coupled flow does not settle: at 15 s the resolved strain is 17.7 1/s (max 71) with an integral of 160, hundreds of tiny fragments (182 regions at threshold 1, none above 2 percent of the mass), restricted-vs-field mismatch 0.52. This is the same kind of sustained grid-scale motion found for aggregation plus net density at the LOW grid (density report, section 5). It depends on the momentum viscosity: with the same coupling at LOW, aggregation on, the sustained mean |w| is 1.1 mm/s at the baseline viscosity 2e-7 m2/s, 0.42 mm/s at water's 1e-6 and 0.008 mm/s at 4e-6 (`window.__silverViscosity`, experimental). The baseline solver's momentum diffusivity is 5 times below water's.
Limiting mechanism, by what the evidence supports: the density-driven flow is the limit. At LOW resolution it is a single smooth overturning cell that folds the cloud but cannot pinch it into separate significant regions; at HIGH resolution (and with aggregate weight at LOW) it becomes a sustained grid-scale motion that fragments the field into noise, which is not a physical separation. Both are properties of the flow solver (grid resolution and under-damped grid-scale motion), not of the concentration field, the mixing or the cloud representation. Not tested and not claimed: whether a finer, properly damped flow would separate a plume, and the role of the pour jet (the stream model is off). The next step is therefore on the flow, not on MesoCloud; no architecture change is proposed before the viscosity/damping question of the flow solver is settled.

## 6. Update after the flow-solver audit (`docs/night/solver/REPORT.md`)
Section 5 above named the density-driven flow as the limit. The audit found concrete numerical errors in it: scalar transport above its Courant limit during overturning (up to 4.4 on HIGH), aggregates advected with a non-divergence-free velocity, and too few projection iterations. After fixing them the HIGH-grid shadow run has strain 0.23 1/s at 15 s (was 17.7) and no fragmentation noise, and the LOW result is unchanged: one significant region, no separation events. The statement that the flow solver prevents separation is withdrawn; what remains is that, in a trustworthy flow, the fine cloud alone does not separate significant regions within 40 s. MesoCloud itself is unchanged.
