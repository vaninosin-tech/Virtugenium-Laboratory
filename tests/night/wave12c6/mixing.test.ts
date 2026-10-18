import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_RADIUS } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';

const output = 'docs/night/wave12c6';
const up = new THREE.Vector3(0, 1, 0);
type Field = TubeSilverField;
type Mask = Field['mask'];
const times = new Set([500, 1000, 2500, 4000, 6000, 9000, 14000]);
function sum(a: ArrayLike<number>, m: Mask) { let n = 0; for (let k = 0; k < m.activeCount; k++) n += a[m.active[k]]; return n; }
function percentile(a: number[], q: number) { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) * q)] ?? 0; }
function variance(a: ArrayLike<number>, m: Mask) {
  const mean = sum(a, m) / m.activeCount; let v = 0;
  for (let k = 0; k < m.activeCount; k++) v += (a[m.active[k]] - mean) ** 2;
  return v / m.activeCount;
}
function shape(a: ArrayLike<number>, m: Mask) {
  const positive = Array.from(m.active.slice(0, m.activeCount), i => a[i]).filter(v => v > 1e-15);
  const p95 = percentile(positive, .95), dx = 2 * m.radius / m.nx, dy = m.height / m.ny, dz = 2 * m.radius / m.nz;
  return [.1, .5].map(threshold => {
    const cut = threshold * p95, seen = new Uint8Array(m.data.length);
    let components = 0, cells = 0, area = 0, xmin = m.nx, ymin = m.ny, zmin = m.nz, xmax = 0, ymax = 0, zmax = 0;
    for (let k = 0; k < m.activeCount; k++) {
      const seed = m.active[k]; if (seen[seed] || a[seed] <= cut) continue;
      components++; const stack = [seed]; seen[seed] = 1;
      while (stack.length) {
        const i = stack.pop()!, x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
        cells++; xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
        for (const [X, Y, Z, faceArea] of [[x - 1, y, z, dy * dz], [x + 1, y, z, dy * dz],
          [x, y - 1, z, dx * dz], [x, y + 1, z, dx * dz], [x, y, z - 1, dx * dy], [x, y, z + 1, dx * dy]]) {
          if (X < 0 || Y < 0 || Z < 0 || X >= m.nx || Y >= m.ny || Z >= m.nz) { area += faceArea; continue; }
          const j = X + m.nx * (Y + m.ny * Z);
          if (!m.data[j] || a[j] <= cut) { area += faceArea; continue; }
          if (!seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    const lengths = [(xmax - xmin + 1) * dx, (ymax - ymin + 1) * dy, (zmax - zmin + 1) * dz];
    return { threshold, components, cells, surfaceToVolume: area / Math.max(1e-30, cells * dx * dy * dz),
      aspect: cells ? Math.max(...lengths) / Math.min(...lengths) : 0 };
  });
}
function ppm(name: string, a: ArrayLike<number>, m: Mask, scale: number) {
  const rgb = Buffer.alloc(m.nx * m.ny * 3), z = Math.floor(m.nz / 2);
  for (let Y = 0; Y < m.ny; Y++) for (let x = 0; x < m.nx; x++) {
    const i = x + m.nx * (m.ny - 1 - Y + m.ny * z), q = Math.round(255 * Math.min(1, Math.max(0, a[i] / scale)));
    rgb.fill(q, 3 * (x + m.nx * Y), 3 * (x + m.nx * Y) + 3);
  }
  writeFileSync(`${output}/${name}.ppm`, Buffer.concat([Buffer.from(`P6\n${m.nx} ${m.ny}\n255\n`), rgb]));
}
function measure(f: Field, ms: number, stepMs: number) {
  const m = f.mask, ag = f.species['Ag+'].values, cl = f.species['Cl-'].values, fine = f.suspension[0];
  const h = [2 * m.radius / m.nx, m.height / m.ny, 2 * m.radius / m.nz], stride = [1, m.nx, m.nx * m.ny];
  const maxCl = Math.max(...Array.from(m.active.slice(0, m.activeCount), i => cl[i]));
  const maxAg = Math.max(...Array.from(m.active.slice(0, m.activeCount), i => ag[i]));
  let source = 0, sx = 0, sy = 0, sz = 0, spread = 0, tv = 0, interfaceArea = 0, isoArea = 0, firstRadius = 0;
  let agAdv = 0, clAdv = 0, agBase = 0, clBase = 0, agModel = 0, clModel = 0;
  const solver = f.solver as unknown as { faces: Float32Array[]; eddy: Float32Array };
  const strain = f as unknown as { subgridStrain: Float64Array };
  const interfaceCells = new Uint8Array(m.data.length);
  const modelOn = Boolean((globalThis as { __silverSubgrid?: unknown }).__silverSubgrid);
  const delta = Math.cbrt(h[0] * h[1] * h[2]);
  const sourceRows = new Array(m.ny).fill(0);
  for (let k = 0; k < m.activeCount; k++) {
    const i = m.active[k], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / stride[2]);
    const q = f.productSource[i], p = m.point(x, y, z);
    source += q; sx += q * p.x; sy += q * p.y; sz += q * p.z; sourceRows[y] += q;
    if (q > 1e-15) firstRadius = Math.max(firstRadius, Math.hypot(p.x - .0065, p.z));
    for (let axis = 0; axis < 3; axis++) {
      if ([x, y, z][axis] + 1 >= [m.nx, m.ny, m.nz][axis]) continue;
      const j = i + stride[axis]; if (!m.data[j]) continue;
      tv += Math.abs(fine[i] - fine[j]);
      const area = h[(axis + 1) % 3] * h[(axis + 2) % 3];
      interfaceArea += Math.abs(cl[i] - cl[j]) / Math.max(maxCl, 1e-30)
        * .5 * (ag[i] + ag[j]) / Math.max(maxAg, 1e-30) * area;
      if ((cl[i] > .05 * maxCl) !== (cl[j] > .05 * maxCl)) {
        isoArea += area; interfaceCells[i] = interfaceCells[j] = 1;
        const clDirection = cl[i] > cl[j] ? 1 : -1;
        const speed = solver.faces[axis][i];
        const base = Math.min(.12 / .05, (2e-6 + .3 * .5 * (solver.eddy[i] + solver.eddy[j])) / h[axis] ** 2);
        const modelled = modelOn ? Math.min(.08 / .05, Math.min(3e-6,
          .25 * delta * delta * .5 * (strain.subgridStrain[i] + strain.subgridStrain[j])) / h[axis] ** 2) : 0;
        const species = [ag, cl];
        for (let s = 0; s < 2; s++) {
          const values = species[s], direction = s === 0 ? -clDirection : clDirection;
          const adv = direction * speed * (speed >= 0 ? values[i] : values[j]) / h[axis];
          const diff = direction * base * (values[i] - values[j]);
          const sgs = direction * modelled * (values[i] - values[j]);
          if (s === 0) { agAdv += Math.max(0, adv); agBase += Math.max(0, diff); agModel += Math.max(0, sgs); }
          else { clAdv += Math.max(0, adv); clBase += Math.max(0, diff); clModel += Math.max(0, sgs); }
        }
      }
    }
  }
  const center = [sx / (source || 1), sy / (source || 1), sz / (source || 1)];
  if (source) for (let k = 0; k < m.activeCount; k++) {
    const i = m.active[k], q = f.productSource[i], p = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / stride[2]));
    spread += q * ((p.x - center[0]) ** 2 + (p.y - center[1]) ** 2 + (p.z - center[2]) ** 2);
  }
  const agTotal = f.species['Ag+'].total, clTotal = f.species['Cl-'].total;
  let interfaceSource = 0, interfacePairAvailable = 0;
  for (let k = 0; k < m.activeCount; k++) if (interfaceCells[m.active[k]]) {
    const i = m.active[k], formed = f.productSource[i];
    interfaceSource += formed;
    interfacePairAvailable += Math.min(ag[i] + formed, cl[i] + formed);
  }
  let min = 0, nonfinite = 0;
  for (const a of [ag, cl, f.tracer, ...f.suspension]) for (let k = 0; k < m.activeCount; k++) {
    const v = a[m.active[k]]; if (!Number.isFinite(v)) nonfinite++; min = Math.min(min, v);
  }
  return { ms, delivered: f.delivered, ag: agTotal, cl: clTotal, extent: f.extent, source,
    sourceXmm: center[0] * 1000, sourceYmm: center[1] * 1000, sourceZmm: center[2] * 1000,
    sourceSpreadMm: Math.sqrt(spread / (source || 1)) * 1000, sourceRows: sourceRows.map(v => v / (source || 1)),
    firstSourceRadiusMm: firstRadius * 1000, fineVariance: variance(fine, m), fineTv: tv / (sum(fine, m) || 1),
    agVariance: variance(ag, m), clVariance: variance(cl, m), interfaceAreaM2: interfaceArea, isoAreaM2: isoArea,
    agAdvFluxPerS: agAdv, clAdvFluxPerS: clAdv, agBaseFluxPerS: agBase, clBaseFluxPerS: clBase,
    agModelFluxPerS: agModel, clModelFluxPerS: clModel, interfaceSourcePerS: interfaceSource / .05,
    contactFractionProxy: interfaceSource / .05 / Math.max(1e-30, Math.min(agAdv + agBase + agModel, clAdv + clBase + clModel)),
    localPairConsumedFraction: interfaceSource / Math.max(1e-30, interfacePairAvailable),
    sgsAgFluxPerS: f.subgridFlux[0], sgsClFluxPerS: f.subgridFlux[1],
    massError: Math.max(Math.abs(agTotal + f.extent - 1.15), Math.abs(clTotal + f.extent - f.delivered), Math.abs(f.massBalanceError)),
    min, nonfinite, stepMs };
}
function replay(name: string, subgrid: boolean | undefined, quality: 'LOW' | 'HIGH' = 'LOW', write = true, jetModel = false) {
  if (subgrid === undefined) delete (globalThis as { __silverSubgrid?: unknown }).__silverSubgrid;
  else (globalThis as { __silverSubgrid?: unknown }).__silverSubgrid = subgrid;
  (globalThis as { __silverJetModel?: unknown }).__silverJetModel = jetModel;
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const m = f.mask, inlet = new THREE.Vector3(.0065, 0, 0);
  const rows: ReturnType<typeof measure>[] = [], samples: unknown[] = [];
  for (let k = 0; k < 280; k++) {
    const delivery = Math.min(1, (k + 1) * .04), level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
    m.update(up, level); let top = -Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], p = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny)));
      if (Math.hypot(p.x - inlet.x, p.z) <= .003) top = Math.max(top, p.y);
    }
    inlet.y = top;
    const started = performance.now();
    f.advance(.05, up, level, inlet, delivery, 0, delivery > f.delivered ? .4 : 0);
    const row = measure(f, (k + 1) * 50, performance.now() - started); rows.push(row);
    expect(row.massError).toBeLessThan(1e-12);
    expect(row.min).toBeGreaterThanOrEqual(-1e-15);
    expect(row.nonfinite).toBe(0);
    if (subgrid) {
      let excess = 0, stoichiometry = 0;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], formed = f.productSource[i], availableAg = f.subgridAvailableAg[i], availableCl = f.subgridAvailableCl[i];
        excess = Math.max(excess, formed - Math.min(availableAg, availableCl));
        stoichiometry = Math.max(stoichiometry,
          Math.abs(availableAg - f.species['Ag+'].values[i] - formed),
          Math.abs(availableCl - f.species['Cl-'].values[i] - formed));
      }
      expect(excess).toBeLessThan(1e-16);
      expect(stoichiometry).toBeLessThan(1e-15);
    }
    if (times.has(row.ms)) {
      samples.push({ ...row, shape: shape(f.suspension[0], m) });
      if (write && quality === 'LOW') for (const [label, values, scale] of [
        ['ag', f.species['Ag+'].values, .002], ['cl', f.species['Cl-'].values, .002],
        ['source', f.productSource, .00005], ['fine', f.suspension[0], .002]] as const)
        ppm(`${name}_${row.ms}ms_${label}`, values, m, scale);
    }
  }
  if (write && quality === 'LOW') {
    const columns = Object.keys(rows[0]).filter(k => k !== 'sourceRows') as (keyof typeof rows[0])[];
    writeFileSync(`${output}/${name}.csv`, [columns.join(','), ...rows.map(r => columns.map(c => r[c]).join(','))].join('\n') + '\n');
    writeFileSync(`${output}/${name}_samples.json`, JSON.stringify(samples, null, 2));
  }
  const result = { name, rows, samples, cpu: { p50: percentile(rows.slice(20, 220).map(r => r.stepMs), .5),
    p95: percentile(rows.slice(20, 220).map(r => r.stepMs), .95) } };
  f.dispose(); return result;
}

