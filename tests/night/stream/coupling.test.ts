import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Priority 2: is the position of the newly formed AgCl an artefact of the order "transport (many sub-steps), then react once"?
// Same scenario for every run (verified in the game: 1 mL AgNO3, then the 1 mL NaCl portion on the game pour curve), same
// delivered mass, same kinetics, same grid. The passive-scalar feedback on the flow is off (__silverBuoy = 0) so the faces
// are identical in every run; only the interval at which transport and reaction alternate changes.
const INITIAL_ML = Number(process.env.INITIAL_ML ?? 1);
const SNAPS = [1000, 1350, 2500, 4000];

interface Result { n: number; label: string; extent: Map<number, number>; formedByY: Float64Array; level: number; dy: number;
  conserved: number; minSpecies: number; advanceMs: number[]; substeps: number; courant: number }

async function run(coupling: number | undefined): Promise<Result> {
  vi.stubGlobal('window', { location: { search: '' } });
  const g = globalThis as Record<string, unknown>;
  g.__silverStream = true; g.__silverBuoy = 0;
  if (coupling !== undefined) g.__silverStreamCoupling = coupling;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const { streamStateFromEvent } = await import('../../../src/scenes/laboratory/lib/tubeStreamModel');
  const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const priv = f as unknown as { productSource: Float64Array; solver: { substeps: number; lastMaxCourant: number } };
  const m = f.mask, dy = m.height / m.ny, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
  const formedByY = new Float64Array(m.ny), extent = new Map<number, number>(), advanceMs: number[] = [];
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
    if (ml > 1e-12) { advanceMs.push(performance.now() - t0); substeps = Math.max(substeps, priv.solver.substeps); courant = Math.max(courant, priv.solver.lastMaxCourant); }
    f.streamState = undefined;
    f.assertMassInvariant();
    conserved = Math.max(conserved, Math.abs(f.species['Ag+'].total + f.extent - f.silverAmount), Math.abs(f.species['Cl-'].total + f.extent - f.delivered));
    minSpecies = Math.min(minSpecies, ...f.species['Ag+'].values, ...f.species['Cl-'].values, ...f.suspension[0]);
    for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; formedByY[Math.floor(i / m.nx) % m.ny] += priv.productSource[i]; }
    if (SNAPS.includes(atMs)) extent.set(atMs, f.extent);
  }
  f.dispose(); vi.unstubAllGlobals();
  for (const k of ['__silverStream', '__silverBuoy', '__silverStreamCoupling']) delete g[k];
  return { n: coupling ?? 0, label: coupling === undefined ? 'split (accepted)' : `coupled n=${coupling}`, extent, formedByY, level, dy, conserved, minSpecies,
    advanceMs, substeps, courant };
}

const total = (v: Float64Array) => v.reduce((a, b) => a + b, 0);
const centroidMm = (r: Result) => 1000 * r.formedByY.reduce((s, v, y) => s + v * (y + 0.5) * r.dy, 0) / total(r.formedByY);
const nearSurface = (r: Result, mm = 3) => r.formedByY.reduce((s, v, y) => s + ((y + 0.5) * r.dy > r.level - mm / 1000 ? v : 0), 0) / total(r.formedByY);
const l1 = (a: Result, b: Result) => { const na = total(a.formedByY), nb = total(b.formedByY); let d = 0;
  for (let y = 0; y < a.formedByY.length; y++) d += Math.abs(a.formedByY[y] / na - b.formedByY[y] / nb); return d / 2; };
const median = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] ?? 0;

describe('Priority 2: transport-reaction coupling in the physical stream (identical flow, 1 mL + 1 mL)', () => {
  it('position and amount of the newly formed AgCl against the reaction-update interval', async () => {
    const results: Result[] = [await run(undefined)];
    for (const n of [1, 2, 4, 8, 16, 32, 64, 128]) results.push(await run(n));
    const ref = results[results.length - 1], depth = ref.level * 1000;
    const lines = [`COUPLING STUDY (1 mL AgNO3 + 1 mL NaCl, LOW grid, stream flag on, buoyancy feedback off; final liquid depth ${depth.toFixed(1)} mm, cell ${(ref.dy * 1000).toFixed(2)} mm)`,
      'variant            dt_react  extent@1.0  @1.35  @2.5  @4.0 | centroid mm  near-surface(3 mm)  L1 vs n=128 | max|conservation|  min field  | advance ms median/max (courant max, solver substeps)'];
    for (const r of results) {
      const dt = r.n === 0 ? '50 ms (once)' : `${(50 / r.n).toFixed(2)} ms`;
      lines.push(`${r.label.padEnd(18)} ${dt.padEnd(12)} ${SNAPS.map(t => r.extent.get(t)!.toFixed(4)).join('  ')} | ${centroidMm(r).toFixed(2).padStart(6)}   ${(100 * nearSurface(r)).toFixed(1).padStart(6)}%   ${l1(r, ref).toFixed(3)} | ${r.conserved.toExponential(1)}  ${r.minSpecies.toExponential(1)} | ${median(r.advanceMs).toFixed(1)}/${Math.max(...r.advanceMs).toFixed(1)} (${r.courant.toFixed(1)}, ${r.substeps})`);
    }
    // Convergence: consecutive differences, error against the finest, thresholds of the acceptance criteria.
    const fine = results.slice(1);
    lines.push('Consecutive refinement (n -> 2n):  d(extent@2.5)   d(centroid mm)   d(near-surface pp)   L1');
    for (let k = 0; k + 1 < fine.length; k++) {
      const a = fine[k], b = fine[k + 1];
      lines.push(`  ${String(a.n).padStart(3)} -> ${String(b.n).padStart(3)}              ${(100 * (b.extent.get(2500)! - a.extent.get(2500)!) / b.extent.get(2500)!).toFixed(2)}%        ${(centroidMm(b) - centroidMm(a)).toFixed(2)}          ${(100 * (nearSurface(b) - nearSurface(a))).toFixed(1)}        ${l1(a, b).toFixed(3)}`);
    }
    const last = fine[fine.length - 1], prev = fine[fine.length - 2];
    const verdict = {
      extent: Math.abs(last.extent.get(2500)! - prev.extent.get(2500)!) / last.extent.get(2500)! < 0.05,
      centroid: Math.abs(centroidMm(last) - centroidMm(prev)) < Math.min(ref.dy * 1000, 0.05 * depth),
      nearSurface: Math.abs(nearSurface(last) - nearSurface(prev)) < 0.05,
      l1: l1(last, prev) < 0.10 };
    const errors = fine.slice(0, -1).map(r => l1(r, last));
    const decreasing = errors.every((e, k) => k === 0 || e <= errors[k - 1] + 1e-9);
    lines.push(`Acceptance between the two finest (n=64, n=128): ${JSON.stringify(verdict)}; L1 error against n=128 for n=1..64: ${errors.map(e => e.toFixed(3)).join(' ')} (decreasing: ${decreasing})`);
    console.log(lines.join('\n'));
    for (const r of results) { expect(r.conserved).toBeLessThan(1e-9); expect(r.minSpecies).toBeGreaterThanOrEqual(-1e-12); }
  }, 1800000);
});
