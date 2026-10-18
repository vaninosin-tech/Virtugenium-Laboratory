import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// A baseline, B physical stream (__silverStream), C legacy jet model (__silverJetModel, comparison only): identical
// delivered-liquid histories (the game's pour curve in 50 ms steps), LOW grid, aggregation off. Prints the tables of
// docs/night/stream/REPORT.md and checks ledger, reactant limits and the vessel interior.
type Config = 'A' | 'B' | 'C';
interface Snap { t: number; level: number; extent: number; delivered: number; agTotal: number; clTotal: number; minSpecies: number;
  formedByMm: Map<number, number>; formedTotal: number; topShareFormed: number; aboveOldSurface: number; fineTop3: number; tracerTop3: number;
  agTop3: number; near: number; occupied: number; maxSpeed: number; meanSpeed: number; maxDown: number; maxUp: number;
  courant: number; substeps: number; outsideSpeed: number; fineMax: number; fineMean: number; layerHeightMm: number }
const MARKS = [700, 850, 1000, 1350, 1700, 2500, 4000, 6000];

async function run(config: Config, flags: Record<string, unknown> = {}, opts: { endMs?: number; fall?: number; quality?: 'LOW' | 'HIGH' } = {}) {
  vi.stubGlobal('window', { location: { search: '' } });
  const g = globalThis as Record<string, unknown>;
  const set: string[] = [];
  if (config === 'B') { g.__silverStream = flags.stream ?? true; set.push('__silverStream'); }
  if (config === 'C') { g.__silverJetModel = 1; set.push('__silverJetModel'); }
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const { streamStateFromEvent } = await import('../../../src/scenes/laboratory/lib/tubeStreamModel');
  const f = new TubeSilverField(opts.quality ?? 'LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const priv = f as unknown as { solver: { flow: Float32Array; lastMaxCourant: number; substeps: number; lastStepMs: number; lastProjectionMs: number }; productSource: Float64Array };
  const m = f.mask, dy = m.height / m.ny, dx = 2 * m.radius / m.nx, up = new THREE.Vector3(0, 1, 0);
  const inlet = new THREE.Vector3(0.0065, 0, 0);
  const cum = new Float64Array(m.ny);
  const snaps = new Map<number, Snap>();
  const timing = { advance: [] as number[], solver: [] as number[], projection: [] as number[], substeps: [] as number[], prepare: [] as number[], forcing: [] as number[] };
  let previousMl = 0, delivered = 0, mlTotal = 2.5, started = false, penetration = 0, entrained = 0, endSpeed = 0, momentum = 0, impact = 0;
  for (let atMs = 0; atMs <= (opts.endMs ?? 6000); atMs += 50) {
    const total = pouredMl(Math.min(1, atMs / 1700)), ml = total - previousMl;
    let rate = 0;
    if (ml > 1e-12) { previousMl = total; delivered += ml; mlTotal += ml; rate = ml * 20; started = true; }
    if (!started) continue;
    const level = tubeLiquidHeight(mlTotal, silverEffectiveRadius);
    m.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      const p = m.point(x, y, z);
      if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y;
    }
    inlet.y = top;
    if (config === 'B' && ml > 1e-12) f.streamState = streamStateFromEvent({ tubeId: 't', reagentId: 'nacl', serial: 1, step: atMs, ml, requestedMl: ml,
      point: { x: 0.0065, y: level, z: 0 }, surfaceY: level, atMs, valid: true, reason: 'ok', sourceMouth: { x: 0, y: 0.15, z: 0 },
      ...(opts.fall !== undefined ? { sourceOutlet: { x: 0.0065, y: level + opts.fall, z: 0 } } : {}) }, 50);
    const t0 = performance.now();
    f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
    const wall = performance.now() - t0;
    f.streamState = undefined;
    if (f.streamModel) { penetration = Math.max(penetration, f.streamModel.penetration); entrained = Math.max(entrained, f.streamModel.entrainedFlow); endSpeed = f.streamModel.endSpeed || endSpeed; momentum = Math.max(momentum, f.streamModel.inputMomentum); impact = f.streamModel.state?.impactSpeed ?? impact; }
    if (ml > 1e-12) { timing.advance.push(wall); timing.solver.push(priv.solver.lastStepMs); timing.projection.push(priv.solver.lastProjectionMs); timing.substeps.push(priv.solver.substeps);
      timing.prepare.push(f.streamModel?.lastPrepareMs ?? 0); timing.forcing.push((priv.solver as unknown as { lastForcingMs: number }).lastForcingMs); }
    f.assertMassInvariant();
    for (let a = 0; a < m.activeCount; a++) { const i = m.active[a], y = Math.floor(i / m.nx) % m.ny; cum[y] += priv.productSource[i]; }
    if (!MARKS.includes(atMs)) continue;
    // Snapshot.
    const rows = new Float64Array(m.ny), tracerRows = new Float64Array(m.ny), agRows = new Float64Array(m.ny), cells = new Float64Array(m.ny);
    let topRow = -1, near = 0, fineTotal = 0, fineMax = 0, speedSum = 0, maxSpeed = 0, maxDown = 0, maxUp = 0, occupiedCells = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny)), v = f.suspension[0][i];
      rows[y] += v; tracerRows[y] += f.tracer[i]; agRows[y] += f.species['Ag+'].values[i] * m.activeCount; cells[y]++; topRow = Math.max(topRow, y);
      fineTotal += v; fineMax = Math.max(fineMax, v);
      const p = m.point(x, y, z); if (Math.hypot(p.x - 0.0065, p.z) < 0.0035) near += v;
      const u = priv.solver.flow, sp = Math.hypot(u[3 * i], u[3 * i + 1], u[3 * i + 2]);
      speedSum += sp; maxSpeed = Math.max(maxSpeed, sp); maxDown = Math.max(maxDown, -u[3 * i + 1]); maxUp = Math.max(maxUp, u[3 * i + 1]);
    }
    for (let a = 0; a < m.activeCount; a++) if (f.suspension[0][m.active[a]] > 0.1 * fineMax) occupiedCells++;
    let outside = 0;
    for (let i = 0; i < m.data.length; i++) if (!m.data[i]) outside = Math.max(outside, Math.hypot(priv.solver.flow[3 * i], priv.solver.flow[3 * i + 1], priv.solver.flow[3 * i + 2]));
    const formedByMm = new Map<number, number>(); let formedTotal = 0;
    for (let y = 0; y < m.ny; y++) { formedTotal += cum[y]; if (cum[y] > 0) formedByMm.set(Math.round((y + 0.5) * dy * 1000 * 10) / 10, cum[y]); }
    let above21 = 0, aboveOld = 0; for (let y = 0; y < m.ny; y++) { if ((y + 0.5) * dy > 0.021) above21 += cum[y]; if ((y + 0.5) * dy > 0.0186) aboveOld += cum[y]; }
    const sum3 = (arr: Float64Array) => arr[topRow] + arr[topRow - 1] + arr[topRow - 2];
    const minSpecies = Math.min(...f.species['Ag+'].values, ...f.species['Cl-'].values);
    snaps.set(atMs, { t: atMs, level, extent: f.extent, delivered: f.delivered, agTotal: f.species['Ag+'].total, clTotal: f.species['Cl-'].total, minSpecies,
      formedByMm, formedTotal, topShareFormed: above21 / (formedTotal || 1), aboveOldSurface: aboveOld / (formedTotal || 1),
      fineTop3: sum3(rows) / (fineTotal || 1), tracerTop3: sum3(tracerRows) / (tracerRows.reduce((p, q) => p + q, 0) || 1),
      agTop3: (agRows[topRow] + agRows[topRow - 1] + agRows[topRow - 2]) / (cells[topRow] + cells[topRow - 1] + cells[topRow - 2]),
      near: near / (fineTotal || 1), occupied: occupiedCells / m.activeCount, maxSpeed, meanSpeed: speedSum / m.activeCount, maxDown, maxUp,
      courant: priv.solver.lastMaxCourant, substeps: priv.solver.substeps, outsideSpeed: outside, fineMax, fineMean: fineTotal / m.activeCount,
      layerHeightMm: (topRow + 1) * dy * 1000 });
  }
  const summary = { ledgerDelivered: delivered, gain: mlTotal - 2.5, silverAmount: f.silverAmount, extent: f.extent, penetration, entrained, endSpeed, momentum, impact };
  f.dispose(); vi.unstubAllGlobals();
  for (const name of set) delete g[name];
  return { snaps, timing, summary };
}

