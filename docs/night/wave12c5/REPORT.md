# Wave 12 C5: incoming jet and passive tracer

## Result and scope

The existing stage-3 flow under-resolves the incoming NaCl jet. The 6.5 mm impact is 0.5 mm from the 7 mm wall. On the 12 x 24 x 12 real-game grid, horizontal cells are 1.17 mm and vertical cells are 4.60 mm. Thus the 1.15 mm jet radius has about one horizontal cell and less than one vertical cell of resolution. The legacy contact source and shallow surface-spread closure produce 1 to 3 mm/s peak resolved speeds while delivery is active. The new optional model distributes the specified incoming momentum along a submerged core, but it does not solve late-time morphology: the 9 s tracer is still one smooth connected region. **The flag remains off by default.** No pouring geometry, delivery, chemistry, species transport, or renderer was changed.

The replay uses the same 50 ms stepped delivery as `wave11c3/mixing.test.ts`: two 0.02 mL ledger parcels per field step, 1.0 mL initially, 1.0 mL delivered by 1.25 s, impact at x=6.5 mm. `__silverDiag="tracer"` disables precipitation; incoming NaCl alone enters through the existing field injection and is transported by the solver. The replay clock begins at first field insertion; the shared game dumps start at the click and first impact is about 600 ms later. The dumps therefore establish geometry and the original segregation diagnosis, not equal-clock numerical targets for this replay.

## Existing momentum path

The stage-3 caller supplies a dimensionless face-velocity impulse `0.2 * jetScale * clamp(jetStrength,0.4,3)` when a parcel enters. With the stage-3 `jetScale=0.1` and the replay `jetStrength=0.4`, this is 0.008 m/s before the Gaussian contact weighting, face clipping and projection. The contact width is `0.32 * radius`, about 2.24 mm, and the source is centered at the impact, not deposited along a resolved submerged core. The surface closure targets

`u_r = alpha Q / (2 pi r delta) [1-exp(-(r/r0)^2)] exp(-z/delta)`.

At alpha=0.2, Q=1e-6 m3/s, delta=1.5 mm, r=3 mm and z=0, this is about 7.1 mm/s outward, decaying by a factor of `e` each 1.5 mm. It is a horizontal relaxation, not the jet's downward momentum flux. A 1e-6 m3/s, 0.25 m/s incoming stream carries `rho Q v = 2.5e-4 N`; the legacy impulse has no force normalization, so its source cannot be equated to that flux. The 0.008 m/s nominal impulse and 7.1 mm/s surface target become at most 1.0 and 3.3 mm/s *resolved* peak speeds at 0.5 and 1 s in the replay. Projection (six pressure iterations by default), the closed wet-face condition, capped momentum advection, and 0.26/s damping redistribute or attenuate the source. The code uses `2e-7 m2/s` momentum diffusion; its `eddyDiffusivity=3e-5 m2/s` affects scalar transport, not momentum. We did not isolate a unique numerical fraction for each loss mechanism.

At the wall, missing faces have zero normal velocity. The tangential Laplacian substitutes the face's own velocity for a missing neighbor, giving approximately zero normal derivative of tangential speed, a free-slip style closure rather than no-slip. The jet core is within one horizontal cell of this boundary, so a wall-attached shear layer or Coanda mechanism cannot be resolved. Both upward and downward velocity cells exist, and the vorticity diagnostic is nonzero, but a closed recirculation loop was not established from these slices.

The measured inward flux across wet lateral faces of a 3 mm radius, 15 mm deep control cylinder at the real impact is 4.78 µL/s at 0.5 s and 1.98 µL/s at 1 s with the flag off (4.78e-9 and 1.98e-9 m3/s). These are about 0.5% and 0.2% of the 1e-6 m3/s supplied surface-flow parameter. Outward flux is recorded separately in `history.csv`. The wall truncates the cylinder; this is a resolved wet-face flux, not a full circular textbook measurement.

## Optional local model

