# Fluid worker diagnostics

## Setup

`runFluidPour` builds the configured LOW (8x18x8) or HIGH (12x24x12) grid in a 7 mm radius, 55 mm high tube. It starts at 2.5 ml, seeds one unit of inert tracer near the inlet, delivers a continuous 1.0 ml virtual pour via `pouredMl` over 20 steps of 0.05 s, then coasts for 60 steps. The level and face connectivity refresh each step. Impulse scales with each pour increment; tracer diffusivity is 2e-7 square metres per second.

## Physics results

| Check | Result | Bound and observed value |
| --- | --- | --- |
| Tracer conservation and bounds | Pass | Mass error below 1e-10 at every step, both grids; all values within [0, 1 + 1e-10]. |
| Walls and hemispherical bottom | Pass | Every face without two wet neighbors is exactly zero; interior flow is nonzero. Separate wall and floor tracer seeds remain in wet cells. |
| Projection | Pass | Mean absolute divergence below 0.3 per second; peaks LOW 0.040, HIGH 0.151. |
| Momentum and coasting | Pass | HIGH energy 0.009823 at pour end and 0.000505 after 3 s coast; each coast step decreases within 0.1% tolerance. |
| Near-wall versus center impact | Pass | At pour end, center x displacement +0.000395 m, near-wall displacement -0.000724 m; difference 0.001118 m exceeds 0.001 m bound. |
| Gravity-up tilt | Pass | Tilt changes wet cells and tracer centroid while preserving mass. |
| Volume and level | Pass | 2.5 to 3.5 ml raises level 0.01857363 to 0.02506975 m; HIGH wet cells grow 792 to 1128. |
| Determinism | Pass | Repeated inputs produce bit-identical tracer, velocity, and diagnostics. |
| LOW versus HIGH mass and centroid | Pass | Final mass difference below 1e-10; centroid distance 0.002892 m, below measured bound 0.0035 m. |
| LOW versus HIGH mean kinetic energy | Known defect | Final energy per wet cell LOW 5.72e-8 versus HIGH 4.48e-7 square metres per square second, about 87% relative difference, above 50% bound. Both raw and per-cell checks use `it.fails`. |

Grid agreement bounds describe these two coarse resolutions, not convergence. `diagnostics().energy` sums squared cell velocities, so per-cell energy is more comparable than the raw sum.

## Profiling

At a fixed 0.038 m level, after 20 warmup steps, 80 separate `performance.now()` measurements of `step` and `transport` yielded:

| Grid | Wet cells | Mean step ms | Mean transport ms |
| --- | ---: | ---: | ---: |
| LOW | 580 | 0.525 | 0.059 |
| HIGH | 1800 | 1.652 | 0.222 |

Earlier runs on the shared Windows worker varied substantially (LOW step 0.572 to 6.960 ms; HIGH step 2.374 to 10.540 ms). These are process measurements, with no claim about frame budgets. The profile test prints current measurements.

## Reproduction

The default ESM Vite config tries to write under the read-only shared `node_modules/.vite-temp` junction and fails with `EPERM`. The owned CommonJS test config avoids that write.

```text
node node_modules/vitest/vitest.mjs run --no-file-parallelism --config tests/night/fluid/vitest.config.cjs --reporter=verbose tests/night/fluid
node node_modules/typescript/bin/tsc --noEmit
```

Final verification: 3 Vitest files, 19 passed, 2 expected failures, 0 unexpected failures. TypeScript exited 0 with no diagnostics.

Files changed: `src/scenes/laboratory/lib/night/fluid/harness.ts`, `tests/night/fluid/physics.test.ts`, `tests/night/fluid/profile.test.ts`, `tests/night/fluid/vitest.config.cjs`, and this report. The preexisting `fluidPhysics.test.ts` was included in the final test run without modification.

## Integration request

LOW and HIGH yield different mean kinetic energy after the same pour. Coarse LOW inlet sampling is a possible cause, but not isolated. The coordinator should inspect grid-dependent impulse and projection before changing production tuning. A candidate resolution sensitivity experiment is:

```diff
--- a/src/scenes/laboratory/lib/tubeSimulationConfig.ts
+++ b/src/scenes/laboratory/lib/tubeSimulationConfig.ts
@@
-    LOW: { width: 8, height: 18, depth: 8 },
+    LOW: { width: 10, height: 22, depth: 10 },
```

That candidate is unverified and costs more than the current LOW grid. Keep the energy checks as expected failures until an integrated fix demonstrates agreement.