const pct = (v: number) => (100 * v).toFixed(1) + '%';
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(0.95 * (a.length - 1))] ?? 0;

describe('A baseline, B physical stream, C legacy jet: same delivered liquid, LOW grid', () => {
  it('ledger, reactant limits, vessel interior and the localization of the overlap', async () => {
    const results = new Map<Config, Awaited<ReturnType<typeof run>>>();
    for (const c of ['A', 'B', 'C'] as const) results.set(c, await run(c));
    const lines: string[] = ['STREAM COMPARISON (LOW grid, 2.5 mL AgNO3 + 1 mL NaCl on the game pour curve)'];
    for (const t of MARKS) {
      lines.push(`t=${(t / 1000).toFixed(2)} s`);
      for (const c of ['A', 'B', 'C'] as const) {
        const s = results.get(c)!.snaps.get(t)!;
        lines.push(`  ${c}: AgCl ${s.extent.toFixed(3)}  formed above 21 mm ${pct(s.topShareFormed)}  above old surface ${pct(s.aboveOldSurface)}  fine in top3 rows ${pct(s.fineTop3)}  tracer top3 ${pct(s.tracerTop3)}`
          + `  Ag+ top3 ${s.agTop3.toFixed(3)}  AgCl within 3.5 mm of stream ${pct(s.near)}  occupied cells ${pct(s.occupied)}  fine max/mean ${(s.fineMax / s.fineMean).toFixed(1)}`
          + `  |u| max ${s.maxSpeed.toFixed(3)} mean ${(1000 * s.meanSpeed).toFixed(1)} mm/s  down ${s.maxDown.toFixed(3)} up ${s.maxUp.toFixed(3)} m/s  Courant ${s.courant.toFixed(1)} sub ${s.substeps}`);
      }
    }
    const b = results.get('B')!;
    lines.push(`B stream (largest over the pour): impact speed ${b.summary.impact.toFixed(2)} m/s, momentum flux ${(1000 * b.summary.momentum).toFixed(2)} mN, penetration ${(b.summary.penetration * 1000).toFixed(1)} mm, entrained ${(b.summary.entrained * 1e6).toFixed(2)} mL/s, speed at the end ${b.summary.endSpeed.toFixed(3)} m/s`);
    lines.push('Formation by absolute height at 1.7 s (mm: share of all AgCl formed so far)');
    for (const c of ['A', 'B', 'C'] as const) {
      const s = results.get(c)!.snaps.get(1700)!;
      lines.push(`  ${c}: ` + [...s.formedByMm.entries()].filter(([, v]) => v / s.formedTotal > 0.01).map(([mm, v]) => `${mm}:${(100 * v / s.formedTotal).toFixed(0)}%`).join(' '));
    }
    lines.push('Cost per pouring step (ms): advance wall median / p95 / max; solver step median; projection median; scalar sub-steps median / max');
    for (const c of ['A', 'B', 'C'] as const) {
      const tm = results.get(c)!.timing;
      lines.push(`  ${c}: ${median(tm.advance).toFixed(2)} / ${p95(tm.advance).toFixed(2)} / ${Math.max(...tm.advance).toFixed(2)}   solver ${median(tm.solver).toFixed(2)}   projection ${median(tm.projection).toFixed(2)}   stream prepare ${median(tm.prepare).toFixed(2)}   face forcing ${median(tm.forcing).toFixed(3)}   sub ${median(tm.substeps)} / ${Math.max(...tm.substeps)}`);
    }
    console.log(lines.join('\n'));
    for (const c of ['A', 'B', 'C'] as const) {
      const r = results.get(c)!;
      expect(Math.abs(r.summary.ledgerDelivered - r.summary.gain)).toBeLessThan(1e-12);       // delivered = vessel gain
      for (const s of r.snaps.values()) {
        expect(Math.abs(s.agTotal + s.extent - r.summary.silverAmount)).toBeLessThan(1e-9);     // Ag+ conserved
        expect(Math.abs(s.clTotal + s.extent - s.delivered)).toBeLessThan(1e-9);                // Cl- conserved
        expect(s.minSpecies).toBeGreaterThanOrEqual(-1e-12);                                    // production limited by reactants
        expect(s.outsideSpeed).toBe(0);                                                         // flow only inside the vessel
        expect(s.extent).toBeLessThanOrEqual(Math.min(r.summary.silverAmount, s.delivered) + 1e-9);
      }
    }
    expect(results.get('B')!.snaps.get(1700)!.maxSpeed).toBeLessThan(3);
    // The accepted baseline is unchanged by the stream code: these AgCl extents were recorded before the stream model existed.
    const base = results.get('A')!.snaps;
    expect(base.get(1000)!.extent).toBeCloseTo(0.058, 3); expect(base.get(1350)!.extent).toBeCloseTo(0.114, 3);
    expect(base.get(1700)!.extent).toBeCloseTo(0.170, 3); expect(base.get(2500)!.extent).toBeCloseTo(0.273, 3);
    expect(base.get(4000)!.extent).toBeCloseTo(0.406, 3);
  }, 600000);
});

