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
