import { afterAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LEVEL = 0.0262;
const DT = 0.05;
const OUT = resolve("docs/night/wave7reagents");
const up = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3(0, -1, 0);
const checkpoints = new Set([5, 10, 20, 40, 80, 160]);
const metrics: Record<string, unknown> = {};
type Field = InstanceType<typeof import("../../../src/scenes/laboratory/lib/tubeSilverField").TubeSilverField>;

async function makeField() {
  (globalThis as { window?: unknown }).window = { __silverStage: 3 };
  const { TubeSilverField } = await import("../../../src/scenes/laboratory/lib/tubeSilverField");
  return new TubeSilverField("HIGH", 0.007, 0, 0.034);
}

function step(f: Field, k: number, x = 0.0049, delivery = Math.min(1, k / 60)) {
  f.advance(DT, up, LEVEL, new THREE.Vector3(x, LEVEL, 0), delivery, 0, 0.33, down);
}

function sum(a: ArrayLike<number>) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }

function stats(f: Field, values: ArrayLike<number>) {
  const m = f.mask, p = new THREE.Vector3();
  let mass = 0, sx = 0, sy = 0, sx2 = 0;
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
    m.point(x, y, z, p);
    const w = values[i]; mass += w; sx += w * p.x; sy += w * p.y; sx2 += w * p.x * p.x;
  }
  const cx = mass ? sx / mass : 0;
  return { mass, xMm: cx * 1000, depthMm: mass ? (LEVEL - sy / mass) * 1000 : 0,
    spreadMm: mass ? Math.sqrt(Math.max(0, sx2 / mass - cx * cx)) * 1000 : 0 };
}

function overlap(f: Field) {
  const ag = f.species["Ag+"].values, cl = f.species["Cl-"].values;
  return Float64Array.from(ag, (v, i) => Math.min(v, cl[i]));
}

function rounded(a: ArrayLike<number>) { return Array.from(a, v => Math.round(v * 1e5) / 1e5); }

function ascii(f: Field, name: string, data: ArrayLike<number>) {
  const m = f.mask, z = Math.floor(m.nz / 2), peak = Math.max(...Array.from(data));
  const chars = " .:-=+*#%@";
  const rows = [`${name} (z=${z}, max=${peak.toExponential(5)}; y top to bottom; x left to right)`];
  for (let y = m.ny - 1; y >= 0; y--) {
    let row = "";
    for (let x = 0; x < m.nx; x++) {
      const i = m.index(x, y, z);
      row += !m.data[i] ? " " : chars[Math.min(chars.length - 1, Math.floor((data[i] / Math.max(peak, 1e-30)) * (chars.length - 1)))];
    }
    rows.push(row);
  }
  return rows.join("\n");
}

function checkMass(f: Field) {
  const ag = f.species["Ag+"].values, cl = f.species["Cl-"].values;
  expect(Math.abs(sum(ag) + f.extent - f.silverAmount)).toBeLessThan(1e-9);
  expect(Math.abs(sum(cl) + f.extent - f.delivered)).toBeLessThan(1e-9);
  expect(Math.abs(f.totalSolidMass - f.extent)).toBeLessThan(1e-9);
  for (const a of [ag, cl, f.tracer, f.productSource, ...f.suspension, f.coarse, f.dense, f.sediment])
    for (const v of a) if (!Number.isFinite(v) || v < -1e-15) throw new Error(`invalid field value: ${v}`);
  expect(Number.isFinite(f.extent + f.delivered + f.flocSystem.totalMass)).toBe(true);
  for (const node of f.flocSystem.nodes)
    if (!Number.isFinite(node.x + node.y + node.z + node.mass) || node.mass < -1e-15)
      throw new Error("invalid floc node");
}

