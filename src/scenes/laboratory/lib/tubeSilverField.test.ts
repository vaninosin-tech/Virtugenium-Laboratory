import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { reactR2, TubeSilverField } from "./tubeSilverField";
import { tubeVessel } from "./vesselGeometry";

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
    // Stage 1 mixes the stream into the liquid more slowly (jet 0.03, ion diffusion lowered), so less reacts in 12 s.
    expect(field.extent).toBeGreaterThan(0.3);
    expect(field.totalSolidMass).toBeCloseTo(field.extent, 5);
    expect(field.species["Ag+"].total + field.extent).toBeCloseTo(1.15, 5);
    expect(field.species["Cl-"].total + field.extent).toBeCloseTo(field.delivered, 5);
    for (const value of [...field.flocs.map(floc => floc.mass), ...field.pixels])
      expect(Number.isFinite(value) && value >= 0).toBe(true);
    field.dispose();
  }, 30000);

  it("keeps all silver scalar amounts in wet cells while the level rises and the tube tilts", () => {
    const field = new TubeSilverField("LOW", tubeVessel.innerRadius, 0,
      tubeVessel.heightFromVolume(tubeVessel.capacityMl));
    const inlet = new THREE.Vector3(0, tubeVessel.heightFromVolume(1), 0);
    const upright = new THREE.Vector3(0, 1, 0);
    const arrays = () => [...Object.values(field.species).map(s => s.values),
      ...field.suspension, field.coarse, field.tracer, field.dense, ...field.denseCoordinates];
    const totals = () => arrays().map(values => values.reduce((sum, value) => sum + value, 0));
    const assertDryEmpty = () => {
      for (const values of arrays()) for (let i = 0; i < values.length; i++)
        if (!field.mask.data[i]) expect(Math.abs(values[i])).toBeLessThan(1e-12);
    };
    field.advance(0.05, upright, tubeVessel.heightFromVolume(1), inlet, 0);
    const before = totals();
    field.advance(0.05, upright, tubeVessel.heightFromVolume(2), inlet, 0);
    const afterRise = totals();
    before.forEach((value, index) => expect(afterRise[index]).toBeCloseTo(value, 12));
    assertDryEmpty();
    const tilt = new THREE.Vector3(0.5, Math.sqrt(0.75), 0);
    const beforeTilt = totals();
    field.advance(0.05, tilt, tubeVessel.heightFromVolume(2), inlet, 0);
    const afterTilt = totals();
    beforeTilt.forEach((value, index) => expect(afterTilt[index]).toBeCloseTo(value, 12));
    assertDryEmpty();
    field.dispose();
  });
});
