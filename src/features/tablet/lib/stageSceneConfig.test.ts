import { describe, expect, it } from "vitest";

import {
  getStageSceneRequirement,
  isSceneCompletedStep,
  type SceneSnapshot,
} from "./stageSceneConfig";

/**
 * Like `useSceneSnapshot` for a stand on the bench: the clamped tube's
 * contents follow from the bench tubes and the clamp index unless given.
 */
const snapshot = (overrides: Partial<SceneSnapshot> = {}): SceneSnapshot => ({
  clampedTubeContents:
    overrides.attachedTubeSlotIndex === undefined || overrides.attachedTubeSlotIndex === null
      ? null
      : overrides.workbenchTubes?.[overrides.attachedTubeSlotIndex]?.contents ?? null,
  workbenchTubes: [],
  attachedTubeSlotIndex: null,
  fumeHoodFanOn: false,
  atFumeHood: false,
  fumeHoodReagentIds: [],
  fumeHoodTubeContents: [],
  standInFumeHood: false,
  clampedHoodTubeContents: null,
  standOnWorkbench: false,
  workbenchReagentIds: [],
  heatingDone: false,
  clampedReactionSeen: false,
  ...overrides,
});

/** Everything experiment 1 needs under the hood, fan running. */
const readyHood = (): Partial<SceneSnapshot> => ({
  fumeHoodFanOn: true,
  standInFumeHood: true,
  fumeHoodTubeContents: [["cu"]],
  fumeHoodReagentIds: ["hno3"],
});

describe("step-1-setup", () => {
  const requirement = getStageSceneRequirement("step-1-setup")!;

  it("rejects an empty bench", () => {
    expect(requirement.isMet(snapshot())).toBe(false);
  });

  it("rejects copper in a tube that is not clamped in the stand", () => {
    expect(
      requirement.isMet(
        snapshot({
          workbenchTubes: [{ instanceId: "tube-0", contents: ["cu"] }],
          attachedTubeSlotIndex: null,
        }),
      ),
    ).toBe(false);
  });

  it("rejects an empty tube clamped in the stand", () => {
    expect(
      requirement.isMet(
        snapshot({
          workbenchTubes: [{ instanceId: "tube-0", contents: [] }],
          attachedTubeSlotIndex: 0,
        }),
      ),
    ).toBe(false);
  });

  it("rejects when the clamped slot holds a different reagent", () => {
    expect(
      requirement.isMet(
        snapshot({
          workbenchTubes: [
            { instanceId: "tube-0", contents: ["cu"] },
            { instanceId: "tube-1", contents: ["hno3"] },
          ],
          attachedTubeSlotIndex: 1,
        }),
      ),
    ).toBe(false);
  });

  it("accepts the copper tube clamped in the stand", () => {
    expect(
      requirement.isMet(
        snapshot({
          workbenchTubes: [
            { instanceId: "tube-0", contents: ["hno3"] },
            { instanceId: "tube-1", contents: ["cu"] },
          ],
          attachedTubeSlotIndex: 1,
        }),
      ),
    ).toBe(true);
  });

  it("rejects a clamped slot index with no tube standing in it", () => {
    expect(
      requirement.isMet(snapshot({ workbenchTubes: [], attachedTubeSlotIndex: 3 })),
    ).toBe(false);
  });
});

describe("step-1-transfer", () => {
  const requirement = getStageSceneRequirement("step-1-transfer")!;

  it("rejects an empty hood", () => {
    expect(requirement.isMet(snapshot({ fumeHoodFanOn: true }))).toBe(false);
  });

  it("rejects everything carried in but the fan left off", () => {
    expect(requirement.isMet(snapshot({ ...readyHood(), fumeHoodFanOn: false }))).toBe(false);
  });

  it("rejects a forgotten stand", () => {
    expect(requirement.isMet(snapshot({ ...readyHood(), standInFumeHood: false }))).toBe(false);
  });

  it("rejects a forgotten acid", () => {
    expect(requirement.isMet(snapshot({ ...readyHood(), fumeHoodReagentIds: [] }))).toBe(false);
  });

  it("rejects a tube carried in without the copper", () => {
    expect(
      requirement.isMet(snapshot({ ...readyHood(), fumeHoodTubeContents: [[]] })),
    ).toBe(false);
  });

  it("accepts the full setup with the fan running", () => {
    expect(requirement.isMet(snapshot(readyHood()))).toBe(true);
  });

  it("does not care where the camera is once the setup is in place", () => {
    expect(requirement.isMet(snapshot({ ...readyHood(), atFumeHood: false }))).toBe(true);
  });
});

