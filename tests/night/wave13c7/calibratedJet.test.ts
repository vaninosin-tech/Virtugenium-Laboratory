import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { TubeSilverField } from "../../../src/scenes/laboratory/lib/tubeSilverField";
import { TubeJetModel } from "../../../src/scenes/laboratory/lib/tubeJetModel";
import { TubeFlowSolver } from "../../../src/scenes/laboratory/lib/tubeFlowSolver";
import { LiquidMask } from "../../../src/scenes/laboratory/lib/tubeVolumeField";
import { pouredMl } from "../../../src/scenes/laboratory/lib/tubePourImpact";
import { tubeLiquidHeight } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_RADIUS } from "../../../src/scenes/laboratory/lib/tubeSilverGeometry";

const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
const output = "docs/night/wave13c7";
const sum = (v: ArrayLike<number>) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s; };
const point = (m: LiquidMask, i: number) => m.point(i % m.nx,
  Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny)));

// The 30 ms pour clock emits differences of the same cumulative function used
// by stepTubePour. Bin accepted events into 50 ms solver steps; their integral
// is the ledger total even though the rate is step-quantised.
function ledgerSteps() {
  const accepted = new Float64Array(280);
  let previous = 0;
  for (let atMs = 30; atMs <= 1710; atMs += 30) {
    const cumulative = pouredMl(Math.min(1700, atMs) / 1700);
    accepted[Math.floor(atMs / 50)] += cumulative - previous;
    previous = cumulative;
  }
  return accepted;
}
function ppm(name: string, values: ArrayLike<number>, m: LiquidMask, scale: number,
  vectors?: Float32Array) {
  const rgb = Buffer.alloc(m.nx * m.ny * 3), z = Math.floor(m.nz / 2);
  for (let row = 0; row < m.ny; row++) for (let x = 0; x < m.nx; x++) {
    const i = m.index(x, m.ny - row - 1, z), o = 3 * (x + m.nx * row);
    const q = Math.round(255 * Math.min(1, Math.max(0, values[i] / scale)));
    rgb[o] = q;
    rgb[o + 1] = vectors ? Math.round(127 + 127 * Math.max(-1, Math.min(1, vectors[3 * i] / 0.1))) : q;
    rgb[o + 2] = vectors ? Math.round(127 + 127 * Math.max(-1, Math.min(1, vectors[3 * i + 1] / 0.1))) : q;
  }
  writeFileSync(`${output}/${name}.ppm`, Buffer.concat([Buffer.from(`P6\n${m.nx} ${m.ny}\n255\n`), rgb]));
}
function region(values: Float64Array, m: LiquidMask, fraction: number) {
  const positive: number[] = [];
  for (let a = 0; a < m.activeCount; a++) if (values[m.active[a]] > 1e-15) positive.push(values[m.active[a]]);
  positive.sort((a, b) => a - b);
  const threshold = fraction * (positive[Math.floor(.95 * (positive.length - 1))] ?? Infinity);
  const selected = new Uint8Array(m.data.length), seen = new Uint8Array(m.data.length);
  for (let a = 0; a < m.activeCount; a++) if (values[m.active[a]] >= threshold) selected[m.active[a]] = 1;
  const h = [2 * m.radius / m.nx, m.height / m.ny, 2 * m.radius / m.nz];
  const area = [h[1] * h[2], h[0] * h[2], h[0] * h[1]];
  let components = 0, cells = 0, surface = 0;
  for (let a = 0; a < m.activeCount; a++) {
    const seed = m.active[a]; if (!selected[seed] || seen[seed]) continue;
    components++; seen[seed] = 1;
    const stack = [seed];
    while (stack.length) {
      const i = stack.pop()!, x = i % m.nx, y = Math.floor(i / m.nx) % m.ny,
        z = Math.floor(i / (m.nx * m.ny));
      cells++;
      for (const [axis, stride, position, limit] of [[0, 1, x, m.nx],
        [1, m.nx, y, m.ny], [2, m.nx * m.ny, z, m.nz]])
        for (const sign of [-1, 1]) {
          const j = i + sign * stride;
          if (position + sign < 0 || position + sign >= limit || !selected[j]) surface += area[axis];
          else if (!seen[j]) { seen[j] = 1; stack.push(j); }
        }
    }
  }
  return { components, sv: surface / Math.max(1e-30, cells * h[0] * h[1] * h[2]) };
}
function metric(f: TubeSilverField, t: number, q: number) {
  const m = f.mask, speed = f.solver.flow, fine = f.suspension[0], tracer = f.tracer;
  let peak = 0, mean = 0, columnPeak = 0, columnMean = 0, columnCount = 0;
  let h2 = 0, v2 = 0, mx = 0, my = 0, mz = 0, tv = 0, fine2 = 0;
  let sourceTotal = 0, sourceNear = 0, floor = Infinity;
  const axisDown = [0, 0, 0, 0], axisCount = [0, 0, 0, 0];
  const bottomRadial = [0, 0, 0], radialCount = [0, 0, 0];
  const verticalFine = [0, 0, 0, 0], radialFine = [0, 0, 0];
  const mass = sum(tracer), fineMass = sum(fine);
  for (let a = 0; a < m.activeCount; a++) {
    const p = point(m, m.active[a]);
    if (Math.hypot(p.x - .0065, p.z) < .002) floor = Math.min(floor, p.y);
  }
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], p = point(m, i), v = Math.hypot(...speed.subarray(3 * i, 3 * i + 3));
    peak = Math.max(peak, v); mean += v; fine2 += fine[i] ** 2;
    if (Math.hypot(p.x - .0065, p.z) < .002) {
      columnPeak = Math.max(columnPeak, v); columnMean += v; columnCount++;
      const depth = f["liquidLevel"] - p.y;
      const bin = depth < .003 ? 0 : depth < .006 ? 1 : depth < .012 ? 2 : 3;
      axisDown[bin] += -speed[3 * i + 1]; axisCount[bin]++;
    }
    const r = Math.hypot(p.x - .0065, p.z), rb = r < .002 ? 0 : r < .004 ? 1 : 2;
    if (p.y <= floor + .003) {
      const radial = r > 1e-9 ? (speed[3 * i] * (p.x - .0065) + speed[3 * i + 2] * p.z) / r : 0;
      bottomRadial[rb] += radial; radialCount[rb]++;
    }
    verticalFine[Math.min(3, Math.floor(4 * (p.y - m.bottom) / Math.max(.001, f["liquidLevel"] - m.bottom)))] += fine[i];
    radialFine[rb] += fine[i];
    sourceTotal += f.productSource[i];
    if (r <= .003) sourceNear += f.productSource[i];
    mx += tracer[i] * p.x; my += tracer[i] * p.y; mz += tracer[i] * p.z;
    const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny,
      z = Math.floor(i / (m.nx * m.ny));
    for (const [j, valid] of [[i + 1, x + 1 < m.nx], [i + m.nx, y + 1 < m.ny],
      [i + m.nx * m.ny, z + 1 < m.nz]] as const) if (valid && m.data[j]) tv += Math.abs(fine[i] - fine[j]);
  }
  mx /= mass || 1; my /= mass || 1; mz /= mass || 1;
  const positive: number[] = [];
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], p = point(m, i);
    h2 += tracer[i] * ((p.x - mx) ** 2 + (p.z - mz) ** 2);
    v2 += tracer[i] * (p.y - my) ** 2;
    if (tracer[i] > 1e-15) positive.push(tracer[i]);
  }
  positive.sort((a, b) => a - b);
  const p95 = positive[Math.floor(.95 * (positive.length - 1))] ?? 0;
  let lowest = Infinity, occupied = 0;
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a];
    if (tracer[i] > .1 * p95 && p95 > 0) lowest = Math.min(lowest, point(m, i).y);
    if (fine[i] > .1 * fineMass / m.activeCount) occupied++;
  }
  const d = f.diagnostics();
  const s10 = region(fine, m, .1), s50 = region(fine, m, .5);
  const area = Math.PI * .00075 ** 2;
  const speedAtImpact = q / area;
  return { t, q, area, speedAtImpact, ledgerForceAtDownstreamRadius: 1000 * q * speedAtImpact,
    jetDepth: f.solver.lastJetPenetration,
    delivered: f.delivered, force: f.solver.lastJetMomentumSource[1],
    blockedForce: f.solver.lastJetBlockedMomentum[1], clippedForce: f.solver.lastJetClippedMomentum,
    impulse: f.solver.lastJetMomentumSource[1] * .05,
    speedPeak: peak, speedMean: mean / m.activeCount, columnPeak,
    columnMean: columnMean / Math.max(1, columnCount),
    h2: h2 / (mass || 1), v2: v2 / (mass || 1),
    penetration: Number.isFinite(lowest) ? f["liquidLevel"] - lowest : 0,
    tracerMass: mass, ag: d.silverRemaining, cl: d.chlorideRemaining, extent: f.extent,
    fineVariance: fine2 / m.activeCount - (fineMass / m.activeCount) ** 2,
    fineTV: tv / (fineMass || 1), occupied: occupied / m.activeCount,
    sourceNearFraction: sourceNear / (sourceTotal || 1),
    components10: s10.components, sv10: s10.sv, components50: s50.components, sv50: s50.sv,
    axisDown: axisDown.map((v, i) => v / Math.max(1, axisCount[i])).join(";"),
    bottomRadial: bottomRadial.map((v, i) => v / Math.max(1, radialCount[i])).join(";"),
    verticalFine: verticalFine.map(v => v / (fineMass || 1)).join(";"),
    radialFine: radialFine.map(v => v / (fineMass || 1)).join(";"),
    divergence: d.flow.meanAbsDivergence, stepMs: f.solver.lastStepMs };
}

