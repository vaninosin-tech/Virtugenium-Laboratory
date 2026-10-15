import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LiquidMask } from "../../../src/scenes/laboratory/lib/tubeVolumeField";
import { TubeFlowSolver } from "../../../src/scenes/laboratory/lib/tubeFlowSolver";
import { TUBE_SIMULATION } from "../../../src/scenes/laboratory/lib/tubeSimulationConfig";

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe("tube flow profiling", () => {
  it("prints measured step and transport costs", () => {
    for (const quality of ["LOW", "HIGH"] as const) {
      const grid = TUBE_SIMULATION.jetFlow[quality];
      const mask = new LiquidMask(grid.width, grid.height, grid.depth, 0.007, 0, 0.055);
      mask.update(new THREE.Vector3(0, 1, 0), 0.025);
      const solver = new TubeFlowSolver(mask);
      const tracer = new Float64Array(mask.data.length);
      tracer[mask.active[Math.floor(mask.activeCount / 2)]] = 1;
      const inlet = new THREE.Vector3(0, 0.024, 0);
      const direction = new THREE.Vector3(0, -1, 0);
      const steps: number[] = [], transports: number[] = [];
      for (let i = 0; i < 120; i++) {
        let start = performance.now();
        solver.step(0.05, inlet, direction, i < 60 ? 0.02 : 0);
        const stepMs = performance.now() - start;
        start = performance.now();
        solver.transport(tracer, 0.05, 2e-7);
        const transportMs = performance.now() - start;
        if (i >= 20) { steps.push(stepMs); transports.push(transportMs); }
      }
      console.log(JSON.stringify({ quality, activeCells: mask.activeCount, samples: steps.length,
        stepMedianMs: median(steps), stepMeanMs: steps.reduce((a, b) => a + b, 0) / steps.length,
        transportMedianMs: median(transports), transportMeanMs: transports.reduce((a, b) => a + b, 0) / transports.length }));
      expect(steps.every(v => Number.isFinite(v) && v > 0)).toBe(true);
      expect(transports.every(v => Number.isFinite(v) && v > 0)).toBe(true);
      expect(solver.scalarDiagnostics(tracer).mass).toBeCloseTo(1, 10);
    }
  });
});
