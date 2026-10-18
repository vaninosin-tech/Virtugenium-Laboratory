import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDeliveries } from '../../../src/scenes/laboratory/lib/tubeDelivery';
import { resetTubeAmounts, seedMl, seedTubeAmounts, tubeAmount, MAX_AGNO_REVIEW_ML } from '../../../src/scenes/laboratory/lib/tubeAmounts';
import { clearTubePourImpact, publishDeliveryEvent, pouredMl } from '../../../src/scenes/laboratory/lib/tubePourImpact';
import { silverRuntime } from '../../../src/scenes/laboratory/lib/tubeSilverRuntime';
import { useReagentStorageStore } from '../../../src/scenes/laboratory/lib/useReagentStorageStore';
import { useTestTubeStorageStore } from '../../../src/scenes/laboratory/lib/useTestTubeStorageStore';
import { useLaboratoryStore } from '../../../src/stores/laboratory/useLaboratoryStore';
import { tubeLiquidHeight, tubeEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';

const tubeId = 'agno-ml-tube';
beforeEach(() => { clearDeliveries(); resetTubeAmounts(); clearTubePourImpact(tubeId); useReagentStorageStore.setState({ sourceMl: {}, debitedEvents: new Set() }); });
afterEach(() => { silverRuntime.reset(); vi.unstubAllGlobals(); useLaboratoryStore.setState({ selectedExperimentId: null }); });

describe('AgNO3 portion: 2.5 mL by default (the experiment 1 level), overridable', () => {
  it('is 2.5 mL by default; the flag and the URL parameter clamp to 0.5 to 3.9 mL and only AgNO3 is affected', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    expect(seedMl('agno3')).toBe(2.5); expect(seedMl('nacl')).toBe(1);
    vi.stubGlobal('window', { location: { search: '' }, __silverAgnoMl: 3.5 }); expect(seedMl('agno3')).toBe(3.5); expect(seedMl('bacl2')).toBe(2.5);
    vi.stubGlobal('window', { location: { search: '?agnoMl=9' } }); expect(seedMl('agno3')).toBeCloseTo(MAX_AGNO_REVIEW_ML, 12);
    vi.stubGlobal('window', { location: { search: '?agnoMl=0.1' } }); expect(seedMl('agno3')).toBe(0.5);
    vi.stubGlobal('window', { location: { search: '' }, __silverAgnoMl: 'x' }); expect(seedMl('agno3')).toBe(2.5);
  });
  it('scales the live AgNO3 pour: a 1 mL pour in 20 steps adds 2.5 mL by default (experiment 1 level), 1 mL with __silverAgnoMl=1, 3.9 mL at the cap', async () => {
    const { deliver } = await import('../../../src/scenes/laboratory/lib/tubeAmounts');
    for (const [flag, expected] of [[undefined, 2.5], [1, 1], [3.9, 3.9], [10.9, 3.9]] as const) {
      resetTubeAmounts();
      vi.stubGlobal('window', { location: { search: '' }, ...(flag !== undefined ? { __silverAgnoMl: flag } : {}) });
      let admitted = 0; for (let k = 0; k < 20; k++) admitted += deliver(tubeId, 'agno3', 0.05);
      expect(admitted).toBeCloseTo(expected, 9); expect(tubeAmount(tubeId).volumeMl).toBeCloseTo(expected, 9);
      expect(tubeAmount(tubeId).species['Ag+']).toBeCloseTo(1.15 * expected, 9);
      // NaCl is never scaled.
      expect(deliver(tubeId, 'nacl', 0.05)).toBeCloseTo(0.05, 12);
    }
  });
  it('seeds the volume only (species amounts unchanged) and the standard 1 mL pour still fits and reacts at 3.9 mL', () => {
    vi.stubGlobal('window', { location: { search: '' }, __silverAgnoMl: 3.9 });
    useLaboratoryStore.setState({ selectedExperimentId: 'experiment-silver-nitrate-sodium-chloride' });
    useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: ['agno3'] }], fumeHoodTestTubes: [] });
    seedTubeAmounts(tubeId, ['agno3']);
    expect(tubeAmount(tubeId).volumeMl).toBeCloseTo(3.9, 12);
    expect(tubeAmount(tubeId).species['Ag+']).toBeCloseTo(1.15, 12);
    let previous = 0, step = 0;
    for (let atMs = 0; atMs <= 4000; atMs += 50) {
      const total = pouredMl(Math.min(1, atMs / 1700)), ml = total - previous;
      if (atMs <= 1700 && ml > 1e-12) {
        previous = total;
        const y = tubeLiquidHeight(tubeAmount(tubeId).volumeMl, tubeEffectiveRadius(0.055));
        const e = publishDeliveryEvent({ tubeId, reagentId: 'nacl', sourceId: 'bottle', serial: 1000, step: ++step, ml, requestedMl: ml,
          point: { x: 0.0065, y, z: 0 }, surfaceY: y, atMs }, { axis: { x: 0, y, z: 0 }, radius: 0.007, surfaceY: y, hasLiquid: true },
        new THREE.Vector3(0, -1, 0), 1);
        expect(e.valid).toBe(true);
      }
      silverRuntime.tick(1000 + atMs);
      silverRuntime.field(tubeId)?.assertMassInvariant();
    }
    const f = silverRuntime.field(tubeId)!;
    expect(tubeAmount(tubeId).volumeMl).toBeCloseTo(4.9, 9);
    expect(f.delivered).toBeCloseTo(1, 9);
    expect(f.extent).toBeGreaterThan(0.1);
    expect(Math.abs(f.species['Cl-'].total + f.extent - f.delivered)).toBeLessThan(1e-9);
  }, 120000);
});
