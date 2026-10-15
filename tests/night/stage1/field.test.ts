import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { TubeSilverField } from "../../../src/scenes/laboratory/lib/tubeSilverField";

const sample = (field: TubeSilverField, values: ArrayLike<number>, threshold = 0) => {
  const m = field.mask;
  let mass = 0, x = 0, y = 0, z = 0, occupied = 0;
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], v = values[i];
    if (v * m.activeCount > threshold) occupied++;
    mass += v;
    x += v * (i % m.nx);
    y += v * (Math.floor(i / m.nx) % m.ny);
    z += v * Math.floor(i / (m.nx * m.ny));
  }
  return { mass, x: x / Math.max(mass, 1e-30), y: y / Math.max(mass, 1e-30),
    z: z / Math.max(mass, 1e-30), occupied };
};

function components(field: TubeSilverField, threshold: number) {
  const m = field.mask, seen = new Uint8Array(m.data.length), sizes: number[] = [];
  const queue = new Int32Array(m.data.length), strides = [1, m.nx, m.nx * m.ny];
  for (let a = 0; a < m.activeCount; a++) {
    const seed = m.active[a];
    if (seen[seed] || field.dense[seed] * m.activeCount <= threshold) continue;
    let head = 0, tail = 0;
    queue[tail++] = seed; seen[seed] = 1;
    while (head < tail) {
      const i = queue[head++];
      const coords = [i % m.nx, Math.floor(i / m.nx) % m.ny,
        Math.floor(i / (m.nx * m.ny))];
      for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
        if (coords[axis] + sign < 0 || coords[axis] + sign >= [m.nx, m.ny, m.nz][axis]) continue;
        const j = i + sign * strides[axis];
        if (seen[j] || !m.data[j] || field.dense[j] * m.activeCount <= threshold) continue;
        seen[j] = 1; queue[tail++] = j;
      }
    }
    sizes.push(tail);
  }
  return sizes.sort((a, b) => b - a);
}

function slices(field: TubeSilverField, label: string) {
  const m = field.mask, glyphs = ".:-=+*#%@";
  const fields: [string, ArrayLike<number>][] = [
    ["dense", field.dense], ["Ag+", field.species["Ag+"].values],
    ["Cl-", field.species["Cl-"].values], ["overlap", field.productSource],
  ];
  let output = `${label} extent=${field.extent.toFixed(6)} delivered=${field.delivered.toFixed(6)}\n`;
  for (const [name, values] of fields) {
    const paint = (i: number) => {
      const v = values[i] * m.activeCount;
      return glyphs[Math.min(glyphs.length - 1, Math.floor(Math.sqrt(Math.max(0, v)) * 5))];
    };
    output += `${name} x-y at z=${Math.floor(m.nz / 2)}\n`;
    for (let y = m.ny - 1; y >= 0; y--) {
      for (let x = 0; x < m.nx; x++) output += paint(m.index(x, y, Math.floor(m.nz / 2)));
      output += "\n";
    }
    output += `${name} x-z at y=${Math.floor(m.ny / 2)}\n`;
    for (let z = m.nz - 1; z >= 0; z--) {
      for (let x = 0; x < m.nx; x++) output += paint(m.index(x, Math.floor(m.ny / 2), z));
      output += "\n";
    }
  }
  return output;
}

function verticalProfile(field: TubeSilverField) {
  const m = field.mask;
  let total = 0, floor = 0, weightedY = 0, low = m.ny, high = -1;
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], y = Math.floor(i / m.nx) % m.ny;
    const value = field.dense[i];
    total += value; weightedY += value * y;
    if (y <= 2) floor += value;
    if (value * m.activeCount > 0.04) { low = Math.min(low, y); high = Math.max(high, y); }
  }
  return { centre: weightedY / Math.max(total, 1e-30),
    span: Math.max(0, high - low + 1), floorFraction: floor / Math.max(total, 1e-30) };
}

