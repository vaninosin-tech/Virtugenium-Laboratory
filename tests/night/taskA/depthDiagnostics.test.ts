import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Task A: depth-resolved fields for one pouring event on the LOW (game) and HIGH grids, separating where AgCl is
// FORMED (productSource) from where existing AgCl is TRANSPORTED (change of the fine suspension minus formation).
// Same driver as silverRuntime: 50 ms steps, the game's pour curve, ledger-rate jet strength, inlet on the highest
// wet voxel within 3 mm of the stream. Aggregation off. Prints tables; asserts the ledger and the step bookkeeping.
const POUR_MS = 1700;
const strainStats: Record<string, { max: number; p95: number; mean: number }[]> = {};
type Row = { wet: number; cells: number; ag: number; cl: number; tracer: number; formed: number; formedCum: number; fine: number;
  transport: number; w: number; sections: number };

async function drive(quality: 'LOW' | 'HIGH', marks: number[], flags: Record<string, number> = {}) {
  vi.stubGlobal('window', { location: { search: '' } });
  for (const [name, value] of Object.entries(flags)) (globalThis as Record<string, unknown>)[name] = value;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const { tubeVessel } = await import('../../../src/scenes/laboratory/lib/vesselGeometry');
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const priv = f as unknown as { flow: Float32Array; productSource: Float64Array };
  const m = f.mask, dy = m.height / m.ny, dx = 2 * m.radius / m.nx, up = new THREE.Vector3(0, 1, 0);
  const inlet = new THREE.Vector3(0.0065, 0, 0);
  const cumFormed = new Float64Array(m.ny);
  const snaps = new Map<number, { level: number; rows: Row[]; top: number }>();
  let previousMl = 0, delivered = 0, mlTotal = 2.5;
  let previousFine = new Float64Array(m.ny);
  for (let atMs = 0; atMs <= 4000; atMs += 50) {
    const total = pouredMl(Math.min(1, atMs / POUR_MS)), ml = total - previousMl;
    let rate = 0;
    if (ml > 1e-12) { previousMl = total; delivered += ml; mlTotal += ml; rate = ml * 20; }
    const level = tubeLiquidHeight(mlTotal, silverEffectiveRadius);
    if (delivered > 0) {
      m.update(up, level);
      let top = -Infinity;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
        const p = m.point(x, y, z);
        if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y;
      }
      inlet.y = top;
      const before = f.age;
      f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
      expect(Math.abs(f.age - before - 0.05)).toBeLessThan(1e-9);     // exactly one internal step
      f.assertMassInvariant();
    } else continue;
    const fineRows = new Float64Array(m.ny);
    const rows: Row[] = Array.from({ length: m.ny }, () => ({ wet: 0, cells: 0, ag: 0, cl: 0, tracer: 0, formed: 0, formedCum: 0, fine: 0,
      transport: 0, w: 0, sections: 0 }));
    let topRow = -1;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      const r = rows[y]; r.cells++; topRow = Math.max(topRow, y);
      const box: [number, number, number, number, number, number] = [-m.radius + x * dx, -m.radius + (x + 1) * dx, y * dy, (y + 1) * dy,
        -m.radius + z * dx, -m.radius + (z + 1) * dx];
      r.wet += tubeVessel.cellLiquidFraction(box, level);
      r.ag += f.species['Ag+'].values[i] * m.activeCount; r.cl += f.species['Cl-'].values[i] * m.activeCount;
      r.tracer += f.tracer[i] * m.activeCount;
      r.formed += priv.productSource[i]; cumFormed[y] += priv.productSource[i];
      r.fine += f.suspension[0][i]; fineRows[y] += f.suspension[0][i];
      r.w += priv.flow[3 * i + 1];
    }
    for (let y = 0; y < m.ny; y++) { rows[y].formedCum = cumFormed[y]; rows[y].transport = fineRows[y] - previousFine[y] - rows[y].formed; }
    previousFine = fineRows;
    if (marks.includes(atMs)) {
      snaps.set(atMs, { level, rows, top: topRow });
      // Strain rate sqrt(2 S:S) from the cell velocities with central differences over wet neighbours (the solver only
      // evaluates its own strain for the jet model).
      const dxs = [dx, dy, dx], strides = [1, m.nx, m.nx * m.ny], g = new Float64Array(9), values: number[] = [];
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], coords = [i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny))], lim = [m.nx, m.ny, m.nz];
        g.fill(0);
        for (let axis = 0; axis < 3; axis++) {
          const l = coords[axis] > 0 && m.data[i - strides[axis]] ? i - strides[axis] : -1;
          const r = coords[axis] + 1 < lim[axis] && m.data[i + strides[axis]] ? i + strides[axis] : -1;
          if (l < 0 && r < 0) continue;
          const h = dxs[axis] * (l >= 0 && r >= 0 ? 2 : 1);
          for (let c = 0; c < 3; c++) g[c * 3 + axis] = (priv.flow[3 * (r >= 0 ? r : i) + c] - priv.flow[3 * (l >= 0 ? l : i) + c]) / h;
        }
        let s2 = 0; for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) { const sv = 0.5 * (g[3 * p + q] + g[3 * q + p]); s2 += 2 * sv * sv; }
        values.push(Math.sqrt(s2));
      }
      values.sort((p, q) => p - q);
      (strainStats[quality] ??= []).push({ max: values[values.length - 1], p95: values[Math.floor(0.95 * values.length)],
        mean: values.reduce((x, y) => x + y, 0) / values.length });
    }
  }
  const summary = { age: f.age, extent: f.extent, cells: m.activeCount, dyMm: dy * 1000, ny: m.ny, nx: m.nx };
  f.dispose(); vi.unstubAllGlobals();
  for (const name of Object.keys(flags)) delete (globalThis as Record<string, unknown>)[name];
  return { snaps, summary };
}

