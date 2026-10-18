import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDeliveries } from '../../../src/scenes/laboratory/lib/tubeDelivery';
import { resetTubeAmounts, seedTubeAmounts, tubeAmount } from '../../../src/scenes/laboratory/lib/tubeAmounts';
import { clearTubePourImpact, publishDeliveryEvent, pouredMl, pourFlowMlPerSecond } from '../../../src/scenes/laboratory/lib/tubePourImpact';
import { silverRuntime } from '../../../src/scenes/laboratory/lib/tubeSilverRuntime';
import { useReagentStorageStore } from '../../../src/scenes/laboratory/lib/useReagentStorageStore';
import { useTestTubeStorageStore } from '../../../src/scenes/laboratory/lib/useTestTubeStorageStore';
import { CLAMP_TUBE_MOUTH, useStandMotionStore } from '../../../src/scenes/laboratory/lib/useStandMotionStore';
import { useLaboratoryStore } from '../../../src/stores/laboratory/useLaboratoryStore';
import { tubeLiquidHeight, tubeEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';

// The experimental stream (window.__silverStream) through the real delivery path and the real runtime.
const tubeId = 'stream-runtime-tube', EXP2 = 'experiment-silver-nitrate-sodium-chloride', SERIAL = 1000, POUR_MS = 1700;
const surface = () => tubeLiquidHeight(tubeAmount(tubeId).volumeMl, tubeEffectiveRadius(0.055));
function deliver(atMs: number, ml: number, point = { x: 0.0065, z: 0 }, reagentId = 'nacl') {
  const y = surface();
  return publishDeliveryEvent({ tubeId, reagentId, sourceId: 'bottle', serial: SERIAL, step: atMs, ml, requestedMl: ml,
    point: { x: point.x, y, z: point.z }, surfaceY: y, atMs, sourceMouth: { x: 0, y: 0.15, z: 0 } },
  { axis: { x: 0, y, z: 0 }, radius: 0.007, surfaceY: y, hasLiquid: tubeAmount(tubeId).volumeMl > 0 },
  new THREE.Vector3(0, -1, 0), pourFlowMlPerSecond(atMs / POUR_MS));
}
function setup(experiment: string | null, contents: string[]) {
  useLaboratoryStore.setState({ selectedExperimentId: experiment });
  useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: [...contents] }], fumeHoodTestTubes: [] });
  seedTubeAmounts(tubeId, contents);
}
beforeEach(() => {
  vi.stubGlobal('window', { location: { search: '' } });
  (globalThis as { __silverStream?: unknown }).__silverStream = true;
  clearDeliveries(); resetTubeAmounts(); clearTubePourImpact(tubeId);
  useReagentStorageStore.setState({ sourceMl: {}, debitedEvents: new Set() });
  useStandMotionStore.setState({ pour: null, busyUntil: 0, simulationPaused: false });
  CLAMP_TUBE_MOUTH.root.identity(); CLAMP_TUBE_MOUTH.point.set(0, 0.15, 0);
});
afterEach(() => {
  silverRuntime.reset(); vi.unstubAllGlobals(); delete (globalThis as { __silverStream?: unknown }).__silverStream;
  useLaboratoryStore.setState({ selectedExperimentId: null });
});

describe('physical stream through the real delivery path', () => {
  it('no chemistry before the impact, ledger equals gain and source loss, mass conserved, nothing in air or glass', () => {
    setup(EXP2, ['agno3']);
    const bottleBefore = useReagentStorageStore.getState().sourceVolume('bottle', 'nacl');
    // A stream that misses the liquid: debited from the source, delivers nothing, starts no chemistry.
    const miss = deliver(300, 0.05, { x: 0.02, z: 0 });
    expect(miss.valid).toBe(false);
    expect(silverRuntime.field(tubeId)).toBeUndefined();
    expect(tubeAmount(tubeId).volumeMl).toBe(2.5);
    expect(tubeAmount(tubeId).species['Cl-'] ?? 0).toBe(0);
    const missLoss = bottleBefore - useReagentStorageStore.getState().sourceVolume('bottle', 'nacl');
    let previous = 0, valid = 0, penetration = 0, sawStream = false, step = 0;
    for (let atMs = 0; atMs <= 6000; atMs += 50) {
      const total = pouredMl(Math.min(1, atMs / POUR_MS)), ml = total - previous;
      if (atMs <= POUR_MS && ml > 1e-12) {
        previous = total;
        const e = deliver(atMs + 1 + (step++ % 1), ml);          // distinct (serial, step) per event
        if (e.valid) valid++;
        // Nothing chemical exists before the first valid impact.
        if (valid === 0) expect(silverRuntime.field(tubeId)).toBeUndefined();
      }
      silverRuntime.tick(SERIAL + atMs);
      const f = silverRuntime.field(tubeId);
      if (!f) continue;
      f.assertMassInvariant();
      if (f.streamModel?.active) { sawStream = true; penetration = Math.max(penetration, f.streamModel.penetration); }
      const m = f.mask;
      for (let i = 0; i < m.data.length; i++) if (!m.data[i]) {
        expect(f.species['Ag+'].values[i]).toBe(0); expect(f.species['Cl-'].values[i]).toBe(0);
        expect(f.suspension[0][i]).toBe(0); expect(f.tracer[i]).toBe(0);
      }
    }
    const f = silverRuntime.field(tubeId)!;
    const gain = tubeAmount(tubeId).volumeMl - 2.5, sourceLoss = bottleBefore - useReagentStorageStore.getState().sourceVolume('bottle', 'nacl');
    expect(valid).toBeGreaterThan(5);
    // The 1 mL bottle lost 0.05 mL to the miss, so only the rest can arrive (the source limits the delivery).
    expect(gain).toBeCloseTo(bottleBefore - missLoss, 9);              // delivered = receiving gain = what the source still had
    expect(f.delivered).toBeCloseTo(gain, 9);
    expect(sourceLoss - missLoss).toBeCloseTo(gain, 9);               // the source lost exactly what arrived (plus the miss)
    expect(sawStream).toBe(true);
    expect(penetration).toBeGreaterThan(0.005);
    expect(Math.abs(f.species['Ag+'].total + f.extent - f.silverAmount)).toBeLessThan(1e-9);
    expect(Math.abs(f.species['Cl-'].total + f.extent - f.delivered)).toBeLessThan(1e-9);
    expect(f.extent).toBeLessThanOrEqual(gain + 1e-9);
  }, 120000);

  it('the opposite reagent order and the sandbox never start a silver field, with the flag on', () => {
    for (const [experiment, contents] of [[EXP2, ['nacl']], [null, ['nacl']], [null, []]] as const) {
      silverRuntime.reset(); clearDeliveries(); resetTubeAmounts(); setup(experiment, [...contents]);
      for (let atMs = 100; atMs <= 800; atMs += 50) { deliver(atMs, 0.05); silverRuntime.tick(SERIAL + atMs); }
      expect(silverRuntime.field(tubeId)).toBeUndefined();
      expect(tubeAmount(tubeId).species['Ag+'] ?? 0).toBe(0);
    }
  });

  it('the legacy jet flag and the stream flag stay independent: the stream flag alone leaves __silverJetModel off', () => {
    expect((globalThis as { __silverJetModel?: unknown }).__silverJetModel).toBeUndefined();
    expect((globalThis as { __silverStream?: unknown }).__silverStream).toBe(true);
  });
});
