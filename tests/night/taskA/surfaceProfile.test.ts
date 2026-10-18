import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDeliveries, type DeliveryEvent } from '../../../src/scenes/laboratory/lib/tubeDelivery';
import { resetTubeAmounts, seedTubeAmounts, tubeAmount } from '../../../src/scenes/laboratory/lib/tubeAmounts';
import { pouredMl } from '../../../src/scenes/laboratory/lib/tubePourImpact';
import { silverRuntime } from '../../../src/scenes/laboratory/lib/tubeSilverRuntime';
import { POUR_MS } from '../../../src/scenes/laboratory/lib/useStandMotionStore';
import { useTestTubeStorageStore } from '../../../src/scenes/laboratory/lib/useTestTubeStorageStore';
import { tubeLiquidHeight, tubeEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';

// Task A (CPU part): where does the fine AgCl sit relative to the free surface during and after the pour, using the
// real stage-3 runtime (50 ms steps, the game's LOW field grid, the game's pour curve and jet rate).
// It prints a vertical profile and asserts only the ledger. The shader and meniscus clipping need the Windows game.
const tubeId = 'taskA-tube';
beforeEach(() => {
  vi.stubGlobal('window', { location: { search: '' } });
  clearDeliveries(); resetTubeAmounts();
  useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: ['agno3'] }], fumeHoodTestTubes: [] });
  seedTubeAmounts(tubeId, ['agno3']);
});
afterEach(() => { silverRuntime.reset(); vi.unstubAllGlobals(); });

describe('Task A: near-surface AgCl in the stage-3 runtime (aggregation off, fine suspension)', () => {
  it('reports the vertical profile of the fine suspension below the free surface', () => {
    const surface = () => tubeLiquidHeight(tubeAmount(tubeId).volumeMl, tubeEffectiveRadius(0.055));
    const report: string[] = [];
    const marks = new Set([600, 800, 1000, 1300, 1700, 2500, 4000, 6000, 10000, 14000]);
    let previous = 0, step = 0;
    for (let atMs = 0; atMs <= 14000; atMs += 50) {
      const total = pouredMl(Math.min(1, atMs / POUR_MS)), ml = total - previous;
      if (ml > 1e-12 && atMs <= POUR_MS) {
        previous = total;
        const e: DeliveryEvent = { tubeId, reagentId: 'nacl', serial: 1, step: ++step, ml, requestedMl: ml,
          point: { x: 0.0065, y: surface(), z: 0 }, surfaceY: surface(), atMs, valid: true, reason: 'ok' };
        expect(silverRuntime.applyDelivery(e)).toBe(true);
      }
      silverRuntime.tick(atMs);
      const f = silverRuntime.field(tubeId);
      if (!f) continue;
      f.assertMassInvariant();
      if (!marks.has(atMs)) continue;
      const m = f.mask, dy = m.height / m.ny, level = surface();
      const tracerRows = new Float64Array(m.ny), rows = new Float64Array(m.ny), cells = new Float64Array(m.ny), maxima = new Float64Array(m.ny);
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], row = Math.floor(i / m.nx) % m.ny, v = f.suspension[0][i];
        rows[row] += v; tracerRows[row] += f.tracer[i]; cells[row]++; maxima[row] = Math.max(maxima[row], v);
      }
      const total2 = rows.reduce((s, v) => s + v, 0) || 1, tracerTotal = tracerRows.reduce((s, v) => s + v, 0) || 1;
      let top = -1; for (let r = 0; r < m.ny; r++) if (cells[r] > 0) top = r;
      const lines = [`t=${(atMs / 1000).toFixed(2)} s: delivered ${f.delivered.toFixed(3)} mL, level ${(level * 1000).toFixed(2)} mm, ` +
        `top wet row ${top} spans ${(top * dy * 1000).toFixed(2)}..${((top + 1) * dy * 1000).toFixed(2)} mm (gap to surface ${((level - (top + 1) * dy) * 1000).toFixed(2)} mm), ` +
        `extent ${f.extent.toFixed(3)}, fine ${f.suspension[0].reduce((s, v) => s + v, 0).toFixed(3)}`];
      for (let r = top; r >= Math.max(0, top - 6); r--)
        lines.push(`   row ${r - top} (${((r + 0.5) * dy * 1000).toFixed(1)} mm): share ${(100 * rows[r] / total2).toFixed(1)}%  incoming-NaCl tracer share ${(100 * tracerRows[r] / tracerTotal).toFixed(1)}%  mean ${(rows[r] / Math.max(1, cells[r])).toExponential(2)}  max ${maxima[r].toExponential(2)}`);
      report.push(lines.join('\n'));
    }
    console.log('TASK A PROFILE\n' + report.join('\n'));
    expect(silverRuntime.field(tubeId)).toBeDefined();
  }, 120000);
});
