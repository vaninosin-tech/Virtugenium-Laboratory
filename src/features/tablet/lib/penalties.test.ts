import { beforeEach, describe, expect, it } from "vitest";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { totalScore } from "./experimentRuntime";
import { applyErrorRule } from "./penalties";

beforeEach(() => {
  useLaboratoryStore.getState().resetLaboratory();
});

describe("applyErrorRule", () => {
  it("does nothing outside an assignment", () => {
    expect(applyErrorRule("error-1-pour", "wrong-order")).toBeNull();
    expect(useLaboratoryStore.getState().errors).toHaveLength(0);
  });

  it("charges the rule's points and logs the error", () => {
    useLaboratoryStore.getState().selectExperiment("experiment-copper-nitric-acid");
    const penalty = applyErrorRule("error-1-heat", "safety-violation");
    expect(penalty?.charged).toBe(true);
    const state = useLaboratoryStore.getState();
    expect(totalScore(state.scoreEvents)).toBe(-2);
    expect(state.errors).toEqual([
      { code: "safety-violation", message: penalty!.rule.reason, stepId: "step-1-experiment" },
    ]);
  });

  it("charges each rule once per attempt but logs every occurrence", () => {
    useLaboratoryStore.getState().selectExperiment("experiment-copper-nitric-acid");
    applyErrorRule("error-1-heat", "safety-violation");
    const second = applyErrorRule("error-1-heat", "safety-violation");
    expect(second?.charged).toBe(false);
    const state = useLaboratoryStore.getState();
    expect(totalScore(state.scoreEvents)).toBe(-2);
    expect(state.errors).toHaveLength(2);
  });

  it("ignores a rule from another experiment", () => {
    useLaboratoryStore.getState().selectExperiment("experiment-silver-nitrate-sodium-chloride");
    expect(applyErrorRule("error-1-heat", "safety-violation")).toBeNull();
  });
});
