import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDeliveries } from '../../../src/scenes/laboratory/lib/tubeDelivery';
import { resetTubeAmounts, seedTubeAmounts, tubeAmount } from '../../../src/scenes/laboratory/lib/tubeAmounts';
import { clearTubePourImpact, publishDeliveryEvent, pouredMl } from '../../../src/scenes/laboratory/lib/tubePourImpact';
import { silverRuntime } from '../../../src/scenes/laboratory/lib/tubeSilverRuntime';
import { useReagentStorageStore } from '../../../src/scenes/laboratory/lib/useReagentStorageStore';
import { useTestTubeStorageStore } from '../../../src/scenes/laboratory/lib/useTestTubeStorageStore';
import { useLaboratoryStore } from '../../../src/stores/laboratory/useLaboratoryStore';
import { tubeLiquidHeight, tubeEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';

// The field unit is 0.1 mmol (1 mL of 0.1 mol/L). Receiving AgNO3 is 0.1 mol/L, so its amount in units is its volume in mL.
const MMOL_PER_UNIT = 0.1;
const tubeId = 'silver-amount-tube';
beforeEach(() => { clearDeliveries(); resetTubeAmounts(); clearTubePourImpact(tubeId); useReagentStorageStore.setState({ sourceMl: {}, debitedEvents: new Set() }); });
afterEach(() => { silverRuntime.reset(); vi.unstubAllGlobals(); useLaboratoryStore.setState({ selectedExperimentId: null }); });

function pour(untilMs: number, search = '') {
  vi.stubGlobal('window', { location: { search } });
  useLaboratoryStore.setState({ selectedExperimentId: 'experiment-silver-nitrate-sodium-chloride' });
  useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: ['agno3'] }], fumeHoodTestTubes: [] });
  seedTubeAmounts(tubeId, ['agno3']);
  const agnoMl = tubeAmount(tubeId).volumeMl;
  let previous = 0, step = 0;
  const trace: { t: number; ag: number; cl: number; extent: number; delivered: number }[] = [];
  for (let atMs = 0; atMs <= untilMs; atMs += 50) {
    const total = pouredMl(Math.min(1, atMs / 1700)), ml = total - previous;
    if (atMs <= 1700 && ml > 1e-12) {
      previous = total;
      const y = tubeLiquidHeight(tubeAmount(tubeId).volumeMl, tubeEffectiveRadius(0.055));
      publishDeliveryEvent({ tubeId, reagentId: 'nacl', sourceId: 'bottle', serial: 1000, step: ++step, ml, requestedMl: ml,
        point: { x: 0.0065, y, z: 0 }, surfaceY: y, atMs }, { axis: { x: 0, y, z: 0 }, radius: 0.007, surfaceY: y, hasLiquid: true },
      new THREE.Vector3(0, -1, 0), 1);
    }
    silverRuntime.tick(1000 + atMs);
    const f = silverRuntime.field(tubeId);
    if (f && atMs % 5000 === 0) trace.push({ t: atMs / 1000, ag: f.species['Ag+'].total, cl: f.species['Cl-'].total, extent: f.extent, delivered: f.delivered });
  }
  return { agnoMl, trace, f: silverRuntime.field(tubeId)! };
}

describe('Ag+ amount follows the receiving AgNO3 volume (0.1 mol/L)', () => {
  it('2.5 mL AgNO3 + 1 mL NaCl: 0.25 mmol Ag+, 0.10 mmol Cl- delivered, at most 0.10 mmol AgCl, 0.15 mmol Ag+ left', () => {
    const { agnoMl, trace, f } = pour(90000);
    expect(agnoMl).toBeCloseTo(2.5, 12);
    const first = trace[0];
    expect((first.ag + first.extent) * MMOL_PER_UNIT).toBeCloseTo(0.25, 9);          // Ag+ present + already precipitated
    for (const row of trace) {
      expect((row.ag + row.extent) * MMOL_PER_UNIT).toBeCloseTo(0.25, 9);           // silver conserved
      expect((row.cl + row.extent) * MMOL_PER_UNIT).toBeCloseTo(row.delivered * MMOL_PER_UNIT, 9);   // chloride conserved
      expect(row.extent * MMOL_PER_UNIT).toBeLessThanOrEqual(0.10 + 1e-9);          // limited by the chloride
    }
    const last = trace.at(-1)!;
    expect(f.delivered).toBeCloseTo(1, 9);
    expect(last.extent * MMOL_PER_UNIT).toBeGreaterThan(0.098);                     // chloride consumed
    expect(last.ag * MMOL_PER_UNIT).toBeCloseTo(0.25 - last.extent * MMOL_PER_UNIT, 9);
    expect(last.ag * MMOL_PER_UNIT).toBeGreaterThan(0.149);                         // about 0.15 mmol Ag+ remains
    f.assertMassInvariant();
    console.log('2.5 mL case:', JSON.stringify(trace.filter((_, i) => [0, 2, 6, 12, 18].includes(i))));
  }, 300000);
  it('regression: 1 mL AgNO3 holds 0.10 mmol Ag+ (stoichiometric with the NaCl)', () => {
    const { agnoMl, trace } = pour(20000, '?agnoMl=1');
    expect(agnoMl).toBeCloseTo(1, 12);
    for (const row of trace) expect((row.ag + row.extent) * MMOL_PER_UNIT).toBeCloseTo(0.10, 9);
  }, 300000);
});
