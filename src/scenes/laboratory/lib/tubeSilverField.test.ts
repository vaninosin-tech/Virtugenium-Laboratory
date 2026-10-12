import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { reactR2, TubeSilverField } from "./tubeSilverField";

describe("AgCl R2 field", () => {
  it("reacts only where both ions meet and consumes them equally", () => {
    expect(reactR2(1.15, 0).precipitate).toBe(0);
    expect(reactR2(0, 1).precipitate).toBe(0);
    const r = reactR2(1.15, 1);
    expect(r.silver).toBeCloseTo(0.15);
    expect(r.chloride).toBe(0);
    expect(r.precipitate).toBe(1);
  });

  it("keeps ions and fine, floc, and sediment mass balanced after pouring and shaking", () => {
    const field = new TubeSilverField("LOW", 0.007, 0, 0.055);
    const up = new THREE.Vector3(0, 1, 0);
    const inlet = new THREE.Vector3(0.004, 0.037, 0);
    field.advance(0.05, up, 0.038, inlet, 0);
    expect(field.extent).toBe(0);
    for (let i = 0; i < 240; i++) field.advance(0.05, up, 0.038, inlet,
      Math.min(1, (i + 1) / 26), i > 160 && i < 180 ? 0.8 : 0);
    expect(field.extent).toBeGreaterThan(0.5);
    expect(field.totalSolidMass).toBeCloseTo(field.extent, 5);
    expect(field.species["Ag+"].total + field.extent).toBeCloseTo(1.15, 5);
    expect(field.species["Cl-"].total + field.extent).toBeCloseTo(field.delivered, 5);
    for (const value of [...field.flocs.map(floc => floc.mass), ...field.pixels])
      expect(Number.isFinite(value) && value >= 0).toBe(true);
    field.dispose();
  }, 30000);
});
