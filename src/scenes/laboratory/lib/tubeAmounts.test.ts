import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliver, resetTubeAmounts, seedTubeAmounts, syncBariumExtent,
  syncCopperProgress, syncPermanganateExtent, tubeAmount, tubeVisualFill } from "./tubeAmounts";
import { pouredMl } from "./tubePourImpact";
import { tubeVessel } from "./vesselGeometry";

beforeEach(resetTubeAmounts);

describe("tube amounts", () => {
  it("never seeds stage-three NaCl from a remounted tube's contents", () => {
    vi.stubGlobal("window", { location: { search: "?silverStage=3" } });
    try {
      seedTubeAmounts("silver", ["agno3", "nacl"]);
      seedTubeAmounts("silver", ["agno3", "nacl"]);
      expect(tubeAmount("silver").volumeMl).toBe(2.5);
      expect(tubeAmount("silver").species["Cl-"]).toBeUndefined();
      expect(deliver("silver", "nacl", 1)).toBe(1);
      seedTubeAmounts("silver", ["agno3", "nacl"]);
      expect(tubeAmount("silver").species["Cl-"]).toBe(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps the visual liquid level inside the authored cavity", () => {
    for (const volume of [0, 1, 2.5, 3.5, 4.5, 5, Infinity, NaN]) {
      const fill = tubeVisualFill(volume);
      expect(Number.isFinite(fill)).toBe(true);
      expect(fill).toBeGreaterThanOrEqual(0);
      expect(fill).toBeLessThanOrEqual(1);
    }
    // Wave 14: the visible fill is the liquid height in the real 7 mm bore over the 55 mm authored body, not the 2.5 ml calibration.
    expect(tubeVisualFill(2.5)).toBeCloseTo(tubeVessel.heightFromVolume(2.5) / tubeVessel.cavityHeight, 12);
    expect(tubeVisualFill(3.5)).toBeCloseTo(tubeVessel.heightFromVolume(3.5) / tubeVessel.cavityHeight, 12);
  });
  it("admits one fixed portion progressively and stops at 5 ml", () => {
    seedTubeAmounts("tube", ["bacl2"]);
    let prior = 0;
    for (let i = 1; i <= 100; i++) {
      const total = pouredMl(i / 100);
      deliver("tube", "k2so4", total - prior);
      prior = total;
    }
    expect(tubeAmount("tube").volumeMl).toBeCloseTo(3.5);
    expect(tubeAmount("tube").species["SO4(2-)"]).toBeCloseTo(1);
    expect(deliver("tube", "k2so4", 4)).toBeCloseTo(1.5);
    expect(tubeAmount("tube").volumeMl).toBe(5);
  });

  it("uses acid as the R1 limit and retains 45 percent of copper", () => {
    tubeAmount("cu");
    seedTubeAmounts("cu", []);
    seedTubeAmounts("cu", ["cu"]);
    expect(tubeAmount("cu").volumeMl).toBe(2.5);
    deliver("cu", "hno3", 1);
    seedTubeAmounts("cu", ["cu", "hno3"]);
    expect(tubeAmount("cu").volumeMl).toBe(3.5);
    syncCopperProgress("cu", 1);
    const state = tubeAmount("cu");
    expect(state.copper / 3).toBeCloseTo(0.45);
    expect(state.species.HNO3).toBeCloseTo(0);
    expect(state.species["Cu2+"]).toBeCloseTo(1.65);
    expect(state.species.NO).toBeCloseTo(1.1);
  });

  it("starts the separate nitric acid tube at 2.5 ml and caps later pours at 5 ml", () => {
    seedTubeAmounts("acid", ["hno3"]);
    expect(tubeAmount("acid").volumeMl).toBe(2.5);
    expect(tubeAmount("acid").species.HNO3).toBeCloseTo(4.4);
    expect(deliver("acid", "hno3", 1)).toBe(1);
    expect(tubeAmount("acid").volumeMl).toBe(3.5);
    expect(deliver("acid", "hno3", 2)).toBe(1.5);
    expect(tubeAmount("acid").volumeMl).toBe(5);
  });

  it("seeds R4 in the 2:5:6 ratio with enough sulfite and acid", () => {
    seedTubeAmounts("r4", ["na2so3", "h2so4"]);
    deliver("r4", "kmno4", 1);
    const state = tubeAmount("r4");
    expect(state.species["MnO4-"]).toBe(2);
    expect(state.species["SO3(2-)"]).toBeGreaterThanOrEqual(5);
    expect(state.species["H+"]).toBeGreaterThanOrEqual(6);
    syncPermanganateExtent("r4", 1);
    expect(state.species["MnO4-"]).toBeCloseTo(0);
    expect(state.species["SO3(2-)"]).toBeCloseTo(1);
    expect(state.species["H+"]).toBeCloseTo(1.2);
    expect(state.species["Mn2+"]).toBeCloseTo(2);
    expect(state.species["SO4(2-)"]).toBeCloseTo(5);
  });

  it("conserves Ba and sulfate into local precipitate", () => {
    seedTubeAmounts("r3", ["bacl2"]);
    deliver("r3", "k2so4", 1);
    syncBariumExtent("r3", 0.8);
    const state = tubeAmount("r3");
    expect(state.species["Ba2+"] + state.species.BaSO4).toBeCloseTo(1.1);
    expect(state.species["SO4(2-)"] + state.species.BaSO4).toBeCloseTo(1);
  });
});
