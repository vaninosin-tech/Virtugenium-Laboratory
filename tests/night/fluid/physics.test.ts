import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { runFluidPour } from "../../../src/scenes/laboratory/lib/night/fluid/harness";
import { tubeLiquidHeight } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";

describe("night fluid physics", () => {
  it("conserves a bounded nonnegative inert tracer throughout a changing fill", () => {
    for (const grid of ["LOW", "HIGH"] as const) {
      const run = runFluidPour({ grid });
      for (const sample of run.samples) expect(Math.abs(sample.mass - 1)).toBeLessThan(1e-10);
      for (const value of run.tracer) expect(value).toBeGreaterThanOrEqual(0);
      expect(Math.max(...run.tracer)).toBeLessThanOrEqual(1 + 1e-10);
      for (let i = 0; i < run.tracer.length; i++) if (!run.mask.data[i]) expect(run.tracer[i]).toBe(0);
    }
  });

  it("keeps boundary faces closed, including the hemispherical bottom", () => {
    const { mask, solver } = runFluidPour();
    const faces = (solver as unknown as { faces: Float32Array[] }).faces;
    let boundaryFaces = 0, bottomBoundaryFaces = 0, interiorFlow = 0;
    const strides = [1, mask.nx, mask.nx * mask.ny];
    for (let i = 0; i < mask.data.length; i++) {
      const x = i % mask.nx, y = Math.floor(i / mask.nx) % mask.ny;
      const z = Math.floor(i / (mask.nx * mask.ny));
      for (let axis = 0; axis < 3; axis++) {
        const atEdge = [x === mask.nx - 1, y === mask.ny - 1, z === mask.nz - 1][axis];
        const wetPair = !atEdge && mask.data[i] && mask.data[i + strides[axis]];
        if (wetPair) interiorFlow += Math.abs(faces[axis][i]);
        else {
          boundaryFaces++;
          if (y < mask.ny * mask.radius / mask.height) bottomBoundaryFaces++;
          expect(faces[axis][i]).toBe(0);
        }
      }
    }
    expect(boundaryFaces).toBeGreaterThan(0);
    expect(bottomBoundaryFaces).toBeGreaterThan(0);
    expect(interiorFlow).toBeGreaterThan(0);
  });

  it("projects divergence and transfers pour momentum into persistent damped motion", () => {
    const run = runFluidPour();
    const pouring = run.samples[run.pourSteps];
    const coast = run.samples.slice(run.pourSteps);
    expect(pouring.energy).toBeGreaterThan(1e-7);
    expect(pouring.movingFraction).toBeGreaterThan(0.5);
    expect(coast[1].energy).toBeGreaterThan(0);
    expect(coast.at(-1)!.energy).toBeLessThan(coast[0].energy);
    for (let i = 1; i < coast.length; i++)
      expect(coast[i].energy).toBeLessThanOrEqual(coast[i - 1].energy * 1.001);
  });

  it("keeps projected divergence below 0.3 s^-1 throughout the changing fill", () => {
    const run = runFluidPour({ grid: "HIGH" });
    expect(Math.max(...run.samples.slice(1).map(s => s.meanAbsDivergence))).toBeLessThan(0.3);
  });

  it("responds differently to wall and central streams", () => {
    const center = runFluidPour({ inletX: 0 });
    const wall = runFluidPour({ inletX: 0.004 });
    const c = center.samples[center.pourSteps].centroid;
    const w = wall.samples[wall.pourSteps].centroid;
    expect(w[0] - c[0]).toBeGreaterThan(0.001);
    const centerDx = c[0] - center.samples[0].centroid[0];
    const wallDx = w[0] - wall.samples[0].centroid[0];
    expect(centerDx - wallDx).toBeGreaterThan(0.001);
    expect(Math.abs(wall.samples[20].energy - center.samples[20].energy)).toBeGreaterThan(1e-5);
  });

  it("uses tilted gravity-up to change wet cells and tracer trajectory", () => {
    const level = runFluidPour();
    const tilt = runFluidPour({ up: new THREE.Vector3(0.45, 1, 0) });
    let different = 0;
    for (let i = 0; i < level.mask.data.length; i++) different += +(level.mask.data[i] !== tilt.mask.data[i]);
    expect(different).toBeGreaterThan(10);
    expect(tilt.samples.at(-1)!.mass).toBeCloseTo(1, 10);
    expect(new THREE.Vector3(...tilt.samples.at(-1)!.centroid)
      .distanceTo(new THREE.Vector3(...level.samples.at(-1)!.centroid))).toBeGreaterThan(0.0002);
  });

  it("raises the level for exactly 1 ml using the hemispherical volume law", () => {
    const run = runFluidPour();
    expect(run.samples[0].volumeMl).toBe(2.5);
    expect(run.samples[run.pourSteps].volumeMl).toBe(3.5);
    expect(run.samples.at(-1)!.volumeMl).toBe(3.5);
    expect(run.samples[0].level).toBe(tubeLiquidHeight(2.5, 0.007));
    expect(run.samples.at(-1)!.level).toBe(tubeLiquidHeight(3.5, 0.007));
    expect(run.samples.at(-1)!.level - run.samples[0].level).toBeGreaterThan(0.006);
    expect(run.samples.at(-1)!.activeCount).toBeGreaterThan(run.samples[0].activeCount);
  });

  it("is bit identical for repeated inputs", () => {
    const a = runFluidPour(), b = runFluidPour();
    expect(Array.from(a.tracer)).toEqual(Array.from(b.tracer));
    expect(Array.from(a.solver.flow)).toEqual(Array.from(b.solver.flow));
    expect(a.samples.map(s => [s.mass, s.energy, s.meanAbsDivergence, ...s.centroid]))
      .toEqual(b.samples.map(s => [s.mass, s.energy, s.meanAbsDivergence, ...s.centroid]));
  });

  it("keeps LOW and HIGH integral quantities in measured agreement", () => {
    const low = runFluidPour({ grid: "LOW" }), high = runFluidPour({ grid: "HIGH" });
    const ls = low.samples.at(-1)!, hs = high.samples.at(-1)!;
    expect(Math.abs(ls.mass - hs.mass)).toBeLessThan(1e-10);
    expect(new THREE.Vector3(...ls.centroid).distanceTo(new THREE.Vector3(...hs.centroid))).toBeLessThan(0.0035);
  });

  it.fails("known defect: LOW and HIGH mean kinetic energy differs by over 50%", () => {
    const low = runFluidPour({ grid: "LOW" }), high = runFluidPour({ grid: "HIGH" });
    const ls = low.samples.at(-1)!, hs = high.samples.at(-1)!;
    const lowEnergyPerCell = ls.energy / ls.activeCount;
    const highEnergyPerCell = hs.energy / hs.activeCount;
    expect(Math.abs(lowEnergyPerCell - highEnergyPerCell) / Math.max(lowEnergyPerCell, highEnergyPerCell))
      .toBeLessThan(0.5);
  });
});