describe("calibrated silver jet", () => {
  it("keeps absent and false flags identical, and repeats the flagged result", () => {
    vi.stubGlobal("window", { __silverStage: 3, location: { search: "" } });
    (globalThis as any).__silverAgg = 0;
    const run = (flag: boolean | undefined) => {
      (globalThis as any).__silverJetModel = flag;
      const f = new TubeSilverField("LOW", SILVER_TUBE_RADIUS, 0, silverFieldHeight);
      const level = tubeLiquidHeight(1.2, silverEffectiveRadius);
      const inlet = new THREE.Vector3(.0065, level - .001, 0);
      for (let k = 0; k < 4; k++) f.advance(.05, up, level, inlet, .05 * (k + 1), 0, 1);
      const result = { flow: Array.from(f.solver.flow), ag: Array.from(f.species["Ag+"].values),
        cl: Array.from(f.species["Cl-"].values), extent: f.extent };
      f.dispose(); return result;
    };
    try {
      expect(run(undefined)).toEqual(run(false));
      expect(run(true)).toEqual(run(true));
    } finally {
      delete (globalThis as any).__silverJetModel;
      delete (globalThis as any).__silverAgg;
      vi.unstubAllGlobals();
    }
  });
  it("uses consistent SI flow, area, speed, force and wet-face momentum", () => {
    const m = new LiquidMask(22, 44, 22, .007, 0, silverFieldHeight);
    const levels = [];
    for (const ml of [1, 1.4, 1.8, 2]) {
      const level = tubeLiquidHeight(ml, silverEffectiveRadius);
      m.update(up, level);
      const jet = new TubeJetModel(m), inlet = new THREE.Vector3(.0065, level - .001, 0);
      jet.prepare(.05, inlet, down, { x: inlet.x, z: 0, level, flow: .8e-6,
        alpha: .2, delta: .0015, r0: .001, relaxation: 12 });
      expect(jet.area).toBeCloseTo(Math.PI * .00075 ** 2, 12);
      expect(jet.speed).toBeCloseTo(jet.flow / jet.area, 12);
      expect(jet.momentum[1]).toBeCloseTo(-1000 * jet.flow * jet.speed, 10);
      expect(jet.appliedMomentum[1] + jet.blockedMomentum[1]).toBeCloseTo(jet.momentum[1], 8);
      expect(jet.penetration).toBeLessThanOrEqual(level + 1e-12);
      levels.push({ ml, level, penetration: jet.penetration, force: jet.momentum[1],
        appliedForce: jet.appliedMomentum[1], blockedForce: jet.blockedMomentum[1],
        activeCells: m.activeCount });
      for (let i = 0; i < m.data.length; i++) if (!m.data[i])
        expect(jet.source[3 * i + 1]).toBe(0);
    }
    mkdirSync(output, { recursive: true });
    writeFileSync(`${output}/levels.json`, JSON.stringify(levels, null, 2));
  });

  it("integrates the actual peaked delivery to one mL", () => {
    const events = ledgerSteps();
    expect(sum(events)).toBeCloseTo(1, 12);
    const integralM3 = sum(events) * 1e-6;
    const rateIntegral = sum(Array.from(events, ml => ml * 20 * 1e-6 * .05));
    expect(Math.abs(integralM3 - rateIntegral)).toBeLessThan(1e-15);
  });

  it("measures LOW and real HIGH solver cost during a repeating delivery profile", () => {
    const events = ledgerSteps();
    const activeRates = Array.from(events, ml => ml * 20 * 1e-6).filter(q => q > 0);
    const results = [];
    for (const [grid, n] of [["LOW", [12, 24, 12]], ["HIGH", [22, 44, 22]]] as const) {
      const m = new LiquidMask(n[0], n[1], n[2], .007, 0, silverFieldHeight);
      const level = tubeLiquidHeight(1.5, silverEffectiveRadius);
      m.update(up, level);
      for (const flagged of [false, true]) {
        (globalThis as any).__silverJetModel = flagged;
        const s = new TubeFlowSolver(m), inlet = new THREE.Vector3(.0065, level - .001, 0);
        const times: number[] = []; let maxDivergence = 0;
        for (let k = 0; k < 220; k++) {
          const q = activeRates[k % activeRates.length];
          s.step(.05, inlet, down, q > 0 ? .008 : 0, 0, undefined, 0, undefined,
            { x: inlet.x, z: inlet.z, level, flow: q, alpha: .2, delta: .0015,
              r0: .001, relaxation: 12 });
          if (k >= 20) {
            times.push(s.lastStepMs);
            maxDivergence = Math.max(maxDivergence, s.diagnostics().meanAbsDivergence);
          }
        }
        times.sort((a, b) => a - b);
        results.push({ grid, flagged, cells: n.join("x"), p50: times[99], p95: times[189],
          peak: times[199], maxDivergence });
      }
    }
    delete (globalThis as any).__silverJetModel;
    mkdirSync(output, { recursive: true });
    writeFileSync(`${output}/cpu.json`, JSON.stringify(results, null, 2));
    expect(results).toHaveLength(4);
  }, 180000);

  it("replays baseline, corrected rate, corrected distribution and both", () => {
    vi.stubGlobal("window", { __silverStage: 3, location: { search: "" } });
    (globalThis as any).__silverAgg = 0;
    (globalThis as any).__silverDiag = "tracer";
    mkdirSync(output, { recursive: true });
    const events = ledgerSteps(), rows: Array<Record<string, number | string>> = [];
    const configs = [
      { name: "baseline", flag: false as const },
      { name: "rate_only", flag: { distribution: "legacy" as const } },
      { name: "distribution_only", flag: { flow: 1e-6 } },
      { name: "both", flag: true as const },
    ];
    try {
      for (const config of configs) {
        (globalThis as any).__silverJetModel = config.flag;
        const f = new TubeSilverField("LOW", SILVER_TUBE_RADIUS, 0, silverFieldHeight);
        let delivered = 0;
        for (let k = 0; k < events.length; k++) {
          const ml = events[k]; delivered += ml;
          const level = tubeLiquidHeight(1 + delivered, silverEffectiveRadius);
          f.mask.update(up, level);
          f.solver.refreshMask();
          const inlet = new THREE.Vector3(.0065, level, 0);
          let top = -Infinity;
          for (let a = 0; a < f.mask.activeCount; a++) {
            const p = point(f.mask, f.mask.active[a]);
            if (Math.hypot(p.x - inlet.x, p.z) <= .003) top = Math.max(top, p.y);
          }
          inlet.y = top;
          f.advance(.05, up, level, inlet, delivered, 0, ml * 20);
          const row = metric(f, (k + 1) * .05, ml * 20 * 1e-6);
          rows.push({ config: config.name, ...row });
          expect(Math.abs(row.delivered - delivered)).toBeLessThan(1e-12);
          expect(Math.abs(row.tracerMass - delivered)).toBeLessThan(1e-12);
          expect(row.divergence, `${config.name} step ${k}`).toBeLessThan(.3);
          expect(f.species["Ag+"].values.every(v => Number.isFinite(v) && v >= 0)).toBe(true);
          expect(f.species["Cl-"].values.every(v => Number.isFinite(v) && v >= 0)).toBe(true);
          if ((config.name === "baseline" || config.name === "both") && [9, 19, 39, 79, 179, 279].includes(k)) {
            const prefix = `${config.name}_${k + 1}`;
            const speeds = new Float64Array(f.mask.data.length);
            for (let a = 0; a < f.mask.activeCount; a++) {
              const i = f.mask.active[a];
              speeds[i] = Math.hypot(...f.solver.flow.subarray(3 * i, 3 * i + 3));
            }
            ppm(`${prefix}_velocity`, speeds, f.mask, .1, f.solver.flow);
            ppm(`${prefix}_tracer`, f.tracer, f.mask, .003);
          }
        }
        f.dispose();
      }
      const columns = Object.keys(rows[0]);
      writeFileSync(`${output}/history.csv`, [columns.join(","), ...rows.map(row => columns.map(k => row[k]).join(","))].join("\n") + "\n");
      writeFileSync(`${output}/samples.json`, JSON.stringify(rows.filter(row => [0.5, 1, 2, 4, 9, 14]
        .some(t => Math.abs(Number(row.t) - t) < 1e-8)), null, 2));
      delete (globalThis as any).__silverDiag;
      const chemistry: Array<Record<string, number | string>> = [];
      for (const config of configs) {
        (globalThis as any).__silverJetModel = config.flag;
        const f = new TubeSilverField("LOW", SILVER_TUBE_RADIUS, 0, silverFieldHeight);
        let delivered = 0;
        for (let k = 0; k < events.length; k++) {
          const ml = events[k]; delivered += ml;
          const level = tubeLiquidHeight(1 + delivered, silverEffectiveRadius);
          f.mask.update(up, level); f.solver.refreshMask();
          const inlet = new THREE.Vector3(.0065, level, 0);
          let top = -Infinity;
          for (let a = 0; a < f.mask.activeCount; a++) {
            const p = point(f.mask, f.mask.active[a]);
            if (Math.hypot(p.x - inlet.x, p.z) <= .003) top = Math.max(top, p.y);
          }
          inlet.y = top;
          f.advance(.05, up, level, inlet, delivered, 0, ml * 20);
          const row = metric(f, (k + 1) * .05, ml * 20 * 1e-6);
          chemistry.push({ config: config.name, ...row });
          expect(Math.abs(row.ag + row.extent - 1.15)).toBeLessThan(1e-12);
          expect(Math.abs(row.cl + row.extent - delivered)).toBeLessThan(1e-12);
          expect(Math.abs(f.massBalanceError)).toBeLessThan(1e-12);
          if ((config.name === "baseline" || config.name === "both") && [9, 19, 39, 79, 179, 279].includes(k)) {
            const prefix = `${config.name}_${k + 1}`;
            for (const [name, values, scale] of [["ag", f.species["Ag+"].values, .003],
              ["cl", f.species["Cl-"].values, .003], ["source", f.productSource, .00005],
              ["fine", f.suspension[0], .003]] as const)
              ppm(`${prefix}_${name}`, values, f.mask, scale);
          }
        }
        f.dispose();
      }
      const chemistryColumns = Object.keys(chemistry[0]);
      writeFileSync(`${output}/chemistry.csv`, [chemistryColumns.join(","),
        ...chemistry.map(row => chemistryColumns.map(k => row[k]).join(","))].join("\n") + "\n");
      writeFileSync(`${output}/chemistry_samples.json`, JSON.stringify(chemistry.filter(row => [0.5, 1, 2, 4, 9, 14]
        .some(t => Math.abs(Number(row.t) - t) < 1e-8)), null, 2));
    } finally {
      delete (globalThis as any).__silverJetModel;
      delete (globalThis as any).__silverAgg;
      delete (globalThis as any).__silverDiag;
      vi.unstubAllGlobals();
    }
  }, 180000);
});
