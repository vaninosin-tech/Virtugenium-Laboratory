import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SILVER_STAGE, resolveSilverAggregation, resolveSilverStage, silverAggregationEnabled, silverStage }
  from "../../../src/scenes/laboratory/lib/silverStage";
import { clearDeliveries, type DeliveryEvent } from "../../../src/scenes/laboratory/lib/tubeDelivery";
import { resetTubeAmounts, seedTubeAmounts, tubeAmount } from "../../../src/scenes/laboratory/lib/tubeAmounts";
import { silverRuntime } from "../../../src/scenes/laboratory/lib/tubeSilverRuntime";
import { useTestTubeStorageStore } from "../../../src/scenes/laboratory/lib/useTestTubeStorageStore";
import { useLaboratoryStore } from "../../../src/stores/laboratory/useLaboratoryStore";
import { tubeLiquidHeight, tubeEffectiveRadius } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";

// Stable baseline for the hand-in: stage 3 with the fine suspension, aggregation code kept but off.
describe("silver stage and aggregation defaults", () => {
  it("defaults to stage 3 and keeps every override", () => {
    expect(DEFAULT_SILVER_STAGE).toBe(3);
    expect(resolveSilverStage("", undefined)).toBe(3);
    expect(resolveSilverStage("", 1)).toBe(1);
    expect(resolveSilverStage("?silverStage=1", 3)).toBe(1);
    expect(resolveSilverStage("?silverStage=3", 1)).toBe(3);
    expect(resolveSilverStage("?silverStage=0", undefined)).toBe(3);
  });
  it("keeps aggregation off unless asked, and the old flag semantics for 0 and 1", () => {
    expect(resolveSilverAggregation("", undefined)).toBe(false);
    expect(resolveSilverAggregation("", 0)).toBe(false);
    expect(resolveSilverAggregation("", 1)).toBe(true);
    expect(resolveSilverAggregation("?silverAgg=1", undefined)).toBe(true);
    expect(resolveSilverAggregation("?silverAgg=0", 1)).toBe(false);
    expect(resolveSilverAggregation("?silverAgg=", 1)).toBe(true);
  });
  it("the page defaults come out as stage 3 without aggregation", () => {
    vi.stubGlobal("window", { location: { search: "" } });
    try { expect(silverStage()).toBe(3); expect(silverAggregationEnabled()).toBe(false); }
    finally { vi.unstubAllGlobals(); }
  });
});

const tubeId = "default-stage-tube";
const surface = () => tubeLiquidHeight(tubeAmount(tubeId).volumeMl, tubeEffectiveRadius(0.055));
const nacl = (): DeliveryEvent => ({ tubeId, reagentId: "nacl", serial: 1, step: 1, ml: 0.1, requestedMl: 0.1,
  point: { x: 0, y: surface(), z: 0 }, surfaceY: surface(), atMs: 1, valid: true, reason: "ok" });

describe("default stage 3 does not reach the other experiments", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } });
    clearDeliveries(); resetTubeAmounts();
  });
  afterEach(() => { silverRuntime.reset(); vi.unstubAllGlobals(); useLaboratoryStore.setState({ selectedExperimentId: null }); });

  for (const [experiment, contents] of [
    ["experiment-copper-nitric-acid", ["cu"]],
    ["experiment-barium-chloride-potassium-sulfate", ["bacl2"]],
    ["experiment-redox-permanganate-sulfite", ["na2so3"]],
  ] as const) {
    it(`refuses chloride and builds no silver field in ${experiment}`, () => {
      useLaboratoryStore.setState({ selectedExperimentId: experiment });
      useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: [...contents] }], fumeHoodTestTubes: [] });
      seedTubeAmounts(tubeId, [...contents]);
      const before = tubeAmount(tubeId).volumeMl;
      expect(silverRuntime.canApply(nacl())).toBe(false);
      expect(silverRuntime.applyDelivery(nacl())).toBe(false);
      expect(silverRuntime.field(tubeId)).toBeUndefined();
      expect(tubeAmount(tubeId).volumeMl).toBe(before);
      expect(useTestTubeStorageStore.getState().workbenchTestTubes[0].contents).toEqual([...contents]);
    });
  }

  it("the intended experiment 2 still creates the field on the first valid impact", () => {
    useLaboratoryStore.setState({ selectedExperimentId: "experiment-silver-nitrate-sodium-chloride" });
    useTestTubeStorageStore.setState({ workbenchTestTubes: [{ instanceId: tubeId, contents: ["agno3"] }], fumeHoodTestTubes: [] });
    seedTubeAmounts(tubeId, ["agno3"]);
    expect(silverRuntime.applyDelivery(nacl())).toBe(true);
    expect(silverRuntime.field(tubeId)?.flocMode).toBe(true);
    expect(silverRuntime.field(tubeId)?.silverAmount).toBe(1.15);
  });
});

describe("the default equals the explicit fine-suspension baseline (__silverAgg = 0)", () => {
  type Fields = { advance(dt: number, up: THREE.Vector3, level: number, inlet: THREE.Vector3, rate: number): void;
    extent: number; delivered: number; massBalanceError: number; suspension: Float32Array[]; silverAmount: number; dispose(): void };
  async function run(agg: number | undefined) {
    vi.stubGlobal("window", { location: { search: "" } });
    if (agg === undefined) delete (globalThis as { __silverAgg?: number }).__silverAgg;
    else (globalThis as { __silverAgg?: number }).__silverAgg = agg;
    const { TubeSilverField } = await import("../../../src/scenes/laboratory/lib/tubeSilverField");
    const f = new TubeSilverField("LOW", 0.007, 0, 0.11) as unknown as Fields;
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
    for (let k = 0; k < 60; k++) {
      const delivered = Math.min(1, (k + 1) * 0.04), level = 0.0087 + 0.026 * delivered;
      inlet.y = level - 0.001;
      f.advance(0.05, up, level, inlet, delivered - Math.min(1, k * 0.04));
    }
    const out = { extent: f.extent, error: f.massBalanceError, silver: f.silverAmount,
      sum: f.suspension[0].reduce((a, b) => a + b, 0) };
    f.dispose(); vi.unstubAllGlobals(); delete (globalThis as { __silverAgg?: number }).__silverAgg;
    return out;
  }
  it("is bit-identical to __silverAgg = 0 and differs from the aggregation run", async () => {
    const byDefault = await run(undefined), explicitOff = await run(0), on = await run(1);
    expect(byDefault).toEqual(explicitOff);
    expect(byDefault.silver).toBe(1.15);
    expect(on.silver).toBe(1);
    expect(Math.abs(byDefault.error)).toBeLessThan(1e-12);
  });
});
