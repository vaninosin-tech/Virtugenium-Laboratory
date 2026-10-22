import { describe, expect, it } from "vitest";

import {
  getRequiredItemsProgress,
  isPhysicalOnlyRequiredItem,
  isStageRequiredItemCollected,
} from "./stageRequiredConfig";

const STEP = "step-1-ppe";

describe("PPE is worn in the cabinet, not ticked in the tablet", () => {
  it("refuses to let the tablet toggle the three PPE items", () => {
    expect(isPhysicalOnlyRequiredItem(STEP, "safety-coat")).toBe(true);
    expect(isPhysicalOnlyRequiredItem(STEP, "safety-goggles")).toBe(true);
    expect(isPhysicalOnlyRequiredItem(STEP, "safety-gloves")).toBe(true);
  });

  it("still counts PPE once it is in the inventory", () => {
    expect(isStageRequiredItemCollected(STEP, "safety-goggles", ["safety-goggles"], {})).toBe(true);
  });

  it("does not count PPE that was never put on", () => {
    expect(isStageRequiredItemCollected(STEP, "safety-goggles", [], {})).toBe(false);
  });

  it("does not let the tablet tick the stand and burner", () => {
    expect(isPhysicalOnlyRequiredItem(STEP, "equipment-holder")).toBe(true);
    expect(isStageRequiredItemCollected(STEP, "equipment-holder", ["equipment-holder"], {})).toBe(
      false,
    );
  });

  it("keeps reagents and tubes tied to the 3D scene, not the inventory", () => {
    expect(isStageRequiredItemCollected(STEP, "reagent-copper", ["reagent-copper"], {})).toBe(false);
    expect(
      isStageRequiredItemCollected(STEP, "reagent-copper", [], { takenReagentIds: ["cu"] }),
    ).toBe(true);
    expect(
      isStageRequiredItemCollected(STEP, "glassware-test-tube", [], { takenTestTubeCount: 1 }),
    ).toBe(false);
    expect(
      isStageRequiredItemCollected(STEP, "glassware-test-tube", [], { takenTestTubeCount: 2 }),
    ).toBe(true);
  });

  it("counts the stand and the spirit lamp each only once that item itself is taken (VL-014)", () => {
    expect(isStageRequiredItemCollected(STEP, "equipment-burner", ["equipment-burner"], {})).toBe(false);
    expect(isStageRequiredItemCollected(STEP, "equipment-holder", [], { standTaken: true })).toBe(true);
    expect(isStageRequiredItemCollected(STEP, "equipment-burner", [], { standTaken: true })).toBe(false);
    expect(isStageRequiredItemCollected(STEP, "equipment-burner", [], { lampTaken: true })).toBe(true);
  });

  it("counts a fully equipped bench as 8 of 8", () => {
    const progress = getRequiredItemsProgress(
      STEP,
      ["safety-coat", "safety-goggles", "safety-gloves", "equipment-holder", "equipment-burner"],
      { takenReagentIds: ["cu", "hno3"], takenTestTubeCount: 2, standTaken: true, lampTaken: true },
    );
    expect(progress).toEqual({ current: 8, total: 8 });
  });
});
