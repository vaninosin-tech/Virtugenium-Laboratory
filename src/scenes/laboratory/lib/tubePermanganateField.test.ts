import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { reactR4, TubePermanganateField } from "./tubePermanganateField";

const up = new THREE.Vector3(0, 1, 0);
const inlet = new THREE.Vector3(0.004, 0.035, 0);

describe("acidic permanganate R4", () => {
  it("consumes 2:5:6 locally and records both dissolved products", () => {
    const r = reactR4(1, 4, 6);
    expect(r).toEqual({ extent: 0.5, manganate: 0, sulfite: 1.5, acid: 3,
      sulfate: 2.5, manganeseII: 1 });
    expect(reactR4(2, 0, 6).extent).toBe(0);
    expect(reactR4(2, 5, 0).extent).toBe(0);
  });

  it("retains a visible MnO4- field in excess and conserves all species", () => {
    const field = new TubePermanganateField("LOW", 0.007, 0, 0.055, 1, 7.2);
    for (let i = 0; i < 80; i++) field.advance(1 / 20, up, 0.045, inlet, 2);
    const mn = field.species["MnO4-"].total;
    const sulfate = field.species["SO4(2-)"].total;
    const manganese = field.species["Mn2+"].total;
    expect(mn).toBeGreaterThan(1.5);
    expect(mn + manganese).toBeCloseTo(2, 7);
    expect(field.species["SO3(2-)"].total + sulfate).toBeCloseTo(1, 7);
    expect(manganese).toBeCloseTo(2 * field.extent, 7);
    for (const species of Object.values(field.species)) for (const value of species.values) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(field.pixels.some(value => value > 0)).toBe(true);
    field.dispose();
  });

  it("uses the sulfite reserve to consume the standard charge", () => {
    const field = new TubePermanganateField("LOW", 0.007, 0, 0.055);
    for (let i = 0; i < 80; i++) {
      field.advance(1 / 20, up, 0.045, inlet, 2);
      if (field.species["MnO4-"].total > 0.1)
        expect(field.progress).toBeLessThan(0.95);
    }
    expect(field.species["MnO4-"].total).toBeLessThan(0.1);
    field.dispose();
  });
});
