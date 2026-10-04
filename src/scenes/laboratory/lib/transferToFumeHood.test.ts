import { beforeEach, describe, expect, it } from "vitest";

import { transferSelectionToFumeHood } from "./transferToFumeHood";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useReagentStorageStore, type StoredReagent } from "./useReagentStorageStore";
import { useTestTubeStorageStore, type StoredTestTube } from "./useTestTubeStorageStore";

const tube = (instanceId: string, ...contents: string[]): StoredTestTube => ({
  instanceId,
  contents,
});

const bottle = (instanceId: string, reagentId: string): StoredReagent => ({
  instanceId,
  reagentId,
  containerType: "clear250",
  cabinetId: "cabinet-acids",
  slotIndex: 0,
});

beforeEach(() => {
  useTestTubeStorageStore.setState({ workbenchTestTubes: [], fumeHoodTestTubes: [] });
  useReagentStorageStore.setState({ workbenchItems: [], fumeHoodItems: [] });
  useBunsenStandStorageStore.setState({
    onWorkbench: true,
    onFumeHood: false,
    attachedTubeSlotIndex: null,
  });
});

describe("transferSelectionToFumeHood", () => {
  it("carries the clamped tube along with the stand", () => {
    useTestTubeStorageStore.setState({
      workbenchTestTubes: [tube("t0", "hno3"), tube("t1", "cu")],
    });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 1 });

    transferSelectionToFumeHood({
      reagentInstanceIds: [],
      tubeInstanceIds: [],
      includeStand: true,
    });

    const tubes = useTestTubeStorageStore.getState();
    expect(tubes.fumeHoodTestTubes.map((entry) => entry.instanceId)).toEqual(["t1"]);
    expect(tubes.workbenchTestTubes.map((entry) => entry.instanceId)).toEqual(["t0"]);
    expect(useBunsenStandStorageStore.getState().onFumeHood).toBe(true);
  });

  it("re-points the clamp at the tube's new index", () => {
    useTestTubeStorageStore.setState({
      workbenchTestTubes: [tube("t0", "hno3"), tube("t1", "cu"), tube("t2")],
    });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 1 });

    transferSelectionToFumeHood({
      reagentInstanceIds: [],
      tubeInstanceIds: ["t0"],
      includeStand: true,
    });

    const { fumeHoodTestTubes } = useTestTubeStorageStore.getState();
    const clampedIndex = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
    expect(clampedIndex).not.toBeNull();
    expect(fumeHoodTestTubes[clampedIndex!]?.instanceId).toBe("t1");
  });

  it("offsets the remapped index past tubes already in the hood", () => {
    useTestTubeStorageStore.setState({
      workbenchTestTubes: [tube("t5", "cu")],
      fumeHoodTestTubes: [tube("old0"), tube("old1")],
    });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });

    transferSelectionToFumeHood({
      reagentInstanceIds: [],
      tubeInstanceIds: [],
      includeStand: true,
    });

    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBe(2);
    expect(
      useTestTubeStorageStore.getState().fumeHoodTestTubes[2]?.instanceId,
    ).toBe("t5");
  });

  it("moves selected bottles and leaves the rest on the bench", () => {
    useReagentStorageStore.setState({
      workbenchItems: [bottle("r0", "hno3"), bottle("r1", "h2so4")],
    });

    transferSelectionToFumeHood({
      reagentInstanceIds: ["r0"],
      tubeInstanceIds: [],
      includeStand: false,
    });

    const reagents = useReagentStorageStore.getState();
    expect(reagents.fumeHoodItems.map((item) => item.reagentId)).toEqual(["hno3"]);
    expect(reagents.workbenchItems.map((item) => item.reagentId)).toEqual(["h2so4"]);
  });

  it("leaves the stand behind when it was not selected", () => {
    useTestTubeStorageStore.setState({ workbenchTestTubes: [tube("t0", "cu")] });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });

    transferSelectionToFumeHood({
      reagentInstanceIds: [],
      tubeInstanceIds: [],
      includeStand: false,
    });

    expect(useBunsenStandStorageStore.getState().onFumeHood).toBe(false);
    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBe(0);
    expect(useTestTubeStorageStore.getState().fumeHoodTestTubes).toHaveLength(0);
  });

  it("clears the clamp when the stand travels empty", () => {
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: null });

    transferSelectionToFumeHood({
      reagentInstanceIds: [],
      tubeInstanceIds: [],
      includeStand: true,
    });

    expect(useBunsenStandStorageStore.getState().onFumeHood).toBe(true);
    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBeNull();
  });
});

describe("the spirit lamp (VL-014)", () => {
  it("is carried in on its own, capped, and only when chosen", async () => {
    const { useBurnerStore } = await import("./useBurnerStore");
    useBurnerStore.setState({ place: "workbench", phase: "lit", lit: true });

    transferSelectionToFumeHood({ reagentInstanceIds: [], tubeInstanceIds: [], includeStand: true });
    expect(useBurnerStore.getState().place).toBe("workbench");

    transferSelectionToFumeHood({ reagentInstanceIds: [], tubeInstanceIds: [], includeStand: false, includeLamp: true });
    expect(useBurnerStore.getState()).toMatchObject({ place: "fumeHood", lit: false, phase: "capped" });
  });
});