afterAll(() => {
  writeFileSync(resolve(OUT, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { __silverMix?: number }).__silverMix;
  delete (globalThis as { __silverEddy?: number }).__silverEddy;
});

describe("diagnostic B: local AgCl reagent fields", () => {
  it("does not create chloride, tracer, source or solid while waiting", async () => {
    const f = await makeField();
    for (let k = 1; k <= 100; k++) { step(f, k, 0.0049, 0); checkMass(f); }
    expect(sum(f.species["Cl-"].values)).toBe(0);
    expect(sum(f.tracer)).toBe(0);
    expect(sum(f.productSource)).toBe(0);
    expect(f.extent).toBe(0);
    expect(f.totalSolidMass).toBe(0);
  }, 180000);

  it("injects and reacts locally, conserves mass each step, and exports fields", async () => {
    const f = await makeField();
    const slices: Record<string, unknown> = {}, notes: string[] = [];
    const measurements: Record<string, ReturnType<typeof stats>> = {};
    let extentAt8 = 0, stopChloride = 0;
    let firstStepMaxRadiusMm = 0, firstStepLowestRow = Infinity, firstStepTopRow = -1;
    for (let k = 1; k <= 240; k++) {
      const preExtent = f.extent;
      step(f, k);
      checkMass(f);
      const ag = f.species["Ag+"].values, cl = f.species["Cl-"].values;
      for (let i = 0; i < ag.length; i++) {
        const formed = f.productSource[i];
        if (formed > Math.min(ag[i] + formed, cl[i] + formed) + 1e-15)
          throw new Error(`stoichiometric limit failed at cell ${i}, step ${k}`);
        if (formed > 0 && (!(ag[i] > 0) || !(cl[i] > 0)))
          throw new Error(`source outside ion overlap at cell ${i}, step ${k}`);
      }
      expect(Math.abs(sum(f.productSource) - (f.extent - preExtent))).toBeLessThan(1e-9);
      if (k === 1) {
        const m = f.mask, p = new THREE.Vector3();
        for (let i = 0; i < cl.length; i++) if (cl[i] > 0) {
          m.point(i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny)), p);
          firstStepMaxRadiusMm = Math.max(firstStepMaxRadiusMm, Math.hypot(p.x - 0.0049, p.z) * 1000);
          const y = Math.floor(i / m.nx) % m.ny;
          firstStepLowestRow = Math.min(firstStepLowestRow, y);
          firstStepTopRow = Math.max(firstStepTopRow, y);
        }
        expect(sum(f.productSource)).toBeGreaterThan(0);
      }
      if (k === 60) stopChloride = sum(cl);
      if (k > 60) {
        expect(f.delivered).toBeCloseTo(1, 12);
        expect(sum(cl)).toBeLessThanOrEqual(stopChloride + 1e-9);
        stopChloride = sum(cl);
      }
      if (k === 160) extentAt8 = f.extent;
      if (checkpoints.has(k)) {
        const t = k * DT, ov = overlap(f), s = stats(f, ov);
        measurements[String(t)] = s;
        notes.push(`t=${t}s overlap mass=${s.mass.toExponential(5)} depth=${s.depthMm.toFixed(4)}mm spread=${s.spreadMm.toFixed(4)}mm extent=${f.extent.toFixed(8)}`);
        for (const [name, data] of [["Ag+", ag], ["Cl-", cl], ["overlap", ov], ["productSource", f.productSource]] as const)
          notes.push(ascii(f, name, data));
        if ([10, 20, 40, 80, 160].includes(k)) slices[String(t)] = {
          "Ag+": rounded(ag), "Cl-": rounded(cl), overlap: rounded(ov),
        };
      }
    }
    expect(measurements["0.25"].depthMm).toBeLessThan(2);
    const during = ["0.25", "0.5", "1", "2"].map(t => measurements[t].depthMm);
    expect(during.at(-1)!).toBeGreaterThan(during[0]);
    expect(during[1] + during[2] + during[3]).toBeGreaterThan(3 * during[0]);
    notes.push(`formed 8-12s=${(f.extent - extentAt8).toFixed(8)}`);
    const { nx, ny, nz } = f.mask;
    writeFileSync(resolve(OUT, "fields.txt"), notes.join("\n\n") + "\n");
    writeFileSync(resolve(OUT, "fields.json"), JSON.stringify({ nx, ny, nz, units: "amount per cell", slices }, null, 0) + "\n");
    metrics.main = { measurements, formedLast4Seconds: f.extent - extentAt8, extent: f.extent,
      firstStepMaxRadiusMm, firstStepLowestRow, firstStepTopRow };
    expect.soft(firstStepMaxRadiusMm).toBeLessThanOrEqual(3);
    expect.soft(firstStepLowestRow).toBeGreaterThanOrEqual(firstStepTopRow - 1);
  }, 300000);

  it("follows the inlet side", async () => {
    const centroids: number[] = [];
    for (const x of [-0.0049, 0.0049]) {
      const f = await makeField();
      step(f, 1, x);
      centroids.push(stats(f, f.productSource).xMm);
    }
    expect(centroids[0]).toBeLessThan(0);
    expect(centroids[1]).toBeGreaterThan(0);
    metrics.sourceCentroidsMm = centroids;
  }, 180000);

  it("compares chloride plume widths across mixing and eddy settings", async () => {
    const widths: Record<string, number> = {};
    for (const mix of [4e-7, 2e-6]) for (const eddy of [0.01, 0.3]) {
      (globalThis as { __silverMix?: number }).__silverMix = mix;
      (globalThis as { __silverEddy?: number }).__silverEddy = eddy;
      const f = await makeField();
      for (let k = 1; k <= 40; k++) step(f, k);
      widths[`${mix}/${eddy}`] = stats(f, f.species["Cl-"].values).spreadMm;
    }
    const mixEffect = (Math.abs(widths["0.000002/0.01"] - widths["4e-7/0.01"])
      + Math.abs(widths["0.000002/0.3"] - widths["4e-7/0.3"])) / 2;
    const eddyEffect = (Math.abs(widths["4e-7/0.3"] - widths["4e-7/0.01"])
      + Math.abs(widths["0.000002/0.3"] - widths["0.000002/0.01"])) / 2;
    metrics.plume = { widths, mixEffect, eddyEffect, dominant: mixEffect >= eddyEffect ? "mix" : "eddy" };
    expect(Object.values(widths).every(Number.isFinite)).toBe(true);
  }, 300000);
});