`TubeJetModel.prepare` computes `rho Q v`, with rho=1000 kg/m3, default radius 1.15 mm, default speed at least 0.25 m/s and at most 1.5 m/s, and a default 0.08 entrainment slope. The available force is normalized over wet faces below the impact. A broad numerical kernel resolves the subcell jet and tapers with the round-jet relation `Q(z)=Q0(1+2 alpha z/r0)`; the default penetration is bounded at 18 mm and clipped to available liquid depth. The depth and entrainment law are closures, not a measured plunge-depth solution. The model does not add liquid or tracer. A 300-iteration pressure solve applies during the source; 30 iterations maintain low divergence during the subsequent relaxation. Off uses the original six-iteration path.

At 1 s and the real impact, the specified vertical face-source force is -8.91e-5 N, normalized to the same value before clipping to within float precision. Face clipping accounts for 1.73e-6 N of absolute changes across components. The pressure projection changes the *total* vertical face-momentum rate by +3.34e-5 N; this includes wall reaction and pre-existing flow and is not a loss fraction attributable solely to the new source. The measured inward control-surface flux is 1.16e-6 m3/s, compared with the closure estimate of 1.20e-6 m3/s. At 0.5 s these are 1.07e-6 and 1.20e-6 m3/s. The supplied flow parameter is 1e-6 m3/s, whereas 1 mL/1.25 s is 0.8e-6 m3/s; the model uses the existing caller's parameter, so that 25% discrepancy remains an integration calibration issue. Peak resolved speed reaches 0.093 m/s at 0.5 s, still below the specified 0.25 m/s subcell entry speed because force is distributed and projected.

Mean absolute divergence at the real impact is 2.1e-6 /s at 0.5 s, 6.3e-6 /s at 1 s, 0.0148 /s at 2 s and 0.0027 /s at 9 s with the flag on. Every replay step remains below the existing 0.3 /s solver-test tolerance. The force source is finite and bounded, scalar values stay nonnegative, and tracer mass error is below 1e-12 at all 180 steps. This is source normalization and conservative scalar transport, not a claim that total fluid momentum in a closed, wall-bounded vessel must remain equal to the external jet impulse.

## Tracer deformation

Iso-regions use 10% and 50% of positive-cell p95 and six-neighbor connectivity. `S/V` is exposed grid-face area divided by occupied grid-cell volume; `A10` is the 10% interface area in cm2. `Mixed` is the fraction of tracer mass in cells below half the instantaneous peak concentration, a dilution proxy that depends on the peak. `H2` and `V2` are horizontal and vertical second moments in mm2. Penetration is the depth of cells above 10% of the peak from the current surface. This thresholded depth cannot resolve subcell jet penetration.

| Time | Flag | Depth mm | H2 / V2 mm2 | Mixed | 10% components, A10 cm2, S/V 1/m | 50% components, S/V 1/m | >3 mm from impact |
| ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 s | off | 10.7 | 2.76 / 9.51 | .505 | 1, 4.57, 1177 | 1, 1277 | .080 |
| 0.5 s | on | 24.5 | 6.53 / 54.1 | .775 | 10, 9.69, 1247 | 2, 1492 | .351 |
| 1 s | off | 19.2 | 4.15 / 26.1 | .674 | 1, 7.34, 953 | 1, 1199 | .187 |
| 1 s | on | 37.7 | 14.7 / 81.1 | .811 | 1, 19.2, 750 | 2, 1240 | .589 |
| 2 s | off | 23.5 | 8.57 / 47.2 | .589 | 1, 11.9, 720 | 1, 950 | .480 |
| 2 s | on | 42.0 | 20.4 / 81.2 | .798 | 2, 26.7, 591 | 14, 1145 | .937 |
| 4 s | off | 23.5 | 17.8 / 52.3 | .563 | 1, 15.7, 550 | 1, 799 | .773 |
| 4 s | on | 42.0 | 23.2 / 97.4 | .103 | 1, 25.4, 424 | 1, 482 | .919 |
| 9 s | off | 18.9 | 24.2 / 47.0 | .370 | 1, 15.6, 480 | 1, 585 | .899 |
| 9 s | on | 42.0 | 23.4 / 127 | .067 | 1, 28.0, 418 | 1, 446 | .906 |

