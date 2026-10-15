import { expect, it } from "vitest";
import * as THREE from "three";
import { performance } from "node:perf_hooks";
import { LiquidMask } from "../../../src/scenes/laboratory/lib/tubeVolumeField";
import { TubeFlowSolver } from "../../../src/scenes/laboratory/lib/tubeFlowSolver";
import { TUBE_SIMULATION } from "../../../src/scenes/laboratory/lib/tubeSimulationConfig";
import { runFluidPour } from "../../../src/scenes/laboratory/lib/night/fluid/harness";

it("profiles step and transport on fixed LOW and HIGH masks", () => {
  for (const resolution of ["LOW", "HIGH"] as const) {
    const grid = TUBE_SIMULATION.jetFlow[resolution];
    const mask = new LiquidMask(grid.width, grid.height, grid.depth, 0.007, 0, 0.055);
    mask.update(new THREE.Vector3(0, 1, 0), 0.038);
    const solver = new TubeFlowSolver(mask);
    const tracer = new Float64Array(mask.data.length);
    tracer[mask.active[Math.floor(mask.activeCount / 2)]] = 1;
    const inlet = new THREE.Vector3(0, 0.037, 0), down = new THREE.Vector3(0, -1, 0);
    const stepMs: number[] = [], transportMs: number[] = [];
    for (let n = 0; n < 100; n++) {
      let start = performance.now();
      solver.step(0.05, inlet, down, n < 20 ? 0.02 : 0);
      const stepped = performance.now();
      solver.transport(tracer, 0.05, 2e-7);
      const transported = performance.now();
      if (n >= 20) { stepMs.push(stepped - start); transportMs.push(transported - stepped); }
    }
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    console.log("PROFILE", resolution, { wetCells: mask.activeCount, measuredSteps: stepMs.length,
      meanStepMs: mean(stepMs), meanTransportMs: mean(transportMs) });
    expect(stepMs.every(v => Number.isFinite(v) && v > 0)).toBe(true);
    expect(transportMs.every(v => Number.isFinite(v) && v > 0)).toBe(true);
  }
  for (const grid of ["LOW", "HIGH"] as const) {
    const run = runFluidPour({ grid });
    const final = run.samples.at(-1)!;
    const coast = run.samples.slice(run.pourSteps);
    console.log("DIAGNOSTICS", grid, { initialWet: run.samples[0].activeCount,
      finalWet: final.activeCount, initialLevel: run.samples[0].level, finalLevel: final.level,
      pourEnergy: coast[0].energy, coastEnergy: final.energy,
      peakDivergence: Math.max(...run.samples.map(s => s.meanAbsDivergence)),
      peakDivergenceStep: run.samples.reduce((best, s) => s.meanAbsDivergence > best.meanAbsDivergence ? s : best).step,
      centroid: final.centroid, mass: final.mass });
    expect(Number.isFinite(final.energy)).toBe(true);
  }
  for (const pressureIterations of [12, 24, 48]) {
    const run = runFluidPour({ grid: "HIGH", coastSteps: 0, pressureIterations });
    console.log("PROJECTION", pressureIterations,
      Math.max(...run.samples.map(s => s.meanAbsDivergence)));
  }
  const center = runFluidPour({ inletX: 0, coastSteps: 0 });
  const wall = runFluidPour({ inletX: 0.004, coastSteps: 0 });
  console.log("STREAM", {
    centerInitial: center.samples[0].centroid,
    centerFinal: center.samples.at(-1)!.centroid,
    wallInitial: wall.samples[0].centroid,
    wallFinal: wall.samples.at(-1)!.centroid,
    centerEnergy: center.samples.at(-1)!.energy,
    wallEnergy: wall.samples.at(-1)!.energy,
  });
});
