import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { clearDeliveries, deliveredMl, deliveryEvents, firstValidDelivery,
  recordDelivery, validateImpact } from "../../../src/scenes/laboratory/lib/tubeDelivery";
import { resetTubeAmounts, seedTubeAmounts, STANDARD_POUR_ML,
  tubeAmount } from "../../../src/scenes/laboratory/lib/tubeAmounts";
import { clearTubePourImpact, observePourClock, publishTubePourImpact,
  stepTubePour, tubePourImpact } from "../../../src/scenes/laboratory/lib/tubePourImpact";
import { tubeEffectiveRadius, tubeLiquidHeight } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";
import { POUR_MS, useStandMotionStore } from "../../../src/scenes/laboratory/lib/useStandMotionStore";

const origin = new THREE.Vector3(0, 0.15, 0);
const root = new THREE.Matrix4();
const step = (tubeId: string, serial: number, elapsed: number, overrides: object = {}) =>
  stepTubePour({ tubeId, reagentId: "nacl", serial, now: serial + elapsed,
    mouth: origin, root, side: new THREE.Vector3(1, 0, 0), mouthValid: true, ...overrides });

beforeEach(() => {
  clearDeliveries(); resetTubeAmounts(); root.identity();
  useStandMotionStore.setState({ pour: null, busyUntil: 0 });
  for (const id of ["tube", "miss", "empty", "duplicate", "stop", "full", "level"])
    clearTubePourImpact(id);
});

describe("validated delivery", () => {
  it("classifies impact, miss, above surface and dry tube", () => {
    const context = { axis: { x: 0, y: 0.055, z: 0 }, radius: 0.007,
      surfaceY: 0.055, hasLiquid: true };
    expect(validateImpact({ x: 0.0065, y: 0.055, z: 0 }, context).reason).toBe("ok");
    expect(validateImpact({ x: 0.008, y: 0.055, z: 0 }, context).reason).toBe("outside-tube");
    expect(validateImpact({ x: 0, y: 0.06, z: 0 }, context).reason).toBe("above-surface");
    expect(validateImpact({ x: 0, y: 0.055, z: 0 }, { ...context, hasLiquid: false }).reason).toBe("no-liquid");
    const invalid = recordDelivery({ tubeId: "tube", reagentId: "nacl", serial: 1, step: 1,
      ml: 0.2, point: { x: 0.008, y: 0.055, z: 0 }, surfaceY: 0.055, atMs: 1 }, context);
    expect(invalid.valid).toBe(false);
    expect(deliveredMl("tube")).toBe(0);
  });

  it("records misses without adding receiving volume", () => {
    seedTubeAmounts("miss", ["agno3"]);
    const before = tubeAmount("miss").volumeMl;
    const result = step("miss", 1000, POUR_MS, { side: new THREE.Vector3(0, 0, 1), radius: 0.004 });
    expect(result?.reason).toBe("outside-tube");
    expect(result?.requestedMl).toBeCloseTo(STANDARD_POUR_ML);
    expect(tubeAmount("miss").volumeMl).toBe(before);
    expect(tubePourImpact("miss")).toBeUndefined();
    expect(deliveryEvents("miss")).toHaveLength(1);
    expect(step("empty", 2000, POUR_MS)?.reason).toBe("no-liquid");
    expect(tubeAmount("empty").volumeMl).toBe(0);
  });

  it("rejects the permissive legacy publisher for stage-three chloride", () => {
    seedTubeAmounts("tube", ["agno3"]);
    vi.stubGlobal("window", { location: { search: "?silverStage=3" } });
    try {
      expect(publishTubePourImpact("tube", "nacl", new THREE.Vector3(0, 0.055, 0),
        new THREE.Vector3(0, -1, 0), 1, 1, 7000)).toBe(0);
      expect(deliveryEvents("tube")).toHaveLength(0);
      expect(tubeAmount("tube").volumeMl).toBe(2.5);
    } finally { vi.unstubAllGlobals(); }
  });

  it("is idempotent across repeated steps and a new caller after remount", () => {
    seedTubeAmounts("duplicate", ["agno3"]);
    const first = step("duplicate", 3000, 900);
    expect(first?.valid).toBe(true);
    const newSubscriber = () => step("duplicate", 3000, 900);
    expect(newSubscriber()).toBeUndefined();
    expect(deliveryEvents("duplicate")).toHaveLength(1);
    expect(tubeAmount("duplicate").volumeMl - 2.5).toBeCloseTo(first!.ml);
    expect(step("duplicate", 3000, POUR_MS)?.valid).toBe(true);
    expect(deliveredMl("duplicate", "nacl", 3000)).toBeCloseTo(1);
    expect(tubeAmount("duplicate").species["Cl-"]).toBeCloseTo(1);
    const replay = recordDelivery({ tubeId: "other", reagentId: "nacl", serial: 3000,
      step: 900, ml: 1, point: { x: 0, y: 0, z: 0 }, surfaceY: 0, atMs: 900 },
    { axis: { x: 0, y: 0, z: 0 }, radius: 0.007, surfaceY: 0, hasLiquid: true });
    expect(replay.reason).toBe("duplicate");
    expect(deliveredMl("other")).toBe(0);
  });

  it("stops on cleared pour and does not invent a completion step", () => {
    seedTubeAmounts("stop", ["agno3"]);
    vi.useFakeTimers(); vi.setSystemTime(4000);
    const stop = observePourClock("bottle", (serial, now) => { step("stop", serial, now - serial); });
    try {
      useStandMotionStore.getState().startPour("bottle", () => {});
      vi.advanceTimersByTime(850);
      useStandMotionStore.setState({ pour: null });
      const delivered = deliveredMl("stop");
      vi.advanceTimersByTime(POUR_MS);
      expect(delivered).toBeGreaterThan(0);
      expect(delivered).toBeLessThan(1);
      expect(deliveredMl("stop")).toBe(delivered);
      expect(tubeAmount("stop").volumeMl - 2.5).toBeCloseTo(delivered);
    } finally { stop(); vi.clearAllTimers(); vi.useRealTimers(); }
  });

  // "completes from the store clock without a rendered frame" was superseded by tests/night/wave9runtime (simulation clock
  // drives the pour inside the stand store; covered there with the real publisher and the lazily created field).

  it("uses the updated liquid surface for the next event", () => {
    seedTubeAmounts("level", ["agno3"]);
    const a = step("level", 5000, 850)!;
    const b = step("level", 5000, 1000)!;
    expect(b.surfaceY).toBeGreaterThan(a.surfaceY);
    expect(a.surfaceY).toBeCloseTo(tubeLiquidHeight(2.5, tubeEffectiveRadius(0.055)));
    expect(b.surfaceY).toBeCloseTo(tubeLiquidHeight(2.5 + a.ml, tubeEffectiveRadius(0.055)));
    expect(b.point.y).toBeCloseTo(b.surfaceY);
    expect(firstValidDelivery("level", "nacl")).toBe(a);
  });

  it("integrates an entire Date.now pour to exactly one fixed portion", () => {
    seedTubeAmounts("full", ["agno3"]);
    for (let elapsed = 0; elapsed < POUR_MS; elapsed += 30) step("full", 6000, elapsed);
    step("full", 6000, POUR_MS);
    expect(deliveredMl("full")).toBeCloseTo(STANDARD_POUR_ML, 12);
    expect(tubeAmount("full").volumeMl).toBeCloseTo(3.5, 12);
    expect(tubePourImpact("full")?.deliveredMl).toBeCloseTo(STANDARD_POUR_ML, 12);
    expect(deliveryEvents("full").every(e => e.valid)).toBe(true);
  });
});
