# Wave 7 reagent diagnostic B

## Owned files

- `tests/night/wave7reagents/diagnosticB.test.ts`: deterministic stage 3 field checks, 0.05 s steps, fixed 0.0262 m surface, 0.0049 m inlet, 1 mL delivered over 3 s, 12 s total.
- `docs/night/wave7reagents/fields.txt`: x-y centre-plane ASCII slices of Ag+, Cl-, overlap and productSource at 0.25, 0.5, 1, 2, 4 and 8 s.
- `docs/night/wave7reagents/fields.json`: 16 × 32 × 16 flat per-cell amount arrays rounded to five decimal places at 0.5, 1, 2, 4 and 8 s. Flat index is `(z * ny + y) * nx + x`.
- `docs/night/wave7reagents/metrics.json`: measured centroids, widths and formation.
- `docs/night/wave7reagents/*.log`: actual Vitest output from the full suite and isolated reruns.

## Findings

The no-delivery 5 s run formed nothing: chloride, tracer, source, extent and total solid remained zero. Through the 12 s pour run, every step conserved `Ag+ + extent = 1.15`, `Cl- + extent = delivered`, and `solid = extent` within 1e-9. Tested fields and floc nodes were finite and nonnegative. Each cell's `productSource` remained inside its post-reaction Ag+/Cl- overlap and below the local stoichiometric limit. Delivery reached 1 at 3 s; subsequent chloride decreased with reaction. Formation from 8 to 12 s was **0.09055430** normalized amount; total extent at 12 s was **0.64720418**.

| Time (s) | Overlap centroid depth (mm) | Lateral spread, x standard deviation (mm) |
|---:|---:|---:|
| 0.25 | 1.4313 | 1.5901 |
| 0.5 | 2.2980 | 1.6837 |
| 1 | 3.6157 | 1.8325 |
| 2 | 5.7157 | 1.9632 |
| 4 | 9.4820 | 2.3564 |
| 8 | 9.1775 | 3.7278 |

The overlap starts within 2 mm of the surface and descends at each sampled point during the 3 s pour. First-step source centroids were **-4.8061 mm** and **+4.7945 mm** for left and right inlets.

**Failing requirement:** first-step positive Cl- extends **11.6694 mm** from the inlet, versus the required maximum 3 mm. It occupies wet rows **22 through 24**, versus the required top two rows. Both failures are retained as soft assertions in the diagnostic test. The injection Gaussian has no lateral cutoff, permits depth `< 2 * vertical`, and transport runs in the same step. The distant values can be very small; the requirement explicitly covers every positive cell.

At 2 s, chloride x-width (mm) was:

| `__silverMix` | `__silverEddy=0.01` | `__silverEddy=0.3` |
|---:|---:|---:|
| 4e-7 | 1.0574 | 1.2243 |
| 2e-6 | 1.2380 | 1.2264 |

The mean absolute width change from the mix setting was **0.09135 mm**, and from eddy was **0.08929 mm**. Mix is marginally larger by this measure, but the effects are nearly tied and interact. Even the low/low case spans 1.06 mm, so these settings do not eliminate transport smoothing of fine structure. Globals are deleted after the test file.

## Integration request for coordinator

Only the coordinator may edit `src/scenes/laboratory/lib/tubeSilverField.ts`. The following exact diff is proposed to enforce the first-step support at injection and avoid immediately transporting that first parcel. It has **not** been applied or tested in this worktree. Rerun the diagnostic after integration; later plume motion may change.

```diff
@@ advance, around `const amount` and ion transport @@
       const amount = Math.max(0, Math.min(1, delivery) - this.delivered);
+      const firstDeliveryStep = amount > 0 && this.delivered === 0;
       this.inject(inlet, amount, jetStrength);
@@
-      for (const field of Object.values(this.species)) this.solver.transport(field.values, step, ionMixing, ionEddy);
-      this.solver.transport(this.tracer, step, ionMixing, ionEddy);
+      if (!firstDeliveryStep) {
+        for (const field of Object.values(this.species)) this.solver.transport(field.values, step, ionMixing, ionEddy);
+        this.solver.transport(this.tracer, step, ionMixing, ionEddy);
+      }
@@ inject, around `weights[i]` @@
       const vertical = m.radius * (this.stageOne ? 0.14 : 0.36 + 0.12 * Math.min(3, jetStrength));
+      const topWetRow = Math.floor((inlet.y - m.bottom) * m.ny / m.height - 0.5);
+      const lateralDistance = Math.hypot(dx, dz);
       weights[i] = p.y <= inlet.y && depth < vertical * 2
+        && y >= topWetRow - 1 && lateralDistance <= 0.003
         ? Math.exp(-(dx * dx + dz * dz) / (width * width) - depth * depth / (vertical * vertical)) : 0;
```

The full suite also wrote `docs/night/stage1/slices.txt` as a test side effect. It is outside this worker's ownership, so I did not restore or edit it. The coordinator should discard that generated change before integration if it is unwanted.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: **pass**, exit 0 after the final test edit.
- Full serial suite, run once with `--configLoader runner --no-file-parallelism`: **53 files, 47 passed, 6 failed; 338 tests, 326 passed, 10 failed, 2 expected fail**. Output: `full-suite.log`.
- Final isolated diagnostic rerun: **4 tests, 3 passed, 1 failed** on the two first-step support assertions. Output: `rerun-diagnostic.log`.
- Timed-out files rerun alone, serially: `tests/tubeReactionVisuals.test.ts` **32 passed, 1 timed out**; `tests/_g1_motion.test.ts` **1 passed**; `src/scenes/laboratory/lib/tubeVolumeField.test.ts` **13 passed**. Outputs: `rerun-visuals.log`, `rerun-motion.log`, `rerun-volume.log`.
- Other full-suite failures: `tests/night/wave4a/field.test.ts` surface raft threshold; `tests/night/wave6perf/flocPerf.test.ts` fixed HIGH mass expectation; `src/scenes/laboratory/lib/tubeVolumeField.test.ts` soft CPU budget in the full run. The remaining full-run failures were timeouts or this diagnostic.

No visual result is claimed. The coordinator owns rendering the diagnostic video.