describe("step-1-experiment", () => {
  const requirement = getStageSceneRequirement("step-1-experiment")!;

  it("needs copper and acid in the clamped tube and the heating finished", () => {
    expect(requirement.isMet(snapshot({ clampedHoodTubeContents: ["cu", "hno3"], heatingDone: true }))).toBe(true);
  });

  it("rejects heating finished on copper alone", () => {
    expect(requirement.isMet(snapshot({ clampedHoodTubeContents: ["cu"], heatingDone: true }))).toBe(false);
  });

  it("rejects the mixture before the heating is done", () => {
    expect(requirement.isMet(snapshot({ clampedHoodTubeContents: ["cu", "hno3"], heatingDone: false }))).toBe(false);
  });

  it("rejects when no tube is clamped in the hood", () => {
    expect(requirement.isMet(snapshot({ clampedHoodTubeContents: null, heatingDone: true }))).toBe(false);
  });
});

describe("experiments 2–4", () => {
  it("setup: the base solution clamped in the stand", () => {
    const setup = getStageSceneRequirement("step-4-setup")!;
    const bench = (contents: string[]) =>
      snapshot({ workbenchTubes: [{ instanceId: "t", contents }], attachedTubeSlotIndex: 0 });
    expect(setup.isMet(bench(["na2so3"]))).toBe(true);
    expect(setup.isMet(bench(["kmno4"]))).toBe(false);
  });

  it("transfer: stand with the base tube on the bench and the rest there as a bottle or a tube", () => {
    const transfer = getStageSceneRequirement("step-3-transfer")!;
    const bench: Partial<SceneSnapshot> = {
      standOnWorkbench: true,
      clampedTubeContents: ["bacl2"],
      workbenchReagentIds: ["k2so4"],
    };
    expect(transfer.isMet(snapshot(bench))).toBe(true);
    expect(transfer.isMet(snapshot({ ...bench, workbenchReagentIds: [] }))).toBe(false);
  });

  it("transfer: the fume hood serves as the working place too, fan not needed", () => {
    const transfer = getStageSceneRequirement("step-4-transfer")!;
    const hood: Partial<SceneSnapshot> = {
      standInFumeHood: true,
      clampedTubeContents: ["na2so3"],
      fumeHoodTubeContents: [["na2so3"], ["kmno4"]],
      fumeHoodReagentIds: ["h2so4"],
    };
    expect(transfer.isMet(snapshot(hood))).toBe(true);
    expect(transfer.isMet(snapshot({ ...hood, fumeHoodReagentIds: [] }))).toBe(false);
    expect(transfer.isMet(snapshot({ ...hood, standInFumeHood: false }))).toBe(false);
    // Not split between the two places: bottles in the hood, stand on the bench.
    expect(transfer.isMet(snapshot({ ...hood, standInFumeHood: false, standOnWorkbench: true }))).toBe(false);
  });

  it("experiment: everything in the clamped tube and the reaction seen", () => {
    const experiment = getStageSceneRequirement("step-2-experiment")!;
    expect(experiment.isMet(snapshot({ clampedTubeContents: ["agno3", "nacl"], clampedReactionSeen: true }))).toBe(true);
    expect(experiment.isMet(snapshot({ clampedTubeContents: ["agno3", "nacl"], clampedReactionSeen: false }))).toBe(false);
    expect(experiment.isMet(snapshot({ clampedTubeContents: ["agno3"], clampedReactionSeen: true }))).toBe(false);
  });
});

it("leaves steps without a scene condition to the tablet alone", () => {
  expect(getStageSceneRequirement("step-1-ppe")).toBeNull();
  expect(getStageSceneRequirement("step-1-equation")).toBeNull();
  expect(getStageSceneRequirement(null)).toBeNull();
  expect(isSceneCompletedStep("step-1-identify")).toBe(false);
  expect(isSceneCompletedStep("step-1-experiment")).toBe(true);
});
