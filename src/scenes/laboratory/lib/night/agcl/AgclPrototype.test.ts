import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AgclPrototype, fromFloc, toFloc, type VelocitySampler } from "./AgclPrototype";

const still: VelocitySampler = () => [0, 0, 0];
const shear: VelocitySampler = (_x, y) => [120 * y, 0, 0];

describe("isolated AgCl cotton prototype", () => {
  it("conserves fine, aggregate and sediment mass through many seeded runs", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const p = new AgclPrototype(seed % 2 ? still : shear, { seed });
      for (let n = 0; n < 25; n++)
        p.pour([0.002 * Math.sin(n), 0.012 + n * 0.001, 0.001 * Math.cos(n)],
          0.001 + n * 0.00002, n % 3 === 0 ? 0.3 : 0.8);
      p.captureFine(0, 0);
      p.erode(0, 0.19);
      for (let n = 0; n < 200; n++) {
        p.step(0.05);
        if (n % 50 === 0) {
          const column = p.sediment.values.findIndex(v => v > 0);
          if (column >= 0) p.resuspend(column, 0.2, [0, 0.01, 0]);
        }
        expect(Math.abs(p.massError)).toBeLessThan(2e-14);
      }
    }
  }, 30000);

  it("fractures from shear regardless of wall clock or start time", () => {
    const run = () => {
      const p = new AgclPrototype(shear, { seed: 4 });
      p.pour([0, 0.03, 0], 0.02, 1, 0.8);
      p.step(0.05);
      return p.aggregates.map(a => [a.mass, a.position, a.strain]);
    };
    const a = run();
    const originalNow = Date.now;
    try {
      Date.now = () => 123456789;
      expect(run()).toEqual(a);
    } finally { Date.now = originalNow; }
    expect(a.length).toBeGreaterThan(1);
  });

  it("deforms under subcritical shear before any fragmentation", () => {
    const flow: VelocitySampler = (_x, y) => [8 * y, 0, 0];
    const p = new AgclPrototype(flow, { seed: 8 });
    p.pour([0, 0.03, 0], 0.01, 1, 0.6);
    p.step(0.05);
    expect(p.aggregates).toHaveLength(1);
    expect(p.aggregates[0].strain).toBeGreaterThan(0);
    expect(p.aggregates[0].axes[1]).toBeGreaterThan(1);
  });

  it("settles unequal sizes from one moving continuous pour at different depths", () => {
    const flow: VelocitySampler = (x, y) => [0.00003 * Math.sin(y * 90),
      x > 0 ? 0.00015 : 0, 0];
    const p = new AgclPrototype(flow, { seed: 11 });
    for (let n = 0; n < 40; n++) {
      const x = 0.003 * Math.sin(n * 0.15);
      p.pour([x, 0.042, 0], n % 4 === 0 ? 0.03 : 0.0007, 1,
        n % 4 === 0 ? 0.22 : 0.88);
      p.step(0.05);
    }
    for (let n = 0; n < 120; n++) p.step(0.05);
    expect(p.sediment.mass).toBeGreaterThan(0);
    expect(p.aggregates.some(a => a.position[1] > 0.025)).toBe(true);
    expect(p.aggregates.some(a => a.position[1] < 0.025)).toBe(true);
    expect(Math.abs(p.massError)).toBeLessThan(1e-14);
  });

  it("keeps coordinates, masses and soft surface bounded and finite", () => {
    const p = new AgclPrototype(shear, { seed: 22 });
    for (let n = 0; n < 30; n++) p.pour([0.006, 0.052, 0.006], 0.001, 0.8);
    for (let n = 0; n < 100; n++) p.step(0.05);
    for (const a of p.aggregates) {
      expect(a.mass).toBeGreaterThan(0);
      expect(a.porosity).toBeGreaterThanOrEqual(0.08);
      expect(a.porosity).toBeLessThanOrEqual(0.95);
      expect(Math.hypot(a.position[0], a.position[2])).toBeLessThanOrEqual(p.radius);
      expect(a.position[1]).toBeGreaterThanOrEqual(p.floor(a.position[0], a.position[2]));
      for (const v of [...a.position, ...a.velocity, ...a.axes, ...a.modes,
        p.surfaceRadius(a, [0.3, 0.8, 0.52])]) expect(Number.isFinite(v)).toBe(true);
    }
    for (const f of p.fine) expect(Number.isFinite(f.mass) && f.mass > 0).toBe(true);
    for (const m of p.sediment.values) expect(Number.isFinite(m) && m >= 0).toBe(true);
  });

  it("repeats exactly with the same seed and calls", () => {
    const run = () => {
      const p = new AgclPrototype(shear, { seed: 71 });
      for (let n = 0; n < 8; n++) { p.pour([n * 0.0003, 0.035, 0], 0.006); p.step(0.05); }
      for (let n = 0; n < 50; n++) p.step(0.05);
      return { aggregates: p.aggregates, fine: p.fine,
        sediment: [...p.sediment.values], mass: p.totalMass };
    };
    expect(run()).toEqual(run());
  });

  it("round-trips the production FlocAggregate fields", () => {
    const p = new AgclPrototype(still, { seed: 9 });
    const floc = { position: new THREE.Vector3(0.001, 0.03, -0.002),
      velocity: new THREE.Vector3(0, -0.001, 0), mass: 0.012,
      porosity: 0.7, shape: 77, segregated: true };
    const result = toFloc(fromFloc(floc, p));
    expect(result.position.toArray()).toEqual(floc.position.toArray());
    expect(result.velocity.toArray()).toEqual(floc.velocity.toArray());
    expect(result.mass).toBe(floc.mass);
    expect(result.porosity).toBe(floc.porosity);
    expect(result.shape).toBe(floc.shape);
    expect(result.segregated).toBe(floc.segregated);
  });
});
