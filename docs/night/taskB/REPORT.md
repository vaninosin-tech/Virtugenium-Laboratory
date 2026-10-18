# Task B: sectional aggregation, numerical correction (CPU validation only)

Status: **partly done**. The number error is repaired in an optional scheme and validated against exact and converged solutions. The scheme is NOT the default and has NOT been tried in the game; no sensitivity test was repeated. Aggregation is off by default in the baseline anyway.

## Causes found in `lib/night/stage1/sectionalPopulation.ts`
1. **Pivot split on mass instead of number.** A collision product of mass `v` between pivots `x_l < v < x_u` was split with the weight `f = (v - x_l)/(x_u - x_l)` applied to the product mass. Mass is conserved, but each collision then removes only `2 m0/m1` (about 0.23 on the production grid) of a particle instead of one. The weight must apply to the particle number: `n_u = f`, `n_l = 1 - f`, mass `n_l x_l + n_u x_u = v` (Kumar and Ramkrishna fixed pivots). The defect grows with the pivot ratio, so it is large on the coarse production grid and small on fine grids.
2. **Primary particle not represented.** The first pivot is a 0.32 micrometre floc of 2.05 primaries (`0.5 (r/r_p)^3` packing law), so the source mass in section 0 is counted as `mass/2.05` particles. That lowers the Brownian collision rate (it scales with number squared) by about 4 initially. The conservative grid puts one true primary particle (radius `r_p`, mass `primaryUnit`) on pivot 0.

## What was added (default behaviour unchanged, bit-identical)
`SectionalPopulation(mask, config, primarySolidM3, solidM3PerUnit, options)`:
- `options.scheme`: `'legacy'` (default) or `'conservative'`. The latter uses number weights and a geometric pivot grid from one primary particle up to the same top pivot as the legacy grid (13 bins, same count). A product beyond the last pivot goes there with full mass (number cannot be kept; mass is).
- `options.kernel`, `options.pivots`: validation hooks (constant kernel, custom grids). Production code does not pass them.
- In the field the scheme is chosen with `window.__silverSectionScheme = 'conservative'` (anything else gives legacy).
- Per-class arrays are now sized by `bins`, not the static count; `SectionalPopulation.count = 13` remains.

## Validation (`tests/night/taskB/sectionalValidation.test.ts`)
Homogeneous box, one wet cell, aggregation only (no transport), zero shear.

Constant kernel `K` (exact solution `n_k = N0 x^(k-1)/(1+x)^(k+1)`, `x = t K N0/2`; `N = N0/(1+x)`, `M2 = N0(1+2x)`, monomers `N0/(1+x)^2`), `x = 5`, geometric pivots from one monomer:

| Quantity | Result |
| --- | --- |
| legacy, mass ratio 8.6 (production-like): N / N_exact | 2.215 |
| legacy, mass ratio 2: N / N_exact | below 1.1 |
| conservative, mass ratio 8.6: N / N_exact | 0.9971 |
| conservative, ratio 2, x = 1, 5, 10: N and monomer count | within 2% and 3% of exact |
| mass drift per step, minimum bin mass | below 1e-12 relative, never negative |
| time step: N error at dt = 8e-5 and 2e-5 (units of tau/N0 scale) | 1.46% then 0.37% |
| second moment M2 error, mass ratio 2, 2^(1/2), 2^(1/4) | 21.9%, 5.3%, 1.6% |
| conservative, mass ratio 8.6: M2 / M2_exact | 4.24 |

True Brownian kernel (no analytic solution), physical `n0 = 1e17 m^-3`, primaries, `t = 5 tau`; N/N0 against a reference on the finest grid (ratio 2^(1/4)):

| mass ratio | conservative | legacy |
| --- | ---: | ---: |
| 8.6 | 0.1594 | 0.3531 |
| 2 | 0.1621 | 0.1732 |
| 1.41 | 0.1623 | 0.1647 |
| 1.19 (reference) | 0.1623 | |

In the stage-3 field with `__silverAgg = 1` and the conservative scheme, 100 steps (pour and settling) kept the exact solid ledger (`assertMassInvariant`, `Ag+ + extent = 1`) every step.

## Conclusions and limits
- **Number and mass: fixed and validated** for the conservative scheme (number exact for a constant kernel on any grid; mass conserved to 1e-12).
- **Size distribution is NOT converged on the 13-bin production grid.** Number-weighted splitting conserves number and mass but not the second moment; on a mass ratio of 8.6 the second moment is 4.2 times too large (growth of large classes is overestimated, the opposite sign to the legacy error). It converges with refinement (about second order). Any large-floc conclusion needs a finer grid (ratio of about 2 or less, so at least roughly 30 bins to reach the same top size), which costs per-cell work growing with the square of the bin count.
- The Brownian run shows number converging from 0.1594 to 0.1623 with refinement; the reference itself is a numerical solution, not an analytic one.
- Not done: shear kernel validation, sticking below 1, the interaction with transport and settling (floc promotion to nodes at `radii[b] >= ...` in `tubeSilverField.ts` uses the new radii when the scheme is on), the pair limiter (`0.25` of the available number per step) convergence for dense cells, and any repeat of the wave 19 sensitivity grid.

## Next steps (Windows or cloud)
1. Decide the production pivot grid (bins, ratio) from a cost/accuracy trade-off using this harness; extend the validation to a finer grid and the shear kernel.
2. Run `tests/night/wave19s1/sensitivityGrid.test.ts` with `__silverSectionScheme = 'conservative'` and the chosen grid, then review in the game.
3. Only then consider making the scheme the default (the old results are pinned to `legacy`; `tests/night/wave19s2/sectionalPopulationBaseline.ts` holds a frozen copy of the old class).

