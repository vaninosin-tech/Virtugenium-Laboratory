import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { clearDeliveries } from '../../../src/scenes/laboratory/lib/tubeDelivery';
import { resetTubeAmounts, seedTubeAmounts, tubeAmount } from '../../../src/scenes/laboratory/lib/tubeAmounts';
import { clearTubePourImpact, publishDeliveryEvent } from '../../../src/scenes/laboratory/lib/tubePourImpact';
import { silverRuntime } from '../../../src/scenes/laboratory/lib/tubeSilverRuntime';
import { useReagentStorageStore } from '../../../src/scenes/laboratory/lib/useReagentStorageStore';
import { useTestTubeStorageStore } from '../../../src/scenes/laboratory/lib/useTestTubeStorageStore';
import { useLaboratoryStore } from '../../../src/stores/laboratory/useLaboratoryStore';
import { tubeLiquidHeight, tubeEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';

// The browser default is stage 3 (no override). The silver reaction may start only from silver nitrate that is
// really in the receiving tube and a chloride delivery event into that same tube.
const tubeId = 'isolation-tube', EXP2 = 'experiment-silver-nitrate-sodium-chloride';
let serial = 0;
function pour(reagentId: string, ml = 0.1) {
  const surface = tubeLiquidHeight(tubeAmount(tubeId).volumeMl, tubeEffectiveRadius(0.055));
  return publishDeliveryEvent({ tubeId, reagentId, serial: ++serial, step: 1, ml, requestedMl: ml,
    point: { x: 0.0065, y: surface, z: 0 }, surfaceY: surface, atMs: 100 },
  { axis: { x: 0, y: surface, z: 0 }, radius: 0.007, surfaceY: surface, hasLiquid: tubeAmount(tubeId).volumeMl > 0 },
  new THREE.Vector3(0, -1, 0), 1);
}
const contents = () => useTestTubeStorageStore.getState().workbenchTestTubes[0].contents;
function setup(experiment: string | null, initial: string[]) {
  useLaboratoryStore.setState({ selectedExperimentId: experiment });
  useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: [...initial] }], fumeHoodTestTubes: [] });
  seedTubeAmounts(tubeId, initial);
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { search: '' } });
  clearDeliveries(); resetTubeAmounts(); clearTubePourImpact(tubeId); serial = 0;
  useReagentStorageStore.setState({ sourceMl: {}, debitedEvents: new Set() });
});
afterEach(() => { silverRuntime.reset(); vi.unstubAllGlobals(); useLaboratoryStore.setState({ selectedExperimentId: null }); });

describe('silver stage 3 (browser default) starts only from real reactants in the receiving tube', () => {
  it('experiment 2, AgNO3 in the tube, NaCl poured afterwards: the stage-3 field starts', () => {
    setup(EXP2, ['agno3']);
    expect(pour('nacl').valid).toBe(true);
    expect(silverRuntime.field(tubeId)).toBeDefined();
    expect(contents()).toEqual(['agno3', 'nacl']);
  });

  it('experiment 2, NaCl in the tube first, AgNO3 added afterwards: no stage-3 field, both amounts are kept', () => {
    setup(EXP2, ['nacl']);
    const volume = tubeAmount(tubeId).volumeMl;
    expect(pour('nacl', 0.1).valid).toBe(true);         // more chloride into chloride: plain ledger path
    expect(silverRuntime.field(tubeId)).toBeUndefined();
    expect(tubeAmount(tubeId).volumeMl).toBeCloseTo(volume + 0.1, 12);
    expect(pour('agno3', 0.5).valid).toBe(true);
    expect(silverRuntime.field(tubeId)).toBeUndefined();
    expect(tubeAmount(tubeId).species['Ag+']).toBeGreaterThan(0);
  });

  it('chloride poured into a tube without silver nitrate never creates Ag+ or a field (sandbox and experiment 2)', () => {
    for (const experiment of [null, EXP2]) {
      silverRuntime.reset(); clearDeliveries(); resetTubeAmounts(); serial = 0;
      setup(experiment, ['nacl']);
      expect(pour('nacl').valid).toBe(true);
      expect(silverRuntime.field(tubeId)).toBeUndefined();
      expect(tubeAmount(tubeId).species['Ag+'] ?? 0).toBe(0);
      expect(silverRuntime.acceptsChloride(tubeId)).toBe(false);
    }
  });

  it('chloride into an empty tube is refused (no liquid), not turned into a field', () => {
    setup(null, []);
    const event = pour('nacl');
    expect(event.valid).toBe(false);
    expect(silverRuntime.field(tubeId)).toBeUndefined();
  });

  it('free sandbox with both reagents: silver nitrate first and chloride delivered gives the field', () => {
    setup(null, ['agno3']);
    expect(pour('nacl').valid).toBe(true);
    expect(silverRuntime.field(tubeId)).toBeDefined();
  });

  it('free sandbox tube pre-filled with both reagents: chloride is not seeded, so nothing is invented', () => {
    setup(null, ['agno3', 'nacl']);
    expect(silverRuntime.field(tubeId)).toBeUndefined();
    expect(tubeAmount(tubeId).species['Cl-'] ?? 0).toBe(0);
  });

  it('experiments 1, 3 and 4 refuse chloride delivery and keep their contents', () => {
    for (const [experiment, initial] of [['experiment-copper-nitric-acid', ['cu']],
      ['experiment-barium-chloride-potassium-sulfate', ['bacl2']],
      ['experiment-redox-permanganate-sulfite', ['na2so3']]] as const) {
      silverRuntime.reset(); clearDeliveries(); resetTubeAmounts(); serial = 0;
      setup(experiment, [...initial]);
      pour('nacl');
      expect(silverRuntime.field(tubeId)).toBeUndefined();
      expect(contents()).toEqual([...initial]);
    }
  });

  it('explicit stage overrides are kept: ?silverStage=1 and window.__silverStage = 1 keep the legacy path', () => {
    for (const win of [{ location: { search: '?silverStage=1' } }, { __silverStage: 1, location: { search: '' } }]) {
      vi.stubGlobal('window', win);
      silverRuntime.reset(); clearDeliveries(); resetTubeAmounts(); serial = 0;
      setup(EXP2, ['agno3']);
      expect(pour('nacl').valid).toBe(true);
      expect(silverRuntime.field(tubeId)).toBeUndefined();
      expect(tubeAmount(tubeId).species['Cl-']).toBeGreaterThan(0);
    }
  });
});