function run(inletX: number, varied = false, collectSlices = false, steps = 100) {
  const field = new TubeSilverField("LOW", 0.007, 0, 0.055);
  const inlet = new THREE.Vector3(inletX, 0.037, 0);
  const up = new THREE.Vector3(0, 1, 0);
  let text = "Stage 1 AgCl numerical slices; glyph intensity increases from . to @.\n";
  field.advance(0.05, up, 0.038, inlet, 0);
  expect(field.denseMass).toBe(0);
  expect(field.extent).toBe(0);
  if (collectSlices) text += slices(field, "before pour");
  let positiveSourceCells = 0;
  let maxMassError = 0;
  const profiles: ReturnType<typeof verticalProfile>[] = [];
  for (let step = 0; step < steps; step++) {
    const level = varied && step >= 50 ? 0.041 : 0.038;
    up.set(varied && step >= 65 ? 0.45 : 0, varied && step >= 65 ? 0.893 : 1, 0).normalize();
    field.advance(0.05, up, level, inlet, Math.min(1, (step + 1) / 24),
      varied && step >= 70 && step < 85 ? 0.8 : 0);
    maxMassError = Math.max(maxMassError, Math.abs(field.massBalanceError));
    if (Math.abs(field.massBalanceError) >= 1e-8 ||
      field.suspensionMass + field.coarseMass + field.sedimentMass !== 0)
      throw new Error(`solid mass balance failed at step ${step + 1}`);
    for (let a = 0; a < field.mask.activeCount; a++) {
      const i = field.mask.active[a];
      if (!Number.isFinite(field.dense[i]) || field.dense[i] < 0)
        throw new Error(`invalid dense cell ${i} at step ${step + 1}`);
      for (const coordinate of field.denseCoordinates) {
        if (!Number.isFinite(coordinate[i]) || coordinate[i] < 0)
          throw new Error(`invalid material coordinate ${i} at step ${step + 1}`);
      }
      if (!Number.isFinite(field.species["Ag+"].values[i]) ||
        !Number.isFinite(field.species["Cl-"].values[i]))
        throw new Error(`invalid ion cell ${i} at step ${step + 1}`);
      if (field.productSource[i] > 0) {
        positiveSourceCells++;
        if (field.dense[i] <= 0) throw new Error(`source absent from dense cell ${i}`);
      }
      if (step === 0 && field.dense[i] > 0 && field.productSource[i] <= 0)
        throw new Error(`dense mass appeared without source at cell ${i}`);
    }
    if (collectSlices && [4, 19, 49, 99, 159].includes(step)) text += slices(field, `step ${step + 1}`);
    if ([0, 4, 19, 49, 99, 159].includes(step)) profiles.push(verticalProfile(field));
  }
  const center = sample(field, field.dense);
  const groups = components(field, 0.01);
  if (collectSlices) {
    text += `dense centre=${center.x.toFixed(3)},${center.y.toFixed(3)},${center.z.toFixed(3)} `
      + `components above 0.01=${groups.length}; largest=${groups[0] ?? 0}; total=${groups.reduce((a, b) => a + b, 0)}\n`;
    text += `vertical profiles (steps 1,5,20,50,100${steps >= 160 ? ",160" : ""}): ${profiles.map(p =>
      `centre=${p.centre.toFixed(2)} span=${p.span} floor=${p.floorFraction.toFixed(3)}`).join("; ")}\n`;
    mkdirSync("docs/night/stage1", { recursive: true });
    writeFileSync("docs/night/stage1/slices.txt", text);
    process.stdout.write(text);
  }
  const result = { dense: Array.from(field.dense), extent: field.extent,
    center, groups, positiveSourceCells, maxMassError, profiles };
  field.dispose();
  return result;
}

describe("stage-one AgCl field scenarios", () => {
  it("forms only at reaction source, conserves through level, tilt and shake, and emits slices", () => {
    const outcome = run(0, true, true, 160);
    expect(outcome.extent).toBeGreaterThan(0.4);
    expect(outcome.positiveSourceCells).toBeGreaterThan(0);
    expect(outcome.groups.length).toBeGreaterThan(0);
    expect((outcome.groups[0] ?? 0) / outcome.groups.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.7);
    // With a 38 mm fill, the highest wet LOW-grid cell is y=11.
    expect(outcome.profiles[0].centre).toBeGreaterThan(8);
    expect(outcome.profiles[2].floorFraction).toBeLessThan(0.005);
    expect(outcome.profiles[2].span).toBeGreaterThan(outcome.profiles[1].span);
    expect(outcome.profiles[5].floorFraction).toBeGreaterThan(outcome.profiles[4].floorFraction);
  }, 60000);
  it("follows the pour location and is deterministic", () => {
    const center = run(0);
    const wall = run(0.004);
    const repeat = run(0);
    expect(wall.center.x).toBeGreaterThan(center.center.x);
    expect(repeat).toEqual(center);
    const diagnostic = `centre pour x=${center.center.x.toFixed(3)}; wall pour x=${wall.center.x.toFixed(3)}; `
      + `max mass error=${Math.max(center.maxMassError, wall.maxMassError).toExponential(3)}\n`;
    appendFileSync("docs/night/stage1/slices.txt", diagnostic);
    process.stdout.write(diagnostic);
  }, 60000);
});
