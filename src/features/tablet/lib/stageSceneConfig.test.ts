import { describe, expect, it } from "vitest";

import {
  getStageSceneRequirement,
  type SceneSnapshot,
} from "./stageSceneConfig";

const snapshot = (overrides: Partial<SceneSnapshot> = {}): SceneSnapshot => ({
  workbenchTubes: [],
  attachedTubeSlotIndex: null,
  fumeHoodFanOn: false,
  atFumeHood: false,
  fumeHoodReagentIds: [],
  fumeHoodTubeContents: [],
  standInFumeHood: false,
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

it("leaves steps without a scene condition to the tablet alone", () => {
  expect(getStageSceneRequirement("step-1-ppe")).toBeNull();
  expect(getStageSceneRequirement("step-1-equation")).toBeNull();
  expect(getStageSceneRequirement(null)).toBeNull();
});
