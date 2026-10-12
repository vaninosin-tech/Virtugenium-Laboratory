import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LiquidMask } from "./tubeVolumeField";
import { precipitatePair, settleParticleClass } from "./tubePrecipitationPhysics";

describe("shared precipitation physics", () => {
  it("forms only above supersaturation and stops at the solubility product", () => {
    const n = 100;
    expect(precipitatePair(0.01, 0, n, 0.001, 0.05)).toBe(0);
    expect(precipitatePair(0.0001, 0.0001, n, 0.001, 0.05)).toBe(0);
    let a = 0.01, b = 0.006, formed = 0;
    for (let step = 0; step < 100; step++) {
      const delta = precipitatePair(a, b, n, 0.001, 0.05, formed);
      a -= delta; b -= delta; formed += delta;
    }
    expect(a + formed).toBeCloseTo(0.01, 12);
    expect(b + formed).toBeCloseTo(0.006, 12);
    expect(a * b * n * n).toBeGreaterThanOrEqual(0.001);
    expect(a * b * n * n).toBeLessThan(0.00102);
  });

  it("moves a particle class along world gravity and conserves its mass", () => {
    const mask = new LiquidMask(8, 18, 8, 0.007, 0, 0.055);
    mask.update(new THREE.Vector3(0.6, 0.8, 0), 0.038);
    const values = new Float64Array(mask.data.length);
    const scratch = new Float64Array(values.length);
    const bed = new Float64Array(mask.nx * mask.nz);
    const i = mask.active[Math.floor(mask.activeCount * 0.6)];
    values[i] = 1;
    const before = values.reduce((sum, value) => sum + value, 0);
    for (let step = 0; step < 500; step++)
      settleParticleClass(mask, values, scratch, new THREE.Vector3(0.6, 0.8, 0), 0.05, 0.002,
        (column, mass) => { bed[column] += mass; });
    const after = values.reduce((sum, value) => sum + value, 0)
      + bed.reduce((sum, value) => sum + value, 0);
    expect(after).toBeCloseTo(before, 12);
    expect(values.every(value => value >= 0 && Number.isFinite(value))).toBe(true);
    expect(bed.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
  });
});
