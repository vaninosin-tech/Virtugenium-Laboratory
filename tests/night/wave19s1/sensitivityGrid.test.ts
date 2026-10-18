import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { silverAggregateDumpFromState, renderSilverLayers, SILVER_AGGREGATE_OPTICS, SILVER_FINE_OPTICS } from '../../../src/scenes/laboratory/lib/night/render/silverOpticsReference';

const output = 'docs/night/wave19s1', shared = 'docs/night/wave16shared';
const times = new Set([1, 2, 3, 4.5, 6, 9, 12, 14, 17, 20, 22]);
const reportTimes = new Set([3, 6, 9, 14, 22]);
const thresholdsUm = [3, 10, 30, 100, 1000];
type Row = Record<string, number | string>;
function percentile(v: number[], p: number) { return v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))] ?? 0; }

function spatial(f: TubeSilverField) {
  const m = f.mask, n = m.data.length, density = new Float64Array(n), values: number[] = [];
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a];
    let mass = 0;
    for (const bin of f.sections.masses) mass += bin[i];
    density[i] = mass * m.activeCount;
    values.push(density[i]);
  }
  values.sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const cv = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) / (mean || 1);
  const p95 = percentile(values, .95);
  const regions = (fraction: number) => {
    const cutoff = p95 * fraction, seen = new Uint8Array(n), sizes: number[] = [], surfaces: number[] = [], aspects: number[] = [], gyrations: number[] = [], boxes: number[][] = [];
    if (cutoff <= 0) return { count: 0, maxVolumeMm3: 0, maxSurfaceVolumePerMm: 0, maxAspect: 0, maxRgMm: 0, maxBoxMm: [0, 0, 0] };
    const stride = m.nx * m.ny, steps = [-1, 1, -m.nx, m.nx, -stride, stride];
    const dx = 2 * m.radius / m.nx * 1000, dy = m.height / m.ny * 1000, dz = 2 * m.radius / m.nz * 1000;
    for (let a = 0; a < m.activeCount; a++) {
      const root = m.active[a]; if (seen[root] || density[root] < cutoff) continue;
      seen[root] = 1; const queue = [root]; let surface = 0, sx = 0, sy = 0, sz = 0, sx2 = 0, sy2 = 0, sz2 = 0;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / stride);
        const p = [x * dx, y * dy, z * dz];
        sx += p[0]; sy += p[1]; sz += p[2]; sx2 += p[0] ** 2; sy2 += p[1] ** 2; sz2 += p[2] ** 2;
        for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p[d]); hi[d] = Math.max(hi[d], p[d]); }
        for (let side = 0; side < 6; side++) {
          if ((side === 0 && x === 0) || (side === 1 && x === m.nx - 1) ||
            (side === 2 && y === 0) || (side === 3 && y === m.ny - 1) ||
            (side === 4 && z === 0) || (side === 5 && z === m.nz - 1)) { surface += side < 2 ? dy * dz : side < 4 ? dx * dz : dx * dy; continue; }
          const j = i + steps[side];
          if (!m.data[j] || density[j] < cutoff) { surface += side < 2 ? dy * dz : side < 4 ? dx * dz : dx * dy; continue; }
          if (!seen[j]) { seen[j] = 1; queue.push(j); }
        }
      }
      const count = queue.length, box = lo.map((v, d) => hi[d] - v + [dx, dy, dz][d]);
      sizes.push(count * dx * dy * dz); surfaces.push(surface / (count * dx * dy * dz));
      aspects.push(Math.max(...box) / Math.min(...box)); boxes.push(box);
      gyrations.push(Math.sqrt(Math.max(0, (sx2 + sy2 + sz2) / count - (sx ** 2 + sy ** 2 + sz ** 2) / count ** 2)));
    }
    const largest = sizes.indexOf(Math.max(...sizes));
    return { count: sizes.length, maxVolumeMm3: sizes[largest] ?? 0,
      maxSurfaceVolumePerMm: surfaces[largest] ?? 0, maxAspect: aspects[largest] ?? 0,
      maxRgMm: gyrations[largest] ?? 0, maxBoxMm: boxes[largest] ?? [0, 0, 0] };
  };
  let gradSum = 0, gradMax = 0, gradCount = 0;
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], x = i % m.nx;
    if (x + 1 >= m.nx || !m.data[i + 1]) continue;
    const g = Math.abs(density[i + 1] - density[i]) / (2 * m.radius / m.nx * 1000);
    gradSum += g; gradMax = Math.max(gradMax, g); gradCount++;
  }
  const depth = [0, 0, 0];
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], fine = f.suspension[0][i] * m.activeCount;
    const tau = 2 * (SILVER_FINE_OPTICS.kappa * fine + SILVER_AGGREGATE_OPTICS.kappa * density[i]);
    for (let j = 0; j < 3; j++) if (tau > [.05, .2, 1][j]) depth[j]++;
  }
  return { p05: percentile(values, .05), p50: percentile(values, .5), p95, p99: percentile(values, .99), cv,
    depth05: depth[0] / m.activeCount, depth02: depth[1] / m.activeCount, depth1: depth[2] / m.activeCount,
    gradMeanPerMm: gradSum / (gradCount || 1), gradMaxPerMm: gradMax,
    regions10: regions(.1), regions50: regions(.5) };
}

