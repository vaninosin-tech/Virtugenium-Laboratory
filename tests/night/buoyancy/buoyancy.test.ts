import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// CPU comparison under identical pouring: accepted baseline, composition-consistent buoyancy, and the additive
// (double counting) variant. Same driver as silverRuntime: 50 ms steps, the game's pour curve, 1 mL AgNO3 + 1 mL NaCl.
const POUR_MS = 1700, MARKS = [2000, 5000, 10000], BANDS = 6;
type Snap = { level: number; bands: Record<string, number>[]; totals: Record<string, number>; upper: Record<string, number> };

async function drive(flag: unknown) {
  vi.stubGlobal('window', { location: { search: '' }, __silverAgg: process.env.AGG ? 1 : 0 });
  (globalThis as Record<string, unknown>).__silverBuoyancy = flag;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const priv = f as unknown as { flow: Float32Array };
  const m = f.mask, dy = m.height / m.ny, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
  const out = new Map<number, Snap>();
  let previousMl = 0, delivered = 0, mlTotal = 1;
  let volumeError = 0, massError = 0;
  for (let atMs = 0; atMs <= 10000; atMs += 50) {
    const total = pouredMl(Math.min(1, atMs / POUR_MS)), ml = total - previousMl;
    let rate = 0;
    if (ml > 1e-12) { previousMl = total; delivered += ml; mlTotal += ml; rate = ml * 20; }
    const level = tubeLiquidHeight(mlTotal, silverEffectiveRadius);
    if (delivered <= 0) continue;
    m.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      const p = m.point(x, y, z);
      if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y;
    }
    inlet.y = top;
    f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
    massError = Math.max(massError, Math.abs(f.massBalanceError));
    if (atMs % 500 === 0 && process.env.BUOY_TRACE) {
      const sv = (f as unknown as { solver: { diagnostics(): { meanAbsDivergence: number; energy: number } } }).solver.diagnostics();
      let maxT = 0, maxAg = 0, maxW = 0;
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; maxT = Math.max(maxT, f.tracer[i] * m.activeCount); maxAg = Math.max(maxAg, f.species['Ag+'].values[i] * m.activeCount); maxW = Math.max(maxW, Math.abs(priv.flow[3 * i + 1])); }
      console.log(`trace ${JSON.stringify(flag ?? 'baseline')} t=${atMs / 1000}s maxNaCl=${maxT.toFixed(2)} maxAg=${maxAg.toFixed(2)} max|w|=${(maxW * 1000).toFixed(1)}mm/s meanDiv=${sv.meanAbsDivergence.toFixed(2)}/s`);
    }
    if (!MARKS.includes(atMs)) continue;
    // Bands of equal row count from the bottom wet row to the top wet row.
    const rows: number[][] = Array.from({ length: m.ny }, () => []);
    for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; rows[Math.floor(i / m.nx) % m.ny].push(i); }
    const wetRows = rows.map((r, y) => (r.length ? y : -1)).filter(y => y >= 0), y0 = wetRows[0], y1 = wetRows.at(-1)!;
    const per = (y1 - y0 + 1) / BANDS;
    const bands = Array.from({ length: BANDS }, () => ({ nacl: 0, agno3: 0, agcl: 0, dAgno3: 0, dNacl: 0, dNano3: 0, dAgcl: 0, dTotal: 0, w: 0, n: 0, tracer: 0 }));
    const totals = { suspended: 0, deposited: 0, formed: f.extent, centroidMm: 0, downFluxMid: 0, meanW: 0 };
    let cw = 0, ww = 0;
    const mid = Math.floor((y0 + y1) / 2);
    const solidAt = (i: number) => (f.suspension[0][i] + f.suspension[1][i] + f.suspension[2][i]) * m.activeCount;
    for (let y = y0; y <= y1; y++) {
      const b = bands[Math.min(BANDS - 1, Math.floor((y - y0) / per))];
      for (const i of rows[y]) {
        const part = f.compositionDensity(i), s = solidAt(i), w = priv.flow[3 * i + 1];
        b.n++; b.tracer += f.tracer[i] * m.activeCount; b.agno3 += f.species['Ag+'].values[i] * m.activeCount; b.nacl += f.species['Cl-'].values[i] * m.activeCount; b.agcl += s;
        b.dAgno3 += part.agno3; b.dNacl += part.nacl; b.dNano3 += part.nano3; b.dAgcl += part.agcl; b.dTotal += part.total;
        b.w += s * w; // mass-weighted below
        totals.suspended += s / m.activeCount; cw += s * (y + 0.5) * dy; ww += s;
        if (y === mid) totals.downFluxMid += s * w / m.activeCount;       // AgCl flux through the mid plane (units x m/s)
      }
    }
    totals.deposited = f.sedimentMass; totals.centroidMm = ww > 0 ? cw / ww * 1000 : 0;
    totals.meanW = 0; let sw = 0; for (const b of bands) { sw += b.w; } totals.meanW = ww > 0 ? sw / ww * 1000 : 0;   // mm/s, mass-weighted
    const rowsOut = bands.map(b => ({ tracer: b.tracer / Math.max(1, b.n), agno3: b.agno3 / Math.max(1, b.n), agcl: b.agcl / Math.max(1, b.n),
      dNacl: b.dNacl / Math.max(1, b.n), dAgno3: b.dAgno3 / Math.max(1, b.n), dNano3: b.dNano3 / Math.max(1, b.n), dAgcl: b.dAgcl / Math.max(1, b.n),
      dTotal: b.dTotal / Math.max(1, b.n), w: b.agcl > 0 ? b.w / (b.agcl) * 1000 : 0 }));
    // Upper region: the rows above the highest row where the incoming-solution share falls below half of the top row's.
    const rowTracer = rows.map(r => r.reduce((sum, i) => sum + f.tracer[i] * m.activeCount, 0) / Math.max(1, r.length));
    const ref = rowTracer[y1]; let edge = y1; while (edge > y0 && rowTracer[edge - 1] > 0.5 * ref) edge--;
    out.set(atMs, { level, bands: rowsOut, totals, upper: { thicknessMm: (y1 - edge + 1) * dy * 1000, topTracer: ref, levelMm: level * 1000 } });
  }
  const sd = (f as unknown as { solver: { diagnostics(): { medianStepMs: number; meanAbsDivergence: number } } }).solver.diagnostics();
  console.log(`cost ${JSON.stringify(flag ?? 'baseline')}: median solver step ${sd.medianStepMs.toFixed(2)} ms (CPU, node), final mean|div| ${sd.meanAbsDivergence.toFixed(3)}/s`);
  expect(massError).toBeLessThan(1e-12);
  volumeError = Math.abs(tubeLiquidHeight(mlTotal, silverEffectiveRadius) - f.liquidLevel);
  void volumeError;
  delete (globalThis as Record<string, unknown>).__silverBuoyancy;
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 0.01 && v !== 0 ? 4 : 2));
function print(name: string, snaps: Map<number, Snap>) {
  for (const [t, s] of snaps) {
    const lines = [`${name} t=${t / 1000}s level=${fmt(s.upper.levelMm)}mm upper(thick ${fmt(s.upper.thicknessMm)}mm topNaCl ${fmt(s.upper.topTracer)})`
      + ` suspended=${fmt(s.totals.suspended)} deposited=${fmt(s.totals.deposited)} formed=${fmt(s.totals.formed)}`
      + ` centroid=${fmt(s.totals.centroidMm)}mm meanW=${fmt(s.totals.meanW)}mm/s midFlux=${s.totals.downFluxMid.toExponential(2)}`,
    '  band(top->bottom): NaCl(in) AgNO3 AgCl | dens kg/m3 AgNO3 NaCl NaNO3 AgCl total | wAgCl mm/s'];
    for (let b = BANDS - 1; b >= 0; b--) { const r = s.bands[b];
      lines.push(`  ${BANDS - b}: ${fmt(r.tracer)} ${fmt(r.agno3)} ${fmt(r.agcl)} | ${fmt(r.dAgno3)} ${fmt(r.dNacl)} ${fmt(r.dNano3)} ${fmt(r.dAgcl)} ${fmt(r.dTotal)} | ${fmt(r.w)}`); }
    console.log(lines.join('\n'));
  }
}

describe('buoyancy of suspended AgCl: baseline vs composition vs additive', () => {
  it('prints the required diagnostics and keeps the invariants', async () => {
    const base = await drive(undefined), comp = await drive({ mode: 'composition' }), add = await drive({ mode: 'additive' });
    print('BASELINE', base); print('COMPOSITION', comp); print('ADDITIVE', add);
    for (const t of MARKS) {
      expect(Math.abs(comp.get(t)!.totals.formed - base.get(t)!.totals.formed)).toBeLessThan(1);   // finite, same order
      for (const run of [base, comp, add]) expect(Number.isFinite(run.get(t)!.totals.suspended)).toBe(true);
    }
  }, 600000);
});
