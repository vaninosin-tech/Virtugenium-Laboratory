import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TubeVolumeField } from "./tubeVolumeField";
import { copperReactionState } from "./tubeReactions";

const up = new THREE.Vector3(0, 1, 0);
const make = () => new TubeVolumeField("LOW", 1, 0, 4,
  [new THREE.Vector3(0.12, 0.9, 0.08), new THREE.Vector3(-0.2, 1.1, -0.1)]);
const run = (fps: number, reacting = true) => {
  const field = make();
  for (let frame = 1; frame <= fps * 3; frame++)
    field.advance(1 / fps, reacting ? Math.min(0.48, frame / fps * 0.16) : 0, up, 2.8, 0.4);
  return field;
};

describe("closed 3D Cu(II) field", () => {
  it("uses R1 bookkeeping and no product from heat alone or after completion", () => {
    expect(copperReactionState(0.25).copper).toBeCloseTo(2.5875);
    expect(copperReactionState(0.25).acid).toBeCloseTo(3.3);
    expect(copperReactionState(0.25).copperII).toBeCloseTo(0.4125);
    const field = make();
    field.advance(1, 0, up, 2.8, 1);
    expect(field.copperII).toBe(0);
    for (let i = 0; i < 30; i++) field.advance(1 / 30, 1, up, 2.8, 1);
    expect(field.copperII).toBeCloseTo(1.65, 10);
    const produced = field.copperII;
    field.advance(1, 1, up, 2.8, 1);
    expect(field.copperII).toBeCloseTo(produced, 10);
    expect(field.reaction.nitricOxide).toBeCloseTo(1.1);
    field.dispose();
  });

  it("drops excess frame time after two model steps without losing reaction product", () => {
    const field = make();
    field.advance(0.25, 0.2, up, 2.8, 0.7);
    expect(Reflect.get(field, "time")).toBeCloseTo(0.1, 10);
    expect(field.copperII).toBeCloseTo(0.33, 10);
    field.advance(0, 0.2, up, 2.8, 0.7);
    expect(Reflect.get(field, "time")).toBeCloseTo(0.1, 10);
    field.dispose();
  });

  it("conserves mass through transport and a tilted meniscus without negative or external voxels", () => {
    const field = make();
    field.advance(1 / 20, 0.2, up, 2.8, 0.7);
    const initial = field.copperII;
    const tilted = new THREE.Vector3(0.2, 0.97, 0.12).normalize();
    for (let i = 0; i < 90; i++) field.advance(1 / 30, 0.2, tilted, 2.8, 0.7);
    expect(field.copperII).toBeCloseTo(initial, 10);
    field.species["Cu2+"].values.forEach((value, i) => {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      if (!field.mask.data[i]) expect(value).toBe(0);
    });
    field.dispose();
  });

  it("integrates the same amount at 30, 60 and 144 display FPS", () => {
    const fields = [30, 60, 144].map(fps => run(fps));
    for (const field of fields) expect(field.copperII).toBeCloseTo(0.792, 8);
    const a = fields[0].species["Cu2+"].values;
    for (const field of fields.slice(1)) {
      const b = field.species["Cu2+"].values;
      let difference = 0;
      for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
      expect(difference).toBeLessThan(0.1);
    }
    fields.forEach(field => field.dispose());
  });

  it("carries warm copper ions into the upper liquid while conserving their amount", () => {
    const field = new TubeVolumeField("LOW", 0.007, 0, 0.055,
      [new THREE.Vector3(0.002, 0.009, 0), new THREE.Vector3(-0.002, 0.009, 0)]);
    const level = 0.055;
    for (let frame = 1; frame <= 30 * 35; frame++)
      field.advance(1 / 30, Math.min(1, frame / (30 * 29)), up, level, 0.8, 0.9);
    let upper = 0;
    const bands = [0, 0, 0, 0];
    field.species["Cu2+"].values.forEach((value, index) => {
      const y = Math.floor(index / field.mask.nx) % field.mask.ny;
      bands[Math.min(3, Math.floor(y / field.mask.ny * 4))] += value;
      if (field.mask.bottom + (y + 0.5) / field.mask.ny * field.mask.height > level * 0.55) upper += value;
    });
    expect(field.copperII).toBeCloseTo(1.65, 8);
    expect(bands[0]).toBeGreaterThan(0.19);
    expect(bands[2]).toBeGreaterThan(0.33);
    expect(bands[3]).toBeGreaterThan(0.27);
    expect(upper).toBeGreaterThan(0.55);
    field.dispose();
  });

  it("keeps steady and moving-meniscus steps within a soft CPU budget", () => {
    for (const quality of ["LOW", "HIGH"] as const) {
      const field = new TubeVolumeField(quality, 0.007, 0, 0.055,
        [new THREE.Vector3(0, 0.009, 0)]);
      for (let i = 0; i < 20; i++) field.advance(1 / 20, i / 200, up, 0.044, 0.8, 0.9);
      const start = performance.now();
      for (let i = 0; i < 40; i++)
        field.advance(1 / 20, (i + 20) / 200, up, 0.044 + Math.sin(i * 0.1) * 0.0001, 0.8, 0.9);
      const milliseconds = (performance.now() - start) / 40;
      console.log(`${quality} TubeVolumeField.advance: ${milliseconds.toFixed(2)} ms`);
      expect(milliseconds).toBeLessThan(quality === "LOW" ? 2 : 6);
      field.dispose();
    }
  });
});