function run(radiusUm: number, scale: number, quality: 'LOW' | 'HIGH', baseline = false) {
  (globalThis as { __silverAgg?: number; __silverPrimaryRadiusUm?: number; __silverStickingScale?: number }).__silverAgg = baseline ? 0 : 1;
  (globalThis as { __silverPrimaryRadiusUm?: number }).__silverPrimaryRadiusUm = radiusUm;
  (globalThis as { __silverStickingScale?: number }).__silverStickingScale = scale;
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0), rows: Row[] = [];
  const first: Record<string, string> = {};
  let maxError = 0;
  const label = baseline ? `${quality.toLowerCase()}_baseline` : `${quality.toLowerCase()}_r${String(radiusUm).replace('.', '_')}_a${String(scale).replace('.', '_')}`;
  try {
    for (let step = 0; step < 440; step++) {
      const t = (step + 1) * .05, delivery = Math.min(1, (step + 1) * .04);
      const level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
      f.mask.update(up, level);
      let top = -Infinity;
      for (let a = 0; a < f.mask.activeCount; a++) {
        const i = f.mask.active[a], p = f.mask.point(i % f.mask.nx,
          Math.floor(i / f.mask.nx) % f.mask.ny, Math.floor(i / (f.mask.nx * f.mask.ny)));
        if (Math.hypot(p.x - inlet.x, p.z) <= .003) top = Math.max(top, p.y);
      }
      inlet.y = top;
      f.advance(.05, up, level, inlet, delivery, 0, delivery > f.delivered ? .4 : 0);
      maxError = Math.max(maxError, Math.abs(f.massBalanceError));
      if (!times.has(t)) continue;
      const masses = f.sections?.massByClass() ?? Array(13).fill(0);
      const numbers = masses.map((mass, b) => mass / (f.sections?.particleMass[b] ?? Infinity));
      const total = masses.reduce((s, v) => s + v, 0);
      const weightedUm = total ? masses.reduce((s, v, b) => s + v * f.sections.radii[b] * 1e6, 0) / total : 0;
      const largestAt = (minimum: number) => {
        let b = 12; while (b >= 0 && masses[b] < minimum) b--;
        return b < 0 ? 0 : f.sections.radii[b] * 1e6;
      };
      const maxUm = largestAt(0), at001 = largestAt(.001), at01 = largestAt(.01);
      for (const size of thresholdsUm) for (const [name, value] of [['mean', weightedUm], ['mass001', at001], ['mass01', at01]]) {
        const key = `${name}_${size}um`; if (value >= size && first[key] === undefined) first[key] = `${t}`;
      }
      const d = baseline ? null : spatial(f);
      const row: Row = { t, extent: f.extent, fine: f.suspensionMass + f.coarseMass, sections: total,
        nodesMass: f.flocSystem?.nodes.reduce((s, n) => s + n.mass, 0) ?? 0,
        pending: f.aggregateSeeds.reduce((s, v) => s + v, 0), sediment: f.sedimentMass,
        error: f.massBalanceError, fineToSectionRate: f.transferStep.fineToAggregate / .05,
        sectionToSedimentRate: f.transferStep.sectionToSediment / .05,
        sectionToNodeRate: f.transferStep.sectionToFloc / .05,
        erosionRate: f.transferStep.flocToSection / .05,
        fragmentationRate: 0, meanRadiusUm: weightedUm, maxRadiusUm: maxUm,
        maxWith001Um: at001, maxWith01Um: at01, visibleNodes: f.flocSystem?.nodes.length ?? 0,
        ...Object.fromEntries(masses.map((v, b) => [`mass${b}`, v])),
        ...Object.fromEntries(numbers.map((v, b) => [`count${b}`, v])),
        ...Object.fromEntries(Array.from(f.sections?.transfers ?? []).map((v, b) => [`growthRate${b}`, v / .05])),
        ...Object.fromEntries(Array.from(f.sections?.slip ?? []).map((v, b) => [`slipMps${b}`, v])),
        ...Object.fromEntries(d ? [['p05', d.p05], ['p50', d.p50], ['p95', d.p95], ['p99', d.p99],
          ['cv', d.cv], ['depth05', d.depth05], ['depth02', d.depth02], ['depth1', d.depth1],
          ['gradMeanPerMm', d.gradMeanPerMm], ['gradMaxPerMm', d.gradMaxPerMm],
          ...(['regions10', 'regions50'] as const).flatMap(name => Object.entries(d[name]).map(([k, v]) => [`${name}_${k}`, Array.isArray(v) ? v.join('|') : v]))] : []),
      };
      rows.push(row);
      if ((radiusUm === .05 && scale === 1 && quality === 'LOW') || reportTimes.has(t) || baseline) {
        const raw = f.dumpAggregateState();
        const stamp = String(t).replace('.', '_');
        if (!baseline && radiusUm === .05 && scale === 1 && quality === 'LOW')
          writeFileSync(`${shared}/wave19_state_${stamp}s.json`, JSON.stringify(raw));
        if (reportTimes.has(t)) {
          const optical = silverAggregateDumpFromState(raw);
          const ppm = renderSilverLayers(optical, 0, 2, 48, 112, 0);
          writeFileSync(`${output}/${label}_${stamp}s.ppm`, ppm);
          const header = `P6\n48 112\n255\n`.length, light: number[] = [];
          for (let i = header; i < ppm.length; i += 3) light.push((ppm[i] + ppm[i + 1] + ppm[i + 2]) / (3 * 255));
          const sorted = light.slice().sort((a, b) => a - b), cutoff = percentile(sorted, .9);
          const seen = new Uint8Array(light.length), width = 48; let brightRegions = 0;
          if (cutoff > .05) for (let i = 0; i < light.length; i++) {
            if (seen[i] || light[i] < cutoff) continue;
            brightRegions++; seen[i] = 1; const queue = [i];
            for (let q = 0; q < queue.length; q++) {
              const j = queue[q], x = j % width, neighbors = [x ? j - 1 : -1, x + 1 < width ? j + 1 : -1,
                j >= width ? j - width : -1, j + width < light.length ? j + width : -1];
              for (const h of neighbors) if (h >= 0 && !seen[h] && light[h] >= cutoff) { seen[h] = 1; queue.push(h); }
            }
          }
          row.denseCoreLuminance = percentile(sorted, .95);
          row.sparseLuminance = percentile(sorted, .5);
          row.luminanceContrast = Number(row.denseCoreLuminance) - Number(row.sparseLuminance);
          row.brightRegions = brightRegions;
        }
      }
    }
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    writeFileSync(`${output}/${label}.csv`, [columns.join(','), ...rows.map(row => columns.map(k => row[k] ?? '').join(','))].join('\n') + '\n');
    const last = rows.at(-1)!;
    return { label, radiusUm, scale, quality, baseline, maxError, last, first };
  } finally { f.dispose(); }
}

