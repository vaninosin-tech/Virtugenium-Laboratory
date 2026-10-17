import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { clearDeliveries, deliveryEvents, type DeliveryEvent } from "../../../src/scenes/laboratory/lib/tubeDelivery";
import { clearTubePourImpact, publishDeliveryEvent, stepTubePour } from "../../../src/scenes/laboratory/lib/tubePourImpact";
import { resetTubeAmounts, seedTubeAmounts, tubeAmount } from "../../../src/scenes/laboratory/lib/tubeAmounts";
import { silverRuntime } from "../../../src/scenes/laboratory/lib/tubeSilverRuntime";
import { CLAMP_TUBE_MOUTH, setSimulationPaused, simNowMs, useStandMotionStore } from "../../../src/scenes/laboratory/lib/useStandMotionStore";
import { useReagentStorageStore } from "../../../src/scenes/laboratory/lib/useReagentStorageStore";
import { useTestTubeStorageStore } from "../../../src/scenes/laboratory/lib/useTestTubeStorageStore";
import { tubeLiquidHeight, tubeEffectiveRadius } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";

const tubeId = "stage3-tube";
const surface = () => tubeLiquidHeight(tubeAmount(tubeId).volumeMl, tubeEffectiveRadius(0.055));
const event = (step: number, ml = 0.1): DeliveryEvent => ({ tubeId, reagentId: "nacl",
  serial: 100, step, ml, requestedMl: ml, point: { x: 0, y: surface(), z: 0 },
  surfaceY: surface(), atMs: step, valid: true, reason: "ok" });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  vi.stubGlobal("window", { __silverStage: 3, location: { search: "" } });
  clearDeliveries(); resetTubeAmounts(); clearTubePourImpact(tubeId);
  useReagentStorageStore.setState({ sourceMl: {}, debitedEvents: new Set() });
  useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: ["agno3"] }],
    fumeHoodTestTubes: [] });
  useStandMotionStore.setState({ pour: null, busyUntil: 0, simulationPaused: false });
  CLAMP_TUBE_MOUTH.root.identity(); CLAMP_TUBE_MOUTH.point.set(0, 0.15, 0);
  CLAMP_TUBE_MOUTH.rod.set(-1, 0, 0); CLAMP_TUBE_MOUTH.valid = true;
  seedTubeAmounts(tubeId, ["agno3"]);
});
afterEach(() => { setSimulationPaused(false); silverRuntime.reset(); vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });


const centroid = (id: string) => {
  const f = silverRuntime.field(id)!; const m = f.mask; let sx = 0, sz = 0, sum = 0, ymax = -1;
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], v = f.tracer[i]; if (v <= 0) continue;
    const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
    const p = m.point(x, y, z); sx += p.x * v; sz += p.z * v; sum += v; ymax = Math.max(ymax, y);
  }
  return { x: sx / sum, z: sz / sum, sum, topRow: ymax };
};

describe("impact position drives the first tracer position", () => {
  it("moves the initial tracer source with the ledger impact point and keeps it at the free surface", () => {
    const results: { at: number; x: number; z: number; sum: number; top: number; wet: number }[] = [];
    for (const [k, px] of [[0, -0.004], [1, 0], [2, 0.004]] as const) {
      const id = "pos-" + k;
      useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: id, contents: ["agno3"] }], fumeHoodTestTubes: [] });
      seedTubeAmounts(id, ["agno3"]);
      const y = tubeLiquidHeight(tubeAmount(id).volumeMl, tubeEffectiveRadius(0.055));
      const e: DeliveryEvent = { tubeId: id, reagentId: "nacl", serial: 7 + k, step: 100, ml: 0.1, requestedMl: 0.1,
        point: { x: px, y, z: 0 }, surfaceY: y, atMs: 100, valid: true, reason: "ok" };
      expect(silverRuntime.applyDelivery(e)).toBe(true);
      const c = centroid(id); const m = silverRuntime.field(id)!.mask;
      let wet = -1; for (let a = 0; a < m.activeCount; a++) wet = Math.max(wet, Math.floor(m.active[a] / m.nx) % m.ny);
      results.push({ at: px, x: c.x, z: c.z, sum: c.sum, top: c.topRow, wet });
    }
    // monotonic with the impact, within a cell of it, symmetric, never above the wet top row, mass equals the delivered fraction
    expect(results[0].x).toBeLessThan(results[1].x);
    expect(results[1].x).toBeLessThan(results[2].x);
    for (const r of results) { expect(Math.abs(r.x - r.at)).toBeLessThan(0.0025); expect(Math.abs(r.z)).toBeLessThan(0.0025);
      expect(r.top).toBeLessThanOrEqual(r.wet); expect(r.sum).toBeGreaterThan(0); }
    expect(results[0].x + results[2].x).toBeCloseTo(2 * results[1].x, 3);
  });
});

describe("mass accounting while pouring", () => {
  it("applied = inserted + pending, inserted = tracer = Cl- + product at every tick, pending stays within one fixed step", () => {
    const id = "mass-tube";
    useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: id, contents: ["agno3"] }], fumeHoodTestTubes: [] });
    seedTubeAmounts(id, ["agno3"]);
    const serial = simNowMs();
    const initialMl = tubeAmount(id).volumeMl;
    const per = 0.02, ticks = 50;           // 1 mL in 50 events, one per 25 ms simulation tick (0.8 mL/s)
    let applied = 0, maxPending = 0, worst = 0;
    for (let k = 0; k < ticks; k++) {
      vi.advanceTimersByTime(25);
      const y = tubeLiquidHeight(tubeAmount(id).volumeMl, tubeEffectiveRadius(0.055));
      const e: DeliveryEvent = { tubeId: id, reagentId: "nacl", serial, step: 25 * (k + 1), ml: per, requestedMl: per,
        point: { x: 0, y, z: 0 }, surfaceY: y, atMs: 25 * (k + 1), valid: true, reason: "ok" };
      expect(silverRuntime.applyDelivery(e)).toBe(true); applied += per;
      silverRuntime.tick(simNowMs());
      const f = silverRuntime.field(id)!; const m = f.mask; let tracer = 0;
      for (let a = 0; a < m.activeCount; a++) tracer += f.tracer[m.active[a]];
      const cl = f.species["Cl-"].total + f.extent;
      const pending = applied - f.delivered; maxPending = Math.max(maxPending, pending);
      worst = Math.max(worst, Math.abs(tracer - f.delivered), Math.abs(cl - f.delivered));
      expect(pending).toBeGreaterThanOrEqual(-1e-12);
      expect(tubeAmount(id).volumeMl).toBeCloseTo(initialMl + applied, 9);
    }
    vi.advanceTimersByTime(100); silverRuntime.tick(simNowMs());
    const f = silverRuntime.field(id)!;
    expect(worst).toBeLessThan(1e-12);
    expect(maxPending).toBeLessThanOrEqual(per * 4 + 1e-12);   // at most about two ticks of flow wait for the next 50 ms step
    expect(f.delivered).toBeCloseTo(applied, 9);
  });
});
