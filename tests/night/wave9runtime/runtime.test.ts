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

describe("stage 3 simulation runtime", () => {
  it("commits contents, amount and field on the first valid impact", () => {
    const e = event(500);
    expect(silverRuntime.applyDelivery(e)).toBe(true);
    const d = silverRuntime.diagnostics(tubeId)!;
    expect([d.firstValidImpactMs, d.firstCompositionUpdateMs, d.firstFieldInitMs,
      d.firstChlorideInsertionMs]).toEqual([500, 500, 500, 500]);
    expect(useTestTubeStorageStore.getState().workbenchTestTubes[0].contents).toEqual(["agno3", "nacl"]);
    expect(tubeAmount(tubeId).volumeMl).toBeCloseTo(2.6, 12);
    expect(silverRuntime.field(tubeId)?.delivered).toBeCloseTo(0.1, 12);
    expect(silverRuntime.applyDelivery(e)).toBe(false);
    expect(tubeAmount(tubeId).volumeMl).toBeCloseTo(2.6, 12);
    expect(silverRuntime.journal(tubeId)).toEqual(["100|500"]);
  });

  it("keeps the same field across remount and does not reapply an event", () => {
    const e = event(500);
    silverRuntime.applyDelivery(e);
    const field = silverRuntime.field(tubeId);
    expect(silverRuntime.field(tubeId)).toBe(field);
    expect(silverRuntime.applyDelivery(e)).toBe(false);
    expect(silverRuntime.field(tubeId)).toBe(field);
  });

  it("tracks receiving levels at 1, 2.5 and 4 mL", () => {
    const levels: number[] = [];
    for (const [index, ml] of [1, 2.5, 4].entries()) {
      const id = `level-${index}`;
      seedTubeAmounts(id, ml === 1 ? ["nacl"] : ["agno3"]);
      if (ml !== 2.5) tubeAmount(id).volumeMl = ml;
      const s = tubeLiquidHeight(tubeAmount(id).volumeMl, tubeEffectiveRadius(0.055));
      levels.push(s);
    }
    expect(levels[0]).toBeLessThan(levels[1]);
    expect(levels[1]).toBeLessThan(levels[2]);
  });

  it("conserves chloride and reaction mass through fixed steps", () => {
    for (let i = 0; i < 5; i++) {
      expect(silverRuntime.applyDelivery(event(500 + i * 50, 0.1))).toBe(true);
      silverRuntime.tick(650 + i * 50);
      const field = silverRuntime.field(tubeId)!;
      expect(Math.abs(field.massBalanceError)).toBeLessThan(1e-9);
      expect(Math.abs(field.species["Cl-"].total + field.extent - field.delivered)).toBeLessThan(1e-9);
    }
  });

  it("stops after source exhaustion and never debits one event twice", () => {
    const source = useReagentStorageStore.getState();
    expect(source.debitSource("bottle", "nacl", "1|1", 0.7)).toBeCloseTo(0.7);
    expect(source.debitSource("bottle", "nacl", "1|1", 0.7)).toBe(0);
    expect(source.debitSource("bottle", "nacl", "1|2", 0.7)).toBeCloseTo(0.3);
    expect(source.sourceVolume("bottle", "nacl")).toBe(0);
    expect(source.debitSource("bottle", "nacl", "1|3", 0.1)).toBe(0);
  });

  it("debits a miss once and never changes the receiving tube", () => {
    const point = { x: 0.01, y: surface(), z: 0 };
    const input = { ...event(500), sourceId: "bottle", point };
    const context = { axis: { x: 0, y: surface(), z: 0 }, radius: 0.007,
      surfaceY: surface(), hasLiquid: true };
    const direction = new THREE.Vector3(0, -1, 0);
    expect(publishDeliveryEvent(input, context, direction, 1).valid).toBe(false);
    expect(publishDeliveryEvent(input, context, direction, 1).valid).toBe(false);
    expect(useReagentStorageStore.getState().sourceVolume("bottle", "nacl")).toBeCloseTo(0.9);
    expect(tubeAmount(tubeId).volumeMl).toBe(2.5);
    expect(silverRuntime.field(tubeId)).toBeUndefined();
    expect(useTestTubeStorageStore.getState().workbenchTestTubes[0].contents).toEqual(["agno3"]);
    expect(deliveryEvents(tubeId)).toHaveLength(1);
  });

  it("continues the pour with no render and freezes it while simulation is paused", () => {
    const at = simNowMs();
    useStandMotionStore.getState().startPour("bottle", () => {}, undefined, "clamp", (serial, now) => {
      stepTubePour({ tubeId, reagentId: "nacl", serial, now,
        mouth: CLAMP_TUBE_MOUTH.point, root: CLAMP_TUBE_MOUTH.root,
        side: new THREE.Vector3(1, 0, 0), mouthValid: true });
    });
    vi.advanceTimersByTime(800);
    const before = tubeAmount(tubeId).volumeMl;
    expect(before).toBeGreaterThan(2.5);
    setSimulationPaused(true);
    const paused = simNowMs();
    vi.advanceTimersByTime(1000);
    expect(simNowMs()).toBe(paused);
    expect(tubeAmount(tubeId).volumeMl).toBe(before);
    setSimulationPaused(false);
    vi.advanceTimersByTime(900);
    expect(tubeAmount(tubeId).volumeMl).toBeCloseTo(3.5, 9);
    expect(simNowMs()).toBeGreaterThan(at);
  });
});
