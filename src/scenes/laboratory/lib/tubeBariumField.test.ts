import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { reactR3, TubeBariumField } from "./tubeBariumField";
import { BariumSedimentField, BariumSedimentGeometry } from "./tubeBariumSediment";

describe("BaSO4 R3 field", () => {
  it("reacts only on contact and preserves both ions", () => {
    expect(reactR3(1, 0).precipitate).toBe(0);
    expect(reactR3(0, 1).precipitate).toBe(0);
    const r = reactR3(0.3, 0.2);
    expect(r.barium + r.precipitate).toBeCloseTo(0.3);
    expect(r.sulfate + r.precipitate).toBeCloseTo(0.2);
  });

  it("keeps the first seconds local while progress follows R3", () => {
    const field = new TubeBariumField("LOW", 0.007, 0, 0.055);
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.004, 0.037, 0);
    const progress: number[] = [];
    for (let i = 1; i <= 60; i++) {
      const time = i * 0.05;
      field.advance(0.05, up, 0.038, inlet, THREE.MathUtils.smoothstep(time, 0, 1.3));
      if ([10, 20, 40, 60].includes(i)) progress.push(field.progress);
    }
    expect(progress[0]).toBeLessThan(0.5);
    expect(progress[1]).toBeLessThan(0.9);
    expect(progress[2]).toBeGreaterThan(progress[0]);
    expect(progress[3]).toBeGreaterThan(progress[2]);
    field.dispose();
  });

  it("introduces sulfate at the inlet instead of filling the column", () => {
    const field = new TubeBariumField("LOW", 0.007, 0, 0.055);
    const inlet = new THREE.Vector3(0.004, 0.037, 0);
    field.advance(0.05, new THREE.Vector3(0, 1, 0), 0.038, inlet, 0.1);
    const sulfate = field.species["SO4(2-)"].values;
    for (let a = 0; a < field.mask.activeCount; a++) {
      const i = field.mask.active[a];
      const y = Math.floor(i / field.mask.nx) % field.mask.ny;
      if (field.mask.point(0, y, 0).y < inlet.y - 2 * field.mask.radius)
        expect(sulfate[i]).toBe(0);
    }
    field.dispose();
  });

  it("conserves suspension and sediment through settling and shaking", () => {
    const field = new TubeBariumField("LOW", 0.007, 0, 0.055);
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.004, 0.037, 0);
    for (let i = 0; i < 100; i++) field.advance(0.05, up, 0.038, inlet, 1);
    expect(field.extent).toBeGreaterThan(0);
    const assertBalance = () => {
      expect(field.suspensionMass + field.coarseMass + field.sedimentMass).toBeCloseTo(field.extent, 5);
      expect(field.species["Ba2+"].total + field.extent).toBeCloseTo(1.1, 5);
      expect(field.species["SO4(2-)"].total + field.extent).toBeCloseTo(field.delivered, 5);
      for (const values of [...field.suspension, field.coarse, ...Object.values(field.species).map(s => s.values)])
        for (const amount of values) expect(Number.isFinite(amount) && amount >= 0).toBe(true);
      for (const value of field.pixels) expect(Number.isFinite(value)).toBe(true);
      for (const parameter of [field.delivered, field.extent, field.progress])
        expect(Number.isFinite(parameter)).toBe(true);
    };
    assertBalance();
    for (let i = 0; i < 100; i++) field.advance(0.05, up, 0.038, inlet, 1);
    assertBalance();
    const sediment = field.sedimentMass;
    for (let i = 0; i < 20; i++) field.advance(0.05, up, 0.038, inlet, 1, 1);
    expect(field.sedimentMass).toBeLessThan(sediment);
    assertBalance();
    field.dispose();
  }, 30000);

  it("clears upper voxels as particles settle into the bottom reservoir", () => {
    const field = new TubeBariumField("LOW", 0.007, 0, 0.055);
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.004, 0.037, 0);
    const upperMass = () => {
      let mass = 0;
      for (let a = 0; a < field.mask.activeCount; a++) {
        const i = field.mask.active[a];
        const y = Math.floor(i / field.mask.nx) % field.mask.ny;
        if (y > field.mask.ny * 0.52)
          for (const size of field.suspension) mass += size[i];
      }
      return mass;
    };
    for (let i = 0; i < 80; i++) field.advance(0.05, up, 0.038, inlet, 1);
    const early = upperMass();
    for (let i = 0; i < 1120; i++) field.advance(0.05, up, 0.038, inlet, 1);
    expect(upperMass()).toBeLessThan(early * 0.5);
    expect(field.sedimentMass).toBeGreaterThan(0.1);
    expect(field.suspensionMass + field.coarseMass + field.sedimentMass).toBeCloseTo(field.extent, 5);
    field.dispose();
  }, 60000);
  it("grows a closed bottom layer with deposited mass", () => {
    const sediment = new BariumSedimentField(8, 8);
    const geometry = new BariumSedimentGeometry(0.007, 0);
    sediment.deposit(4 * 8 + 4, 0.1);
    geometry.update(sediment);
    const positions = geometry.getAttribute("position");
    const shallow = positions.getY(0);
    sediment.deposit(4 * 8 + 4, 0.7);
    geometry.update(sediment);
    expect(positions.getY(0)).toBeGreaterThan(shallow);
    expect(positions.getY(0)).toBeGreaterThan(0.002);
    expect(geometry.index?.count).toBeGreaterThan(0);
    geometry.dispose();
  });
  it("keeps a wall impact distinct from a central impact", () => {
    const run = (x: number) => {
      const field = new TubeBariumField("LOW", 0.007, 0, 0.055);
      const up = new THREE.Vector3(0, 1, 0);
      const inlet = new THREE.Vector3(x, 0.037, 0);
      for (let step = 1; step <= 20; step++)
        field.advance(0.05, up, 0.038, inlet,
          THREE.MathUtils.smoothstep(step * 0.05, 0, 1.3));
      let centroidX = 0;
      for (let a = 0; a < field.mask.activeCount; a++) {
        const i = field.mask.active[a];
        centroidX += field.tracer[i] * field.mask.point(i % field.mask.nx,
          Math.floor(i / field.mask.nx) % field.mask.ny,
          Math.floor(i / (field.mask.nx * field.mask.ny))).x;
      }
      centroidX /= field.delivered;
      const result = { centroidX, formed: field.extent };
      field.dispose();
      return result;
    };
    const center = run(0), wall = run(0.0057);
    expect(wall.centroidX - center.centroidX).toBeGreaterThan(0.001);
    expect(wall.formed).toBeGreaterThan(0);
  });
});
