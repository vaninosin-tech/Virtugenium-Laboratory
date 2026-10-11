import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LiquidMask } from "./tubeVolumeField";
import { TubeFlowSolver } from "./tubeFlowSolver";

describe("closed tube flow", () => {
  it("projects local jet momentum, conserves tracer, and coasts after pouring", () => {
    const mask = new LiquidMask(12, 24, 12, 0.007, 0, 0.055);
    mask.update(new THREE.Vector3(0, 1, 0), 0.038);
    const solver = new TubeFlowSolver(mask);
    const inlet = new THREE.Vector3(0.001, 0.037, 0);
    const down = new THREE.Vector3(0, -1, 0);
    const tracer = new Float64Array(mask.data.length);
    let seed = mask.active[0], nearest = Infinity;
    for (let a = 0; a < mask.activeCount; a++) {
      const i = mask.active[a];
      const p = mask.point(i % mask.nx, Math.floor(i / mask.nx) % mask.ny,
        Math.floor(i / (mask.nx * mask.ny)));
      const d = p.distanceToSquared(inlet);
      if (d < nearest) { nearest = d; seed = i; }
    }
    tracer[seed] = 1;
    const initialVariance = solver.scalarDiagnostics(tracer).variance;
    for (let i = 0; i < 20; i++) {
      solver.step(0.05, inlet, down, 0.02);
      solver.transport(tracer, 0.05, 0.0000002);
    }
    const pouring = solver.diagnostics();
    expect(pouring.energy).toBeGreaterThan(0);
    expect(pouring.movingFraction).toBeGreaterThan(0.5);
    expect(pouring.meanAbsDivergence).toBeLessThan(0.3);
    let upward = 0, downward = 0, sideways = 0;
    for (let a = 0; a < mask.activeCount; a++) {
      const i = mask.active[a];
      if (solver.flow[i * 3 + 1] > 1e-5) upward++;
      if (solver.flow[i * 3 + 1] < -1e-5) downward++;
      if (Math.abs(solver.flow[i * 3]) > 1e-5 || Math.abs(solver.flow[i * 3 + 2]) > 1e-5) sideways++;
    }
    expect(upward).toBeGreaterThan(0);
    expect(downward).toBeGreaterThan(0);
    expect(sideways).toBeGreaterThan(mask.activeCount * 0.2);
    const energies = [pouring.energy];
    for (let i = 0; i < 60; i++) {
      solver.step(0.05, inlet, down, 0);
      solver.transport(tracer, 0.05, 0.0000002);
      energies.push(solver.diagnostics().energy);
    }
    const final = solver.scalarDiagnostics(tracer);
    expect(final.mass).toBeCloseTo(1, 8);
    expect(final.variance).toBeGreaterThan(initialVariance);
    expect(final.occupiedFraction).toBeGreaterThan(0.4);
    expect(energies[1]).toBeGreaterThan(0);
    expect(energies[energies.length - 1]).toBeLessThan(energies[0]);
    expect(energies.every((energy, i) => i === 0 || energy <= energies[i - 1] * 1.001)).toBe(true);
    expect(energies.every(Number.isFinite)).toBe(true);
    console.log("flow diagnostics", { pouring, final, energyAfter3s: energies[energies.length - 1] });
  });

  it("mixes a concentrated charge without a checkerboard or mass loss", () => {
    const mask = new LiquidMask(8, 18, 8, 0.007, 0, 0.055);
    mask.update(new THREE.Vector3(0, 1, 0), 0.035);
    const solver = new TubeFlowSolver(mask);
    const tracer = new Float64Array(mask.data.length);
    tracer[mask.index(4, 8, 4)] = 1;
    for (let step = 0; step < 100; step++) solver.transport(tracer, 0.05, 0.00012);
    const result = solver.scalarDiagnostics(tracer);
    expect(result.mass).toBeCloseTo(1, 8);
    expect(result.occupiedFraction).toBeGreaterThan(0.95);
    let even = 0, odd = 0;
    for (let a = 0; a < mask.activeCount; a++) {
      const i = mask.active[a];
      const parity = ((i % mask.nx) + Math.floor(i / mask.nx) % mask.ny
        + Math.floor(i / (mask.nx * mask.ny))) % 2;
      if (parity) odd += tracer[i]; else even += tracer[i];
    }
    expect(Math.abs(even - odd)).toBeLessThan(0.03);
  });
  it("changes the cloud with impact position and flow strength", () => {
    const simulate = (x: number, impulse: number) => {
      const mask = new LiquidMask(12, 24, 12, 0.007, 0, 0.055);
      mask.update(new THREE.Vector3(0, 1, 0), 0.038);
      const solver = new TubeFlowSolver(mask);
      const inlet = new THREE.Vector3(x, 0.037, 0);
      const tracer = new Float64Array(mask.data.length);
      let seed = mask.active[0], nearest = Infinity;
      for (let a = 0; a < mask.activeCount; a++) {
        const i = mask.active[a];
        const p = mask.point(i % mask.nx, Math.floor(i / mask.nx) % mask.ny,
          Math.floor(i / (mask.nx * mask.ny)));
        const d = p.distanceToSquared(inlet);
        if (d < nearest) { nearest = d; seed = i; }
      }
      tracer[seed] = 1;
      for (let step = 0; step < 30; step++) {
        solver.step(0.05, inlet, new THREE.Vector3(0, -1, 0), impulse);
        solver.transport(tracer, 0.05, 0.0000002);
      }
      let centroidX = 0;
      for (let a = 0; a < mask.activeCount; a++) centroidX += tracer[mask.active[a]] * (mask.active[a] % mask.nx);
      return { centroidX, ...solver.scalarDiagnostics(tracer), energy: solver.diagnostics().energy };
    };
    const left = simulate(-0.004, 0.01), middle = simulate(0, 0.01);
    const right = simulate(0.004, 0.01), fast = simulate(0, 0.03);
    expect(left.centroidX).toBeLessThan(middle.centroidX);
    expect(right.centroidX).toBeGreaterThan(middle.centroidX);
    expect(fast.energy).toBeGreaterThan(middle.energy);
    for (const result of [left, middle, right, fast]) expect(result.mass).toBeCloseTo(1, 8);
  });
});
