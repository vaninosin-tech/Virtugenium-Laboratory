# Wave 14 G2 report

## Scope and state

This worktree still has the G1 `vesselGeometry` legacy stub: `innerRadius=0.007 m`, `cavityHeight=0.055 m`, and its volume/height mapping delegates to the old effective radius. No corrected-geometry replay was possible here. The jet and subgrid flags remain off by default. No browser or visual measurements were made.

## Event and jet contract

`DeliveryEvent.tubeId` is the receiving vessel ID; `sourceId` is the bottle ID. `serial` is the start of the pour on the stand simulation clock (ms), `atMs` is elapsed time (ms), and their sum is the event's absolute stand time. `reagentId` identifies the reagent, `requestedMl` is debited from the source, `ml` enters the receiver only for a valid impact, `point` is world-space impact (m), `surfaceY` is world-space free-surface elevation (m). Optional `sourceOutlet` is the rendered bottle lip in world metres and `sourceOutletVelocity` its frame-to-frame finite difference in world m/s. That motion velocity is separate from liquid speed relative to the outlet. The optional sample is absent when no recent render frame is available, including headless pours. This makes event logging honest but does not yet satisfy deterministic pose reconstruction from `pour.at`. The existing bottle pose is built inside the unowned `ReagentContainerInstance.tsx` and changes each frame; its pose formula must be shared with the simulation clock to close that gap. `window.__diag.events(tubeId)` returns a detached ledger snapshot from the application's own module instance.

The first mesh ring (`t=0`) defines outlet radius `0.00115*(0.42+0.58*pourFraction)` m. The event model computes `Q=event.ml*1e-6/(intervalMs/1000)` m3/s. For the exact cumulative curve, `Q(t)=pourFlowMlPerSecond(t/1700)*1e-6`. Lip area is `pi*r_lip^2`, lip speed `Q/A_lip`. With the actual vertical fall `h=max(0,lip.y-impact.y)`, relative impact speed is `sqrt(U_lip^2+2*9.81*h)`; impact area is `Q/U_impact`, force magnitude `1000*Q*U_impact` N. Horizontal outlet motion is added to the impact velocity vector separately. `eventJetState` requires the exact emission interval as input and returns no state for an invalid event or absent lip. The optional `TubeJetModel` hook consumes this state when explicitly supplied. Its old fallback remains for callers without an event.

The CSV `pour-series.csv` gives Q(t), lip and impact speed, impact area and force at 10 ms intervals, plus exact 30 and 50 ms curve bins and a 30 ms event series accumulated into 50 ms field steps. Its outlet y=0.158 m and initial receiving volume=2.5 mL are **illustrative assumptions**, not measured poses. The impact y follows the current `tubeVessel.heightFromVolume`. Thus the CSV's Q values are real for the pour curve, while its U-impact, area and force must be recomputed with measured lip positions and G1's geometry. The function is tested for `Q=A*U`, `F=rho*Q*U`, gravitational energy, nonnegative flow and exactly 1e-6 m3 integrated delivery.

| Measure | Result |
| --- | ---: |
| Active delivery window | 0.35 to 0.76 of 1.7 s = 0.697 s |
| Mean over active window | 1.4347e-6 m3/s |
| Instantaneous plateau peak | 1.9010e-6 m3/s |
| 30 ms cumulative-difference peak | 1.9010e-6 m3/s |
| 50 ms cumulative-difference peak | 1.9010e-6 m3/s |
| 30 ms events assigned to 50 ms step peak | 2.2812e-6 m3/s |

The prior 2.28e-6 peak is a binning spike, not the physical flow peak. The earlier 0.8e-6 assumption treats delivery as 1 mL over 1.25 s and is wrong for this curve. The actual active mean is 79.3% higher and the physical peak is 137.6% higher. The impact remains 6.5 mm off axis. With the current stub radius of 7 mm, radial clearance from the nominal inner wall is 0.5 mm; this must be recomputed after G1 replaces the stub.

## Calibration status

No entrainment constant was retuned. The wave-13 controlled comparisons are available in `tests/night/wave13c7/calibratedJet.test.ts`, but that replay still uses the legacy radius and a fixed downstream ring. Its outputs are not a G1-corrected calibration. The new direct event hook exercises the measured-lip equations and wet-cell/blocked-force accounting, yet the production field currently passes only a scalar `jetStrength` through `TubeSilverField.advance` to `TubeFlowSolver.step`. An integration change in G1-owned `tubeSilverField.ts` is required to pass an optional event and interval through that path, after a matching runtime handoff from this worker's `tubeSilverRuntime.ts`. Until then, the production flagged jet does not consume extended events. The requested structure comparison with optical-depth thresholds, concentration percentiles, connected regions, mass and source distribution must be run after that integration against the corrected mask. Reference optical kappa is 8.0 (`silverOpticsReference.ts`); no optical-significance claim is made from mere nonzero occupancy.

Files changed in this worker: `lib/tubeDelivery.ts`, `lib/tubePourImpact.ts`, `lib/tubeJetModel.ts`, `ui/PourStream.tsx`, `ui/DiagnosticTools.tsx`, `tests/_wave13/recordRun.mjs`, `tests/night/wave14g2/pourPhysics.test.ts`, and `docs/night/wave14g2/{pour-series.csv,REPORT.md}`.

## Integration requests and remaining issues

1. Share the bottle's world pose and `scratch.lip` computation at a specified stand-clock timestamp from `ReagentContainerInstance.tsx`, so `stepTubePour` can compute its event lip and a finite difference at the event timestamp without depending on render frames. Keep bottle/tube positions and trajectory unchanged.
2. In G1-owned `tubeSilverField.ts`, add an optional event/interval path from `advance` to `TubeFlowSolver.step`, and use it only when `__silverJetModel` is on. Coordinate the corresponding G2 runtime and solver handoff before enabling the flag. The current direct `TubeJetModel.prepare` event hook alone is insufficient.
3. Rerun the controlled baseline, rate-only, distribution-only and both comparisons with G1's corrected geometry and real HIGH/LOW masks. Include optical-depth occupancy at 0.05/0.2/1 using kappa 8, p10/p50/p90/p99, variance, CV, gradients, connected regions, low-concentration region, suspended mass and source distribution. No browser capture is available in this worker.

## Verification

`tsc --noEmit` passed after the final code change. The focused delivery/runtime/solver/jet/G2 group passed 28/28 before the last finite-difference check; the last G2 plus wave4b rerun passed 8 and failed 1, with the sole failure in wave4b. The one full suite run passed 406, failed 3, and had 4 expected failures across 71 files. The three failures were the known numerical assertions in `wave4a/field`, `wave4b/PourStream`, and `wave6perf/flocPerf`. `wave4b` expected 0.251 m and got 0.255 m both in the full suite and alone. Before this change, `tubeLiquidHeight(2.5, tubeEffectiveRadius(0.055))` yields 0.055 m, giving the same world endpoint 0.255 m for the test's root at 0.2 m; the stub's `heightFromVolume` delegates to that expression. Thus wave4b is unchanged by this worker's edit. There were no timeouts in this run. The suite rewrote 42 diagnostic files outside G2 ownership; their HEAD contents and expected Windows working-tree line endings were restored. No browser or visual results are claimed.