describe('B: sensitivity to the one unmeasured input, the lip height above the surface', () => {
  it('penetration and overlap as a function of the free fall (the game supplies the measured lip)', async () => {
    const lines = ['LIP HEIGHT SENSITIVITY (input uncertainty, not tuning). fall = lip height above the surface at the moment of impact'];
    const rows: { fall: number; r: Awaited<ReturnType<typeof run>> }[] = [];
    for (const fall of [0.13, 0.06, 0.03, 0.015, 0.005]) rows.push({ fall, r: await run('B', {}, { fall, endMs: 4000 }) });
    for (const { fall, r } of rows) {
      const a = r.snaps.get(1350)!, b = r.snaps.get(2500)!, c = r.snaps.get(1000)!;
      lines.push(`  fall ${(fall * 100).toFixed(1)} cm: impact ${r.summary.impact.toFixed(2)} m/s  M ${(1000 * r.summary.momentum).toFixed(2)} mN  penetration ${(r.summary.penetration * 1000).toFixed(1)} mm  entrained ${(r.summary.entrained * 1e6).toFixed(2)} mL/s  end speed ${r.summary.endSpeed.toFixed(3)}`
        + `  | AgCl 1.0 s ${c.extent.toFixed(3)} 1.35 s ${a.extent.toFixed(3)} 2.5 s ${b.extent.toFixed(3)}  top3 fine 1.35 s ${pct(a.fineTop3)}  within 3.5 mm 1.35 s ${pct(a.near)}  occupied 1.35 s ${pct(a.occupied)}  above old surface ${pct(a.aboveOldSurface)}`);
    }
    const baseline = await run('A', {}, { endMs: 4000 });
    const a = baseline.snaps.get(1350)!, b = baseline.snaps.get(2500)!, c = baseline.snaps.get(1000)!;
    lines.push(`  baseline (no stream): AgCl 1.0 s ${c.extent.toFixed(3)} 1.35 s ${a.extent.toFixed(3)} 2.5 s ${b.extent.toFixed(3)}  top3 fine 1.35 s ${pct(a.fineTop3)}  within 3.5 mm ${pct(a.near)}  occupied ${pct(a.occupied)}`);
    console.log(lines.join('\n'));
    for (const { r } of rows) for (const s of r.snaps.values()) { expect(Math.abs(s.agTotal + s.extent - r.summary.silverAmount)).toBeLessThan(1e-9); expect(s.outsideSpeed).toBe(0); }
    // Penetration is a result: a slower stream must not reach deeper than a faster one.
    for (let k = 1; k < rows.length; k++) expect(rows[k].r.summary.penetration).toBeLessThanOrEqual(rows[k - 1].r.summary.penetration + 1e-9);
  }, 900000);
});