function table(label: string, atMs: number, s: { level: number; rows: Row[]; top: number }, dyMm: number) {
  const tot = (k: keyof Row) => s.rows.reduce((a, r) => a + r[k], 0) || 1;
  const lines = [`${label} t=${(atMs / 1000).toFixed(2)} s level ${(s.level * 1000).toFixed(2)} mm, top wet row ${s.top} spans ${(s.top * dyMm).toFixed(2)}..${((s.top + 1) * dyMm).toFixed(2)} mm`
    + ` (surface minus row top = ${(s.level * 1000 - (s.top + 1) * dyMm).toFixed(2)} mm)`,
  '  row  wetFrac  Ag+conc  Cl-conc  tracer%  formed%step  formed%cum  fine%  netTransport(frac of step formation)  w(mm/s)'];
  const formedStep = tot('formed');
  for (let y = s.top; y >= Math.max(0, s.top - 6); y--) {
    const r = s.rows[y], c = Math.max(1, r.cells);
    lines.push(`  ${String(y - s.top).padStart(3)}  ${(r.wet / c).toFixed(2)}     ${(r.ag / c).toFixed(3)}    ${(r.cl / c).toExponential(1)}  ${(100 * r.tracer / tot('tracer')).toFixed(1).padStart(5)}`
      + `   ${(100 * r.formed / formedStep).toFixed(1).padStart(5)}      ${(100 * r.formedCum / tot('formedCum')).toFixed(1).padStart(5)}    ${(100 * r.fine / tot('fine')).toFixed(1).padStart(5)}`
      + `   ${(r.transport / formedStep).toFixed(2).padStart(8)}   ${(1000 * r.w / c).toFixed(2)}`);
  }
  return lines.join('\n');
}

describe('Task A: depth-resolved formation and transport on LOW and HIGH grids', () => {
  for (const quality of ['LOW', 'HIGH'] as const) {
    it(`${quality}: where AgCl forms versus where it is carried`, async () => {
      const marks = [700, 850, 1000, 1150, 1350, 1700, 2500, 4000];
      // Strain rate is only evaluated for the aggregation kernel, so the run that reports it has aggregation on.
      const { snaps, summary } = await drive(quality, marks, { __silverAgg: 1 });
      const out = [`TASK A DEPTH DIAGNOSTIC ${quality}: ${summary.nx}x${summary.ny} cells, ${summary.cells} wet at the end, dy ${summary.dyMm.toFixed(3)} mm, extent ${summary.extent.toFixed(3)}`];
      for (const t of marks) { const s = snaps.get(t); if (s) out.push(table(quality, t, s, summary.dyMm)); }
      // Absolute heights (the surface rises 6.5 mm during the pour, so row numbers counted from the top shift).
      const late = snaps.get(1700)!, total = late.rows.reduce((a, r) => a + r.formedCum, 0) || 1;
      out.push(`${quality} t=1.70 s cumulative AgCl formation by absolute height (surface 18.57 mm before, ${(late.level * 1000).toFixed(2)} mm now):`);
      out.push('  ' + late.rows.map((r, y) => ({ y, r })).filter(({ r }) => r.cells > 0 && r.formedCum / total > 0.005)
        .map(({ y, r }) => `${((y + 0.5) * summary.dyMm).toFixed(1)}mm:${(100 * r.formedCum / total).toFixed(1)}%`).join('  '));
      out.push(`${quality} strain rate (1/s) at ${marks.join(', ')} ms: ` + (strainStats[quality] ?? []).map(v => `max ${v.max.toFixed(1)} p95 ${v.p95.toFixed(1)} mean ${v.mean.toFixed(2)}`).join(' | '));
      console.log(out.join('\n'));
      expect(snaps.size).toBeGreaterThan(0);
    }, 300000);
  }
});

// Controls: the same pour with the model's own (physical, normally off) stronger-mixing options. Not a fix and not a
// calibration; it only shows whether the empty top layer is limited by vertical mixing of Ag+ into the incoming solution.
describe('Task A: is the empty top layer limited by mixing? (LOW, existing options only)', () => {
  it('compares default transport with the jet model and sub-grid mixing flags', async () => {
    const marks = [1700, 4000];
    const lines: string[] = ['TASK A MIXING CONTROLS (LOW). Top three wet rows: mean Ag+ conc, share of the fine AgCl; whole tube: AgCl extent'];
    for (const [name, flags] of [['default', {}], ['__silverJetModel', { __silverJetModel: 1 }], ['__silverSubgrid', { __silverSubgrid: 1 }]] as const) {
      const { snaps, summary } = await drive('LOW', marks, flags as Record<string, number>);
      for (const t of marks) {
        const sn = snaps.get(t)!, top3 = [0, 1, 2].map(k => sn.rows[sn.top - k]);
        const cells = top3.reduce((a, r) => a + r.cells, 0) || 1, fine = sn.rows.reduce((a, r) => a + r.fine, 0) || 1;
        const extent = sn.rows.reduce((a, r) => a + r.fine, 0);
        lines.push(`  ${name.padEnd(16)} t=${t / 1000} s  Ag+ top3 ${(top3.reduce((a, r) => a + r.ag, 0) / cells).toFixed(3)}  AgCl top3 ${(100 * top3.reduce((a, r) => a + r.fine, 0) / fine).toFixed(1)}%  AgCl in tube ${extent.toFixed(3)}  (age ${summary.age.toFixed(2)})`);
      }
    }
    console.log(lines.join('\n'));
  }, 300000);
});