The flagged jet creates transient separated iso-regions and substantially increases early interface area, strain and vertical spread. By 4 to 9 s both variants again form one smooth region. At 9 s the on variant has lower S/V and a lower dilution proxy, while horizontal second moment and away fraction are similar. The model therefore repairs the missing early resolved entrainment but does not establish the intended persistent concentration filaments. The tracer's late full-depth threshold indicates strong transport and numerical smoothing at this coarse vertical resolution; it is not evidence that the physical jet itself penetrates 42 mm.

The off replay's 9 s away fraction (.899) differs from the wave11c3 *fine AgCl* fraction (.61) and the supplied game dump because this run traces all incoming chloride without precipitation. Moving the impact only in this comparison, 9 s away fractions are .787 / .778 (off / on) at the axis and .784 / .815 at 3.5 mm. The 9 s 10% regions remain one component in all four central comparisons. Their on penetration reaches the same 42 mm threshold. These comparisons do not justify changing the validated game impact.

## Artifacts, performance, and verification

`history.csv` records all 180 steps for each of six runs, including mass, shape, moments, penetration, speed, strain, vorticity, divergence, source and measured entrainment. `summary.json` retains the sampled values. Forty binary PPMs contain fixed-scale numerical central vertical speed and x/y vectors (RGB channels), vertical strain, central vertical tracer and horizontal tracer at 0.5, 1, 2, 4 and 9 s for flag off and on. They are numeric slices; no browser or rendered visual claim is made.

The `cpu.json` benchmark uses 200 measured solver steps after 20 warm-up steps, with a 25-step source, then relaxation. Times include projection and gradient diagnostics but exclude tracer and metric collection. Host load affects p95.

| Grid | Off p50 / p95 ms | On p50 / p95 ms |
| --- | ---: | ---: |
| LOW 12 x 24 x 12 | 1.55 / 6.37 | 3.73 / 9.03 |
| HIGH benchmark 16 x 32 x 16 | 4.88 / 9.44 | 11.90 / 27.73 |

The real game's HIGH field is 22 x 44 x 22, so this HIGH benchmark does not establish that setting's cost. Increased pressure iterations dominate the flagged cost. A cheaper pressure method or a selective convergence criterion is the principal performance follow-up.

`tsc --noEmit` passed. Focused C5 and solver tests passed 8/8 after the final pressure and divergence-test changes. The combined C5, solver and volume run passed 20/21 with one soft HIGH CPU threshold (22.87 ms against 20); volume alone then passed 13/13. The **final whole suite** had 381 passed, 7 failed and 4 expected failures across 67 files. Three failures were the known golden values: `wave4a` surface 0.0024971032004616205 against >=0.005, `wave4b` endpoint 0.255 versus 0.251, and `wave6perf` HIGH total distance 0.05661764468314012 from its golden. Flag off leaves their code path unchanged and the numbers match the prior reports. The other four failures were two 5 s `tubeReactionVisuals` timeouts, one 30 s `_g1_motion` timeout and one 5 s `tubeBariumField` timeout. Rerun alone, rendering still had 33 passed / 2 timeouts and motion still timed out; barium passed 9/9. None of those files was edited. The earlier full run before the final projection change had 382 passed, 6 failed and 4 expected failures.

No integration file needs editing by C5. The coordinator should keep `__silverJetModel` off until the added CPU cost and the smoother late-time tracer are judged with C6's separate subgrid model and game captures. Calibrate the surface-flow parameter against the actual 0.8e-6 m3/s delivery, and validate the wall-adjacent pressure field on the real HIGH grid before enabling it.
