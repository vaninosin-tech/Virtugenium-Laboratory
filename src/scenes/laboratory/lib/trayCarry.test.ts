import { beforeEach, describe, expect, it } from "vitest";

import { bottleFromTray, bottleToTray, lampFromTray, lampToTray, standFromTray, standToTray, tubeFromTray, tubeToTray, unloadTray } from "./trayCarry";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useReagentStorageStore, type StoredReagent } from "./useReagentStorageStore";
import { useTestTubeStorageStore, type StoredTestTube } from "./useTestTubeStorageStore";

const tube = (instanceId: string, ...contents: string[]): StoredTestTube => ({ instanceId, contents });
const bottle = (instanceId: string, reagentId: string, slotIndex = 0): StoredReagent => ({
  instanceId,
  reagentId,
  containerType: "clear250",
  cabinetId: "cabinet-acids",
  slotIndex,
});

beforeEach(() => {
  useReagentStorageStore.setState({ trayItems: [], workbenchItems: [], fumeHoodItems: [] });
  useTestTubeStorageStore.setState({ trayTestTubes: [], workbenchTestTubes: [], fumeHoodTestTubes: [] });
  useBunsenStandStorageStore.setState({ onTray: false, onWorkbench: true, onFumeHood: false, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ place: "workbench", phase: "capped", lit: false });
});

describe("carrying things on the tray (VL-017)", () => {
  it("puts a bottle from the bench into a free slot of the bottles' half, and down in the hood", () => {
    useReagentStorageStore.setState({ workbenchItems: [bottle("hno3", "hno3")], trayItems: [bottle("cu", "cu", 0)] });
    expect(bottleToTray("workbench", "hno3")).toBe(true);
    const onTray = useReagentStorageStore.getState().trayItems.find((item) => item.instanceId === "hno3");
    expect(onTray?.slotIndex).toBe(1);
    expect(useReagentStorageStore.getState().workbenchItems).toEqual([]);

    bottleFromTray("hno3", "fumeHood");
    expect(useReagentStorageStore.getState().fumeHoodItems.map((item) => item.instanceId)).toEqual(["hno3"]);
  });

  it("refuses a fifth bottle — the tray's right half is the equipment's", () => {
    useReagentStorageStore.setState({
      trayItems: [0, 1, 4, 5].map((slot) => bottle(`b${slot}`, "nacl", slot)),
      workbenchItems: [bottle("extra", "hno3")],
    });
    expect(bottleToTray("workbench", "extra")).toBe(false);
    expect(useReagentStorageStore.getState().workbenchItems).toHaveLength(1);
  });

  it("keeps the clamp on its tube when a tube before it in the rack is taken onto the tray", () => {
    useTestTubeStorageStore.setState({ workbenchTestTubes: [tube("a"), tube("b", "hno3"), tube("c", "cu")] });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 2 });
    expect(tubeToTray("workbench", 1)).toBe(true);
    const bench = useTestTubeStorageStore.getState().workbenchTestTubes;
    expect(bench.map((t) => t.instanceId)).toEqual(["a", "c"]);
    expect(bench[useBunsenStandStorageStore.getState().attachedTubeSlotIndex!].instanceId).toBe("c");
    expect(useTestTubeStorageStore.getState().trayTestTubes).toEqual([tube("b", "hno3")]);
  });

  it("does not take the clamped tube, nor the stand with a tube in its clamp", () => {
    useTestTubeStorageStore.setState({ workbenchTestTubes: [tube("a", "cu")] });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(tubeToTray("workbench", 0)).toBe(false);
    expect(standToTray("workbench")).toBe(false);
    expect(useBunsenStandStorageStore.getState().onWorkbench).toBe(true);
  });

  it("carries the stand on its own — the lamp is its own piece of equipment and stays (VL-020)", () => {
    useBurnerStore.setState({ place: "workbench", phase: "lit", lit: true });
    expect(standToTray("workbench")).toBe(true);
    expect(useBunsenStandStorageStore.getState()).toMatchObject({ onTray: true, onWorkbench: false });
    expect(useBurnerStore.getState()).toMatchObject({ place: "workbench", lit: true });

    standFromTray("fumeHood");
    expect(useBunsenStandStorageStore.getState()).toMatchObject({ onTray: false, onFumeHood: true });
    expect(useBurnerStore.getState().place).toBe("workbench");
  });

  it("puts the lamp on the tray capped, and down again on its own (VL-020)", () => {
    useBurnerStore.setState({ place: "workbench", phase: "lit", lit: true });
    expect(lampToTray("workbench")).toBe(true);
    expect(useBurnerStore.getState()).toMatchObject({ place: "tray", lit: false, phase: "capped" });
    expect(lampFromTray("fumeHood")).toBe(true);
    expect(useBurnerStore.getState().place).toBe("fumeHood");
  });

  it("unloads everything at once, a filled tube keeping what is in it", () => {
    useReagentStorageStore.setState({ trayItems: [bottle("hno3", "hno3")] });
    useTestTubeStorageStore.setState({ trayTestTubes: [tube("t", "cu")] });
    useBunsenStandStorageStore.setState({ onWorkbench: false, onTray: true });
    useBurnerStore.setState({ place: "tray" });
    unloadTray("fumeHood");
    expect(useReagentStorageStore.getState().fumeHoodItems).toHaveLength(1);
    expect(useTestTubeStorageStore.getState().fumeHoodTestTubes).toEqual([tube("t", "cu")]);
    expect(useBunsenStandStorageStore.getState().onFumeHood).toBe(true);
    expect(useBurnerStore.getState().place).toBe("fumeHood");
    expect(tubeFromTray("t", "workbench")).toBe(false);
  });
});
