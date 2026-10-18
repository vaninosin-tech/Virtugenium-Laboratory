import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Priority 5 (controlled comparison). Driver derived from coupling.test.ts; the passive-scalar buoyancy feedback stays ON here.
// (Priority 2 context: is the position of the newly formed AgCl an artefact of the order "transport (many sub-steps), then react once"?
// Same scenario for every run (verified in the game: 1 mL AgNO3, then the 1 mL NaCl portion on the game pour curve), same
// delivered mass, same kinetics, same grid. The passive-scalar feedback on the flow is off (__silverBuoy = 0) so the faces
// are identical in every run; only the interval at which transport and reaction alternate changes.
const INITIAL_ML = Number(process.env.INITIAL_ML ?? 1);
const SNAPS = [1000, 1350, 2500, 4000];
const DETAIL = [700, 850, 1000, 1350, 2500];

interface Snap { reactive: number; fineTop3: number; tracerTop3: number; agTop3: number; maxSpeed: number; meanSpeed: number; formedStep: Float64Array; fineByY: Float64Array; tracerByY: Float64Array; agByY: Float64Array; clByY: Float64Array; extent: number }
interface Result { n: number; label: string; extent: Map<number, number>; formedByY: Float64Array; level: number; dy: number;
  conserved: number; minSpecies: number; advanceMs: number[]; substeps: number; courant: number }

type Config = { label: string; stream?: unknown; jet?: boolean; coupling?: number };
async function run(cfg: Config): Promise<Result & { snap: Map<number, Snap>; solverMs: number[]; projMs: number[]; forcing: number[] }> {
  vi.stubGlobal('window', { location: { search: '' } });
  const g = globalThis as Record<string, unknown>;
  if (cfg.stream !== undefined) g.__silverStream = cfg.stream;
  if (cfg.jet) g.__silverJetModel = 1;
  if (cfg.coupling !== undefined) g.__silverStreamCoupling = cfg.coupling;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const { streamStateFromEvent } = await import('../../../src/scenes/laboratory/lib/tubeStreamModel');
  const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const priv = f as unknown as { productSource: Float64Array; solver: { substeps: number; lastMaxCourant: number } };
  const m = f.mask, dy = m.height / m.ny, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
  const formedByY = new Float64Array(m.ny), extent = new Map<number, number>(), advanceMs: number[] = [], snap = new Map<number, Snap>(), solverMs: number[] = [], projMs: number[] = [], forcing: number[] = [];
  let previousMl = 0, delivered = 0, mlTotal = INITIAL_ML, started = false, conserved = 0, minSpecies = 0, level = 0, substeps = 0, courant = 0;
  for (let atMs = 0; atMs <= 4000; atMs += 50) {
    const total = pouredMl(Math.min(1, atMs / 1700)), ml = total - previousMl;
    let rate = 0;
    if (ml > 1e-12) { previousMl = total; delivered += ml; mlTotal += ml; rate = ml * 20; started = true; }
    if (!started) continue;
    level = tubeLiquidHeight(mlTotal, silverEffectiveRadius);
    m.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny)), p = m.point(x, y, z);
      if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y;
    }
    inlet.y = top;
    if (ml > 1e-12) f.streamState = streamStateFromEvent({ tubeId: 't', reagentId: 'nacl', serial: 1, step: atMs, ml, requestedMl: ml,
      point: { x: 0.0065, y: level, z: 0 }, surfaceY: level, atMs, valid: true, reason: 'ok', sourceMouth: { x: 0, y: 0.15, z: 0 } }, 50);
    const t0 = performance.now();
    f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
    if (ml > 1e-12) { solverMs.push((priv.solver as unknown as { lastStepMs: number }).lastStepMs); projMs.push((priv.solver as unknown as { lastProjectionMs: number }).lastProjectionMs); forcing.push((priv.solver as unknown as { lastForcingMs: number }).lastForcingMs);
      advanceMs.push(performance.now() - t0); substeps = Math.max(substeps, priv.solver.substeps); courant = Math.max(courant, priv.solver.lastMaxCourant); }
    f.streamState = undefined;
    f.assertMassInvariant();
    conserved = Math.max(conserved, Math.abs(f.species['Ag+'].total + f.extent - f.silverAmount), Math.abs(f.species['Cl-'].total + f.extent - f.delivered));
    minSpecies = Math.min(minSpecies, ...f.species['Ag+'].values, ...f.species['Cl-'].values, ...f.suspension[0]);
    for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; formedByY[Math.floor(i / m.nx) % m.ny] += priv.productSource[i]; }
    if (SNAPS.includes(atMs)) extent.set(atMs, f.extent);
    if (DETAIL.includes(atMs)) {
      const fineByY = new Float64Array(m.ny), tracerByY = new Float64Array(m.ny), agByY = new Float64Array(m.ny), clByY = new Float64Array(m.ny), formedStep = new Float64Array(m.ny), cells = new Float64Array(m.ny);
      let topRow = -1, reactive = 0, speed = 0, maxSpeed = 0, meanAg = 0, meanCl = 0;
      const flow = (priv.solver as unknown as { flow: Float32Array }).flow;
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; meanAg += f.species['Ag+'].values[i]; meanCl += f.species['Cl-'].values[i]; }
      meanAg /= m.activeCount; meanCl /= m.activeCount;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], y = Math.floor(i / m.nx) % m.ny; topRow = Math.max(topRow, y); cells[y]++;
        fineByY[y] += f.suspension[0][i]; tracerByY[y] += f.tracer[i]; agByY[y] += f.species['Ag+'].values[i]; clByY[y] += f.species['Cl-'].values[i]; formedStep[y] += priv.productSource[i];
        if (f.species['Ag+'].values[i] > 0.05 * meanAg && f.species['Cl-'].values[i] > 0.05 * meanCl) reactive++;
        const sp = Math.hypot(flow[3 * i], flow[3 * i + 1], flow[3 * i + 2]); speed += sp; maxSpeed = Math.max(maxSpeed, sp);
      }
      const top3 = (v: Float64Array) => v[topRow] + v[topRow - 1] + v[topRow - 2], sum = (v: Float64Array) => v.reduce((p, q) => p + q, 0) || 1;
      snap.set(atMs, { reactive: reactive / m.activeCount, fineTop3: top3(fineByY) / sum(fineByY), tracerTop3: top3(tracerByY) / sum(tracerByY),
        agTop3: top3(agByY) / (cells[topRow] + cells[topRow - 1] + cells[topRow - 2]), maxSpeed, meanSpeed: speed / m.activeCount, formedStep, fineByY, tracerByY, agByY, clByY, extent: f.extent });
    }
  }
  f.dispose(); vi.unstubAllGlobals();
  for (const k of ['__silverStream', '__silverJetModel', '__silverStreamCoupling']) delete g[k];
  return { snap, solverMs, projMs, forcing, n: cfg.coupling ?? 0, label: cfg.label, extent, formedByY, level, dy, conserved, minSpecies,
    advanceMs, substeps, courant };
}


