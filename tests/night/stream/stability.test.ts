import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Gate item 1: the Courant number of every explicit scalar-advection sub-step in the stream configurations, 1 mL + 1 mL,
// game pour curve, LOW and HIGH grids. Reaction sub-steps (the coupling) and transport (CFL) sub-steps are counted separately.
interface Step { atMs: number; courantMax: number; passes: number; capHits: number; reactionSubsteps: number; reactionDt: number | null; fastSubsteps: number; courantAtReactionDt: number; courantAt50: number }

async function run(label: string, stream: unknown, coupling: number | 'auto' | undefined, quality: 'LOW' | 'HIGH') {
  vi.stubGlobal('window', { location: { search: '' } });
  const g = globalThis as Record<string, unknown>;
  g.__silverStream = stream; if (coupling !== undefined) g.__silverStreamCoupling = coupling;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
  const { streamStateFromEvent } = await import('../../../src/scenes/laboratory/lib/tubeStreamModel');
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const solver = (f as unknown as { solver: { maxTransportCourant: number; transportPasses: number; capHits: number; lastMaxCourant: number } }).solver;
  const m = f.mask, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
  const steps: Step[] = [];
  let previousMl = 0, delivered = 0, mlTotal = 1, started = false;
  for (let atMs = 0; atMs <= 4000; atMs += 50) {
    const total = pouredMl(Math.min(1, atMs / 1700)), ml = total - previousMl;
    let rate = 0;
    if (ml > 1e-12) { previousMl = total; delivered += ml; mlTotal += ml; rate = ml * 20; started = true; }
    if (!started) continue;
    const level = tubeLiquidHeight(mlTotal, silverEffectiveRadius);
    m.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny)), p = m.point(x, y, z);
      if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y;
    }
    inlet.y = top;
    if (ml > 1e-12) f.streamState = streamStateFromEvent({ tubeId: 't', reagentId: 'nacl', serial: 1, step: atMs, ml, requestedMl: ml,
      point: { x: 0.0065, y: level, z: 0 }, surfaceY: level, atMs, valid: true, reason: 'ok', sourceMouth: { x: 0, y: 0.15, z: 0 } }, 50);
    f.coupledStats = undefined;
    f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
    f.streamState = undefined;
    f.assertMassInvariant();
    const cs = f.coupledStats;
    steps.push({ atMs, courantMax: solver.maxTransportCourant, passes: solver.transportPasses, capHits: solver.capHits,
      reactionSubsteps: cs?.reactionSubsteps ?? 1, reactionDt: cs?.reactionDt ?? null, fastSubsteps: cs?.fastSubsteps ?? 0,
      courantAtReactionDt: cs?.courantAtReactionDt ?? 0, courantAt50: solver.lastMaxCourant });
  }
  f.dispose(); vi.unstubAllGlobals();
  for (const k of ['__silverStream', '__silverStreamCoupling']) delete g[k];
  return { label, quality, steps };
}

describe('Gate 1: explicit scalar-advection stability of the stream configurations', () => {
  it('every executed transport sub-step stays at or below Courant 1, in the final configuration and the other couplings', async () => {
    const configs: [string, unknown, number | 'auto' | undefined][] = [
      ['FINAL surfaceRise + coupling 8', { surfaceRise: true }, 8], ['stream as built (no coupling)', true, undefined],
      ['coupling 1', { surfaceRise: true }, 1], ['coupling 2', { surfaceRise: true }, 2], ['coupling 4', { surfaceRise: true }, 4], ['coupling auto', { surfaceRise: true }, 'auto']];
    const lines = ['TRANSPORT STABILITY (1 mL + 1 mL, pouring steps only). Courant = |face velocity| dt_sub / cell size of the executed explicit sub-step'];
    const all: Awaited<ReturnType<typeof run>>[] = [];
    for (const quality of ['LOW', 'HIGH'] as const) for (const [label, stream, coupling] of configs) {
      if (quality === 'HIGH' && label !== 'FINAL surfaceRise + coupling 8' && label !== 'stream as built (no coupling)') continue;
      const r = await run(label, stream, coupling, quality); all.push(r);
      const poured = r.steps.filter(s => s.atMs <= 1700);
      const peak = poured.reduce((a, s) => s.courantMax > a.courantMax ? s : a, poured[0]);
      lines.push(`${quality} ${label.padEnd(34)} max executed-sub-step Courant ${peak.courantMax.toFixed(3)} (at ${peak.atMs} ms)   cap hits ${Math.max(...poured.map(s => s.capHits))}   `
        + `Courant of the faces at the 50 ms step ${Math.max(...poured.map(s => s.courantAt50)).toFixed(1)}   reaction sub-steps ${peak.reactionSubsteps} (dt ${peak.reactionDt === null ? 50 : (1000 * peak.reactionDt).toFixed(2)} ms)   `
        + `fast-face CFL sub-steps per reaction sub-step ${Math.max(...poured.map(s => s.fastSubsteps))} from Courant ${Math.max(...poured.map(s => s.courantAtReactionDt)).toFixed(1)}   transport passes per step ${Math.max(...poured.map(s => s.passes))}`);
    }
    console.log(lines.join('\n'));
    for (const r of all) {
      const poured = r.steps.filter(s => s.atMs <= 1700);
      expect(Math.max(...poured.map(s => s.courantMax))).toBeLessThanOrEqual(1.0 + 1e-9);
      expect(Math.max(...poured.map(s => s.capHits))).toBe(0);
    }
  }, 1800000);
});