---

# Part 2: convergence, shear kernel, cost, and the large-floc question (CPU)

Scheme selection is unchanged: **`legacy` stays the default**. Added knobs for validation and trials: `options.bins` (pivots of the conservative grid; window `__silverSectionBins`) and `options.prune` (below). Tests: `tests/night/taskB/convergence.test.ts`.

## Validation
- **Nonnegative populations and mass:** in every run below mass drift is below 1e-12 relative and no bin goes negative.
- **Sum kernel `K = B (m_i + m_j)`** (exact: `N = N0 exp(-x)`, `M2 = M2_0 exp(2x)`), x = 1.5, pivot mass ratio 2, 2^(1/2), 2^(1/4): number error 2.7%, 3.9%, 4.6%; **M2 error 148%, 38%, 18%** (converging, slowly). For a size-dependent kernel the number error does not shrink with the grid (the product allocation changes the kernel values); it stays below 5%.
- **Production Brownian kernel**, primaries 0.2 micrometre, full-conversion solid fraction 1.3e-3, 22 s, steps 0.05 s, error against 208 sections:

| sections | N/N0 | N error | M2/M2_0 | M2 error | mass above 1 um |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 13 | 0.1681 | 2.0% | 27.4 | 159% | 13.6% |
| 26 | 0.1712 | 0.16% | 13.4 | 27% | 1.4% |
| 52 | 0.1715 | 0.01% | 11.15 | 5.4% | 0.09% |
| 104 | 0.1715 | 0.01% | 10.69 | 1.0% | 0.01% |
| 208 (reference) | 0.1715 | | 10.58 | | 0.01% |

  With resolved shear G = 2 s^-1 the pattern is the same (M2 error 174%, 28%, 5.6%, 1.0%). The **13-section result was an artefact**: it put 13.6% of the mass above 1 micrometre where the converged answer is 0.01%.
- **Time step:** 52 sections, G = 2: N 0.1684 (dt 0.05) against 0.1689 (dt 0.0125). Densest pocket below: N 0.00070 against 0.00073, mass above 10 um 0.986 against 0.989.
- **Pruning** (`prune = 1e-9` of the cell's solid, conservative scheme only; skipped classes keep their mass): N and M2 identical to five digits at 52 and 104 sections.

## Cost of one collide call (every wet cell holds the 1 s / 11 s / 22 s distribution), ms per 50 ms step
| sections | LOW 1740 cells | HIGH 4320 cells |
| ---: | ---: | ---: |
| 13 | 1.0 / 1.4 / 1.8 | 2.3 / 3.6 / 4.5 |
| 26 | 1.3 / 2.3 / 2.7 | 3.2 / 5.9 / 6.8 |
| 52 | 2.7 / 5.3 / 6.6 | 6.9 / 13.0 / 16.7 |
| 104 | 6.2 / 13.6 / 17.8 | 22.3 / 34.9 / 46.7 |

Without pruning the same loops cost 50 ms (52 sections, LOW) to 800 ms (104, HIGH) per step. **52 sections with pruning is the practical representation** (M2 within about 5% of the 208-section reference, 7 to 17 ms); 104 is too heavy for HIGH. Single-thread Node on the cloud machine; the Windows machine will differ. Advection and rendering are extra.

## Do larger flocs form with a converged representation?
Box with the production radius law (porous spheres below 1 micrometre, fractal dimension 1.9 above), sticking 1, no breakup, 104 sections, 22 s. "phi x" is the solid fraction as a multiple of the full-conversion mean of the whole tube. The CPU field's own strain rate is mean 0.1 to 0.7, 95th percentile 1 to 3.6, maximum 6 to 16 s^-1, and its largest cell value of AgCl is about 4.4 times that mean (Task A). Primaries 0.2 um:

| | G = 2 | G = 10 | G = 50 |
| --- | --- | --- | --- |
| phi x1 | 0.02% above 1 um, largest 0.8 um | 0.2%, 0.9 um | 10%, 1.4 um |
| phi x4 | 22%, 1.6 um | 48%, 2.7 um | 92% above 1 um, **76% above 100 um** (top class) |
| phi x10 | 71%, 3.6 um | 92% above 1 um, 63% above 100 um (top class) | 93% above 100 um |
| phi x50 | 83% above 100 um | 95% above 100 um | 99% above 100 um |

Primary radius 0.05 um gives the same pattern with faster number loss (N/N0 0.003 against 0.17 at phi x1, G = 2). Sticking 0.3 and 0.05 only slow it (largest class 0.6 and 0.4 um at phi x1, G = 2; N/N0 0.41 and 0.81 for 0.2 um primaries).
- **At the tube-average concentration and the model's resolved flow, a converged representation gives microscopic aggregates (largest about 1 micrometre) in 22 s: no cotton.** That is a property of the converged model, not of the earlier unconverged one, and it says nothing against a coherent cloud of microscopic particles being optically milky.
- Large flocs **do** appear in this model once the local solid fraction is about 4 times the mean together with a strain rate near 50 s^-1, or about 10 times the mean at 10 s^-1. These are upper bounds: no breakup (flocs that size would break at such shear), sticking 1, and the top class (1.76 mm) collects everything beyond it. The CPU flow field does not reach 50 s^-1; the real stream and sub-grid turbulence might. So large flocs are not shown impossible; they depend on local concentration and shear that the present flow resolution does not supply.

## Still open
- Making the scheme (and 52 sections) the default: needs the game comparison and a rerun of the wave 19 sensitivity grid on the new scheme. The field ledger holds for 100 steps with 13 and with 52 sections (`sectionalValidation.test.ts`).
- Breakup, local shear from the jet, and the interaction with floc promotion (nodes) and sediment were not validated.