describe('B: robustness to the two modelling coefficients and to the grid', () => {
  it('entrainment coefficient bracket, turbulent decay bracket and the HIGH grid (fall 13 cm)', async () => {
    const lines = ['B ROBUSTNESS (literature coefficient bracket and grid; not tuning)'];
    const cases: { label: string; flags: Record<string, unknown>; quality?: 'LOW' | 'HIGH' }[] = [
      { label: 'alpha 0.057 (default), dissipation 0.1, LOW', flags: {} },
      { label: 'alpha 0.03', flags: { stream: { alpha: 0.03 } } },
      { label: 'alpha 0.09', flags: { stream: { alpha: 0.09 } } },
      { label: 'dissipation 0.03', flags: { stream: { dissipation: 0.03 } } },
      { label: 'dissipation 0.3', flags: { stream: { dissipation: 0.3 } } },
      { label: 'HIGH grid (16x32)', flags: {}, quality: 'HIGH' }];
    for (const c of cases) {
      const r = await run('B', c.flags, { endMs: 4000, quality: c.quality });
      const a = r.snaps.get(1000)!, b = r.snaps.get(1350)!, d = r.snaps.get(2500)!;
      lines.push(`  ${c.label.padEnd(44)} entrained ${(r.summary.entrained * 1e6).toFixed(2)} mL/s  AgCl 1.0 s ${a.extent.toFixed(3)} 1.35 s ${b.extent.toFixed(3)} 2.5 s ${d.extent.toFixed(3)}`
        + `  occupied 1.35 s ${pct(b.occupied)}  top3 fine ${pct(b.fineTop3)}  within 3.5 mm ${pct(b.near)}  |u| max ${b.maxSpeed.toFixed(2)}`);
      for (const s of r.snaps.values()) { expect(Math.abs(s.agTotal + s.extent - r.summary.silverAmount)).toBeLessThan(1e-9); expect(s.outsideSpeed).toBe(0); }
    }
    console.log(lines.join('\n'));
  }, 900000);
});
