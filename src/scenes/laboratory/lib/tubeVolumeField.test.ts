import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TubeVolumeField } from "./tubeVolumeField";
import { copperReactionState } from "./tubeReactions";
import { tubeLiquidHeight } from "./tubeLiquidLevel";

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
    const level = 0.0233;
    for (let frame = 1; frame <= 30 * 35; frame++)
      field.advance(1 / 30, Math.min(1, frame / (30 * 29)), up, level, 0.8, 0.9);
    let upper = 0;
    field.species["Cu2+"].values.forEach((value, index) => {
      const y = Math.floor(index / field.mask.nx) % field.mask.ny;
      if (field.mask.bottom + (y + 0.5) / field.mask.ny * field.mask.height > level * 0.55) upper += value;
    });
    expect(field.copperII).toBeCloseTo(1.65, 8);
    expect(upper).toBeGreaterThan(0.4);
    const cold = new TubeVolumeField("LOW", 0.007, 0, 0.055,
      [new THREE.Vector3(0.002, 0.009, 0), new THREE.Vector3(-0.002, 0.009, 0)]);
    for (let frame = 1; frame <= 30 * 35; frame++)
      cold.advance(1 / 30, Math.min(1, frame / (30 * 29)), up, level, 0.8, 0);
    let coldUpper = 0;
    cold.species["Cu2+"].values.forEach((value, index) => {
      const y = Math.floor(index / cold.mask.nx) % cold.mask.ny;
      if (cold.mask.bottom + (y + 0.5) / cold.mask.ny * cold.mask.height > level * 0.55) coldUpper += value;
    });
    expect(upper).toBeGreaterThan(coldUpper + 0.18);
    cold.dispose();
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
      expect(milliseconds).toBeLessThan(quality === "LOW" ? 3 : 20);
      field.dispose();
    }
  });

  it("retains stoichiometric copper and optical density after completion", () => {
    const field = new TubeVolumeField("LOW", 0.007, 0, 0.055,
      [new THREE.Vector3(0.002, 0.009, 0), new THREE.Vector3(-0.002, 0.009, 0)]);
    const samples: { seconds: number; mass: number; optical: number }[] = [];
    for (let frame = 1; frame <= 60 * 20; frame++) {
      const seconds = frame / 20;
      field.advance(0.05, Math.min(1, seconds / 25), up, 0.05, 0.7, 0.9);
      if (frame === 500 || frame === 800 || frame === 1200) {
        const pixels = field.current.image.data as Float32Array;
        let optical = 0;
        for (const value of pixels) optical += 1.7 * value + 2.4 * value ** 1.35;
        samples.push({ seconds, mass: field.copperII, optical });
      }
    }
    console.log("Cu completion diagnostics", samples);
    for (const sample of samples) {
      expect(sample.mass).toBeCloseTo(1.65, 8);
      expect(sample.optical).toBeGreaterThan(0);
    }
    expect(samples[2].optical).toBeGreaterThan(samples[0].optical * 0.8);
    field.dispose();
  });

  it("produces Cu(II) only where delivered acid reaches copper", () => {
    const sources = [0].flatMap((cx, grain) =>
      Array.from({ length: 24 }, (_, k) => {
        const y = 1 - 2 * (k + 0.5) / 24;
        const angle = k * Math.PI * (3 - Math.sqrt(5)) + grain * 1.7;
        const radial = Math.sqrt(1 - y * y);
        return new THREE.Vector3(cx + 0.003 * radial * Math.cos(angle),
          0.005 + 0.003 * y, 0.003 * radial * Math.sin(angle));
      }));
    const field = new TubeVolumeField("LOW", 0.007, 0, 0.055,
      sources);
    field.setSources(sources);
    const delivery = { inlet: new THREE.Vector3(0, 0.043, 0),
      direction: new THREE.Vector3(0, -1, 0), deliveredMl: 0 };
    field.advance(0.05, 0.1, up, 0.05, 0.7, 0.9,
      undefined, undefined, undefined, undefined, delivery);
    expect(field.copperII).toBe(0);
    let earlyCopper = 0;
    for (let frame = 1; frame <= 40 * 20; frame++) {
      const seconds = frame / 20;
      delivery.deliveredMl = Math.min(1, seconds / 2);
      field.advance(0.05, Math.min(1, seconds / 25), up, 0.05, 0.7, 0.9,
        undefined, undefined, undefined, undefined, delivery);
      if (frame === 60) earlyCopper = field.copperII;
    }
    expect(earlyCopper).toBeGreaterThan(0);
    expect(field.copperII).toBeGreaterThan(1.5);
    expect(field.copperII).toBeLessThanOrEqual(1.65);
    expect(field.copperII).toBeCloseTo(1.65 * field.reaction.extent, 8);
    expect(field.species.HNO3.total).toBeCloseTo(4.4 * (1 - field.reaction.extent), 8);
    field.dispose();
  });

  it("wets a copper granule after a one millilitre pour against the upper wall", () => {
    const radius = 0.007;
    const level = tubeLiquidHeight(1, radius);
    const sources = Array.from({ length: 24 }, (_, k) => {
      const elevation = 1 - 2 * (k + 0.5) / 24;
      const angle = k * Math.PI * (3 - Math.sqrt(5));
      const radial = Math.sqrt(1 - elevation * elevation);
      return new THREE.Vector3(0.003 * radial * Math.cos(angle),
        0.005 + 0.003 * elevation, 0.003 * radial * Math.sin(angle));
    });
    const field = new TubeVolumeField("LOW", radius, 0, level + radius * 0.2, sources);
    field.setSources(sources);
    const delivery = { inlet: new THREE.Vector3(radius * 0.93, 0.045, 0),
      direction: new THREE.Vector3(0, -1, 0), deliveredMl: 0 };
    delivery.deliveredMl = 0.2;
    field.advance(0.05, 0, up, level, 0, 0,
      undefined, undefined, undefined, undefined, delivery);
    const sourceCells = Reflect.get(field, "sourceCells") as number[];
    const acid = field.species.HNO3.values;
    const halves = [0, 0], counts = [0, 0];
    for (const i of sourceCells) {
      const y = Math.floor(i / field.mask.nx) % field.mask.ny;
      const half = y >= field.mask.ny * 0.2 ? 1 : 0;
      halves[half] += acid[i]; counts[half]++;
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(0);
    expect(halves[1] / counts[1]).toBeGreaterThan(halves[0] / counts[0]);
    const samples: number[] = [];
    for (let frame = 1; frame <= 20 * 60; frame++) {
      const seconds = frame / 20;
      delivery.deliveredMl = Math.min(1, seconds / 2);
      field.advance(0.05, Math.min(0.6, seconds * 0.01), up, level,
        0.2, 0, undefined, undefined, undefined, undefined, delivery);
      if ([15, 60].includes(seconds)) samples.push(field.copperII);
    }
    expect(samples[0]).toBeGreaterThan(0.05);
    expect(samples[1]).toBeGreaterThan(0.4);
    expect(field.species.HNO3.total + field.copperII * 4.4 / 1.65).toBeCloseTo(4.4, 6);
    field.dispose();
  });

  it("moves bubble wake parcels upward without creating or losing Cu(II)", () => {
    const field = new TubeVolumeField("LOW", 0.007, 0, 0.055,
      [new THREE.Vector3(0, 0.005, 0)]);
    field.advance(0.05, 0.5, up, 0.0233);
    const initial = field.copperII;
    const bubbles = { state: new Uint8Array([2]), x: new Float32Array([0]),
      y: new Float32Array([0.006]), z: new Float32Array([0]), size: new Float32Array([0.0005]) };
    const center = new THREE.Vector3();
    for (let step = 0; step < 5; step++) {
      bubbles.y[0] = 0.006 + step * 0.002;
      field.advance(0.05, 0.5, up, 0.0233, 0.5, 0.5,
        undefined, undefined, bubbles, center);
    }
    expect(field.copperII).toBeCloseTo(initial, 10);
    let upper = 0;
    field.species["Cu2+"].values.forEach((value, i) => {
      const y = Math.floor(i / field.mask.nx) % field.mask.ny;
      if ((y + 0.5) / field.mask.ny * field.mask.height > 0.011) upper += value;
    });
    expect(upper).toBeGreaterThan(0);
    field.dispose();
  });
});