const total = (v: Float64Array) => v.reduce((a, b) => a + b, 0) || 1;
const centroidMm = (v: Float64Array, dy: number) => 1000 * v.reduce((s, q, y) => s + q * (y + 0.5) * dy, 0) / total(v);
const nearSurface = (r: Result, mm = 3) => r.formedByY.reduce((s, v, y) => s + ((y + 0.5) * r.dy > r.level - mm / 1000 ? v : 0), 0) / total(r.formedByY);
const median = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] ?? 0;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);

describe('Priority 5: A baseline, B stream as built, B corrected (coupled + surface rise), C legacy jet. Same scenario: 1 mL + 1 mL', () => {
  it('prints the comparison and keeps conservation, nonnegativity and the interior', async () => {
    const configs: Config[] = [{ label: 'A baseline' }, { label: 'B stream as built (split)', stream: true },
      { label: 'B stream corrected (n=8, surface rise)', stream: { surfaceRise: true }, coupling: 8 }, { label: 'C legacy jet (diagnostic)', jet: true }];
    const results = []; for (const c of configs) results.push(await run(c));
    const lines = [`FINAL COMPARISON (LOW grid, ${INITIAL_ML} mL AgNO3 + 1 mL NaCl, identical delivery history; liquid ${(results[0].level * 1000).toFixed(1)} mm after the pour)`];
    for (const r of results) {
      const q = r.snap.get(1350)!, q85 = r.snap.get(850)!;
      lines.push(`${r.label}`,
        `  extent @1.0/1.35/2.5/4.0 s: ${SNAPS.map(t => r.extent.get(t)!.toFixed(3)).join(' / ')}   newly formed AgCl: centroid ${centroidMm(r.formedByY, r.dy).toFixed(2)} mm, within 3 mm of the surface ${(100 * nearSurface(r)).toFixed(1)}%`,
        `  fine AgCl in the top three rows @0.85/1.0/1.35 s: ${[850, 1000, 1350].map(t => (100 * r.snap.get(t)!.fineTop3).toFixed(1) + '%').join(' / ')}   tracer top3 @1.35 ${(100 * q.tracerTop3).toFixed(1)}%   Ag+ in the top three rows @0.85/1.35 s: ${r.snap.get(850)!.agTop3.toFixed(2)} / ${q.agTop3.toFixed(2)}`,
        `  cells where Ag+ and Cl- overlap (both > 5% of the mean) @0.7/0.85/1.0/1.35 s: ${[700, 850, 1000, 1350].map(t => (100 * r.snap.get(t)!.reactive).toFixed(1) + '%').join(' / ')}   formed in the 0.85 s step: centroid ${centroidMm(q85.formedStep, r.dy).toFixed(2)} mm`,
        `  fluid |u| max / mean @0.85 s: ${q85.maxSpeed.toFixed(3)} m/s / ${(1000 * q85.meanSpeed).toFixed(1)} mm/s; @1.35 s ${q.maxSpeed.toFixed(3)} / ${(1000 * q.meanSpeed).toFixed(1)}`,
        `  cost per pouring step: advance mean ${mean(r.advanceMs).toFixed(1)} median ${median(r.advanceMs).toFixed(1)} peak ${Math.max(...r.advanceMs).toFixed(1)} ms; solver mean ${mean(r.solverMs).toFixed(2)} peak ${Math.max(...r.solverMs).toFixed(2)}; projection mean ${mean(r.projMs).toFixed(2)} peak ${Math.max(...r.projMs).toFixed(2)}; face forcing mean ${mean(r.forcing).toFixed(3)} ms`,
        `  conservation ${r.conserved.toExponential(1)}  min field ${r.minSpecies.toExponential(1)}`);
    }
    const depth = (r: Result & { snap: Map<number, Snap> }) => [...r.formedByY].map((v, y) => `${((y + 0.5) * r.dy * 1000).toFixed(1)}:${(100 * v / total(r.formedByY)).toFixed(0)}%`).filter(t => !t.endsWith(':0%')).join(' ');
    lines.push('Newly formed AgCl by height (mm: share of everything formed up to 4 s):');
    for (const r of results) lines.push(`  ${r.label.padEnd(40)} ${depth(r)}`);
    console.log(lines.join('\n'));
    for (const r of results) { expect(r.conserved).toBeLessThan(1e-9); expect(r.minSpecies).toBeGreaterThanOrEqual(-1e-12); }
  }, 1800000);
});