describe('C6 conservative subgrid mixing', () => {
  it('keeps separated reservoirs still, transfers only across wet faces under shear, and needs both reagents', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    (globalThis as any).__silverAgg = 0;
    (globalThis as any).__silverSubgrid = true;
    const inlet = new THREE.Vector3(.0065, .025, 0);
    try {
      const noAg = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight, 0);
      for (let k = 0; k < 30; k++) noAg.advance(.05, up, .03, inlet, Math.min(1, (k + 1) / 25));
      expect(noAg.extent).toBe(0); noAg.dispose();
      const noCl = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
      for (let k = 0; k < 30; k++) noCl.advance(.05, up, .03, inlet, 0);
      expect(noCl.extent).toBe(0); noCl.dispose();
      const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight, 0);
      f.mask.update(up, .03);
      const m = f.mask, ag = f.species['Ag+'].values, cl = f.species['Cl-'].values;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], x = i % m.nx;
        if (x < m.nx / 2) ag[i] = 1 / m.activeCount;
        else cl[i] = 1 / m.activeCount;
      }
      const agBefore = sum(ag, m), clBefore = sum(cl, m);
      const exchange = (f as unknown as { exchangeSubgrid: (dt: number) => void }).exchangeSubgrid.bind(f);
      exchange(.05);
      expect(sum(ag, m)).toBe(agBefore); expect(sum(cl, m)).toBe(clBefore);
      expect(f.subgridFlux[0]).toBe(0); expect(f.subgridFlux[1]).toBe(0);
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], y = Math.floor(i / m.nx) % m.ny;
        f.solver.flow[3 * i] = y * .0005;
      }
      exchange(.05);
      expect(Math.abs(sum(ag, m) - agBefore)).toBeLessThan(1e-14);
      expect(Math.abs(sum(cl, m) - clBefore)).toBeLessThan(1e-14);
      expect(f.subgridFlux[0]).toBeGreaterThan(0);
      expect(f.subgridFlux[1]).toBeGreaterThan(0);
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a]; expect(ag[i]).toBeGreaterThanOrEqual(0); expect(cl[i]).toBeGreaterThanOrEqual(0);
      }
      f.dispose();
      const g = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight, 0);
      g.advance(.05, up, .03, inlet, 0);
      for (let a = 0; a < g.mask.activeCount; a++) {
        const i = g.mask.active[a];
        if (i % g.mask.nx < g.mask.nx / 2) g.species['Ag+'].values[i] = 1 / g.mask.activeCount;
        else g.species['Cl-'].values[i] = 1 / g.mask.activeCount;
      }
      g.advance(.05, up, .03, inlet, 0);
      expect(g.extent).toBeGreaterThan(0);
      for (let a = 0; a < g.mask.activeCount; a++) {
        const i = g.mask.active[a];
        if (g.productSource[i] > 0) expect(i % g.mask.nx).toBeGreaterThanOrEqual(g.mask.nx / 2 - 1);
        if (g.productSource[i] > 0) expect(i % g.mask.nx).toBeLessThanOrEqual(g.mask.nx / 2);
      }
      g.dispose();
    } finally { delete (globalThis as any).__silverAgg; delete (globalThis as any).__silverSubgrid; vi.unstubAllGlobals(); }
  }, 30000);

  it('is exactly dormant with the flag absent or false', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    (globalThis as any).__silverAgg = 0;
    try {
      delete (globalThis as any).__silverSubgrid;
      const a = replay('off', undefined, 'LOW', false);
      const b = replay('off', false, 'LOW', false);
      expect(a.rows).toEqual(b.rows.map((r, i) => ({ ...r, stepMs: a.rows[i].stepMs })));
      expect(a.rows[0].extent).toBeCloseTo(0.018406326453354584, 12) /* wave 14: re-pinned for the corrected 7 mm geometry */;
      expect(a.rows[179].extent).toBeCloseTo(0.7979501906316301, 12) /* wave 14: corrected geometry */;
      expect(a.rows[279].extent).toBeCloseTo(0.919120639459964, 12);
    } finally { delete (globalThis as any).__silverAgg; delete (globalThis as any).__silverSubgrid; delete (globalThis as any).__silverJetModel; vi.unstubAllGlobals(); }
  }, 120000);

  it('is deterministic with the flag on and accepts an options object', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    (globalThis as any).__silverAgg = 0;
    const inlet = new THREE.Vector3(.0065, .025, 0);
    const run = () => {
      (globalThis as any).__silverSubgrid = { coefficient: .25, maximum: 3e-6 };
      const field = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
      for (let k = 0; k < 40; k++)
        field.advance(.05, up, .03, inlet, Math.min(1, (k + 1) * .04), 0, .4);
      const state = [field.extent, ...field.species['Ag+'].values,
        ...field.species['Cl-'].values, ...field.suspension[0]];
      field.dispose();
      return state;
    };
    try { expect(run()).toEqual(run()); }
    finally { delete (globalThis as any).__silverAgg; delete (globalThis as any).__silverSubgrid; vi.unstubAllGlobals(); }
  }, 30000);

  it('replays A and C with conservative local formation and numerical evidence', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    (globalThis as any).__silverAgg = 0; mkdirSync(output, { recursive: true });
    try {
      const a = replay('A', false), c = replay('C', true);
      expect(c.rows[0].firstSourceRadiusMm).toBeLessThanOrEqual(3.01);
      expect(c.rows[179].extent).toBeGreaterThan(a.rows[179].extent);
      const highA = replay('highA', false, 'HIGH', false), highC = replay('highC', true, 'HIGH', false);
      writeFileSync(`${output}/comparison.json`, JSON.stringify({ A: { cpu: a.cpu, highCpu: highA.cpu },
        C: { cpu: c.cpu, highCpu: highC.cpu } }, null, 2));
      if (process.env.WAVE12_COMBINED === '1') {
        const b = replay('B', false, 'LOW', true, true), d = replay('D', true, 'LOW', true, true);
        writeFileSync(`${output}/combined.json`, JSON.stringify({ B: { cpu: b.cpu }, D: { cpu: d.cpu } }, null, 2));
      }
    } finally { delete (globalThis as any).__silverAgg; delete (globalThis as any).__silverSubgrid; delete (globalThis as any).__silverJetModel; vi.unstubAllGlobals(); }
  }, 120000);
});
