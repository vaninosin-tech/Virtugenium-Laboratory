import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LiquidMask } from "../../../src/scenes/laboratory/lib/tubeVolumeField";
import { TubeFlowSolver } from "../../../src/scenes/laboratory/lib/tubeFlowSolver";
import { tubeLiquidHeight } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";
import { nearestWetCell, runFluidPour } from "../../../src/scenes/laboratory/lib/night/fluid/harness";

describe("overnight tube fluid physics", () => {
  it("conserves a nonnegative, bounded inert tracer during the pour and coast", () => {
    for (const quality of ["LOW", "HIGH"] as const) {
      const run = runFluidPour({ quality });
      expect(Math.max(...run.samples.map(s => Math.abs(s.mass - 1)))).toBeLessThan(1e-10);
      expect(run.tracer.every(v => Number.isFinite(v) && v >= 0 && v <= 1 + 1e-12)).toBe(true);
    }
  });

  it("keeps wall and hemispherical-floor tracer inside wet cells", () => {
    const mask = new LiquidMask(12, 24, 12, 0.007, 0, 0.055);
    mask.update(new THREE.Vector3(0, 1, 0), tubeLiquidHeight(2.5, 0.007));
    const solver = new TubeFlowSolver(mask);
    const wall = nearestWetCell(mask, new THREE.Vector3(0.0068, 0.018, 0));
    const floor = nearestWetCell(mask, new THREE.Vector3(0, 0.0001, 0));
    expect(mask.data[wall]).toBe(1);
    expect(mask.data[floor]).toBe(1);
    for (const seed of [wall, floor]) {
      const tracer = new Float64Array(mask.data.length);
      tracer[seed] = 1;
      for (let n = 0; n < 40; n++) {
        solver.step(0.05, new THREE.Vector3(0.004, 0.02, 0), new THREE.Vector3(0, -1, 0), n < 20 ? 0.02 : 0);
        solver.transport(tracer, 0.05, 2e-7);
      }
      expect(solver.scalarDiagnostics(tracer).mass).toBeCloseTo(1, 10);
      for (let i = 0; i < tracer.length; i++) if (!mask.data[i]) expect(tracer[i]).toBe(0);
    }
  });

  it("projects the flow to small mean absolute divergence", () => {
    const run = runFluidPour();
    const maximum = Math.max(...run.samples.map(s => s.meanAbsDivergence));
    expect(maximum).toBeLessThan(0.3);
    expect(run.samples.some(s => s.energy > 1e-5)).toBe(true);
  });

  it("receives momentum from the pour, coasts, and loses energy monotonically", () => {
    const run = runFluidPour();
    const energies = run.samples.map(s => s.energy);
    expect(energies[run.pourSteps - 1]).toBeGreaterThan(1e-5);
    expect(energies[run.pourSteps]).toBeGreaterThan(0);
    expect(energies.at(-1)!).toBeLessThan(energies[run.pourSteps - 1] * 0.5);
    for (let i = run.pourSteps; i < energies.length; i++)
      expect(energies[i]).toBeLessThanOrEqual(energies[i - 1] * 1.001);
  });

  it("moves the tracer differently for central and near-wall impacts", () => {
    const center = runFluidPour({ impactX: 0, coastSteps: 10 });
    const wall = runFluidPour({ impactX: 0.004, coastSteps: 10 });
    const cx = center.samples.at(-1)!.centroid[0];
    const wx = wall.samples.at(-1)!.centroid[0];
    expect(Math.abs(wx - cx)).toBeGreaterThan(0.001);
  });

  it("uses the changed gravity-up vector to reshape the wet domain and flow", () => {
    const upright = runFluidPour({ coastSteps: 10 });
    const tilted = runFluidPour({ tiltRadians: Math.PI / 8, coastSteps: 10 });
    let differentCells = 0;
    for (let i = 0; i < upright.mask.data.length; i++)
      if (upright.mask.data[i] !== tilted.mask.data[i]) differentCells++;
    expect(differentCells).toBeGreaterThan(20);
    expect(Math.abs(upright.samples.at(-1)!.centroid[0] - tilted.samples.at(-1)!.centroid[0])).toBeGreaterThan(0.0002);
    expect(tilted.samples.at(-1)!.mass).toBeCloseTo(1, 10);
  });

  it("raises the level by the exact analytic volume relation", () => {
    const run = runFluidPour({ coastSteps: 0 });
    expect(run.samples.at(-1)!.deliveredMl).toBeCloseTo(1, 12);
    expect(run.samples.some(s => s.level > tubeLiquidHeight(2.5, 0.007))).toBe(true);
    expect(run.samples.at(-1)!.level).toBeCloseTo(tubeLiquidHeight(3.5, 0.007), 12);
    expect(run.samples.at(-1)!.activeCount).toBeGreaterThan(run.samples[0].activeCount);
  });

  it("is bit-identical for repeated inputs", () => {
    const a = runFluidPour({ coastSteps: 15, impactX: 0.002 });
    const b = runFluidPour({ coastSteps: 15, impactX: 0.002 });
    expect(Array.from(a.tracer)).toEqual(Array.from(b.tracer));
    expect(Array.from(a.solver.flow)).toEqual(Array.from(b.solver.flow));
    expect(a.samples.map(({ energy, mass, centroid, meanAbsDivergence }) =>
      [energy, mass, ...centroid, meanAbsDivergence])).toEqual(b.samples.map(({ energy, mass, centroid, meanAbsDivergence }) =>
      [energy, mass, ...centroid, meanAbsDivergence]));
  });

  it("agrees between LOW and HIGH grids on integral quantities", () => {
    const low = runFluidPour({ quality: "LOW" });
    const high = runFluidPour({ quality: "HIGH" });
    const l = low.samples.at(-1)!, h = high.samples.at(-1)!;
    expect(Math.abs(l.mass - h.mass)).toBeLessThan(1e-10);
    expect(Math.abs(l.centroid[1] - h.centroid[1])).toBeLessThan(0.006);
  });

  it.fails("known defect: LOW and HIGH velocity energies disagree after coasting", () => {
    const low = runFluidPour({ quality: "LOW" });
    const high = runFluidPour({ quality: "HIGH" });
    const l = low.samples.at(-1)!, h = high.samples.at(-1)!;
    expect(Math.abs(l.energy - h.energy) / Math.max(l.energy, h.energy)).toBeLessThan(0.6);
  });
});