describe('wave 19 S1 full sensitivity grid', () => {
  it('records the deterministic real-pour radius and bounded sticking grid', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    mkdirSync(output, { recursive: true }); mkdirSync(shared, { recursive: true });
    try {
      const summaries = [run(.2, 1, 'LOW', true)];
      for (const radius of [.02, .05, .1, .2]) for (const alpha of [.05, .2, .5, 1])
        summaries.push(run(radius, alpha, 'LOW'));
      summaries.push(run(.05, 1, 'HIGH'));
      const columns = ['label', 'radiusUm', 'scale', 'quality', 'maxError', 'extent', 'fine', 'sections', 'nodesMass', 'sediment', 'meanRadiusUm', 'maxWith001Um', 'maxWith01Um', 'visibleNodes'];
      writeFileSync(`${output}/summary.csv`, [columns.join(','), ...summaries.map(s =>
        columns.map(k => k in s ? (s as unknown as Record<string, unknown>)[k] : s.last[k]).join(','))].join('\n') + '\n');
      writeFileSync(`${output}/crossings.json`, JSON.stringify(summaries.map(({ label, first }) => ({ label, first })), null, 2));
      expect(Math.max(...summaries.map(s => s.maxError))).toBeLessThan(1e-12);
      for (const radius of [.02, .05, .1, .2]) {
        const points = summaries.filter(s => !s.baseline && s.quality === 'LOW' && s.radiusUm === radius);
        for (let i = 1; i < points.length; i++)
          expect(Number(points[i].last.fine)).toBeLessThan(Number(points[i - 1].last.fine));
      }
      for (const alpha of [.05, .2, .5, 1]) {
        const points = summaries.filter(s => !s.baseline && s.quality === 'LOW' && s.scale === alpha);
        for (let i = 1; i < points.length; i++)
          expect(Number(points[i].last.fine)).toBeGreaterThan(Number(points[i - 1].last.fine));
      }
    } finally {
      delete (globalThis as { __silverAgg?: number }).__silverAgg;
      delete (globalThis as { __silverPrimaryRadiusUm?: number }).__silverPrimaryRadiusUm;
      delete (globalThis as { __silverStickingScale?: number }).__silverStickingScale;
      vi.unstubAllGlobals();
    }
  }, 900000);
});
