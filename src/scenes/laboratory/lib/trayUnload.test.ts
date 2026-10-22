import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UNLOAD_STAGGER_MS, unloadTrayAnimated, useTrayUnloadStore } from "./trayUnload";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useReagentStorageStore, type StoredReagent } from "./useReagentStorageStore";
import { useStandMotionStore } from "./useStandMotionStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";

const bottle = (instanceId: string, slotIndex: number): StoredReagent => ({
  instanceId,
  reagentId: "nacl",
  containerType: "clear250",
  cabinetId: "cabinet-acids",
  slotIndex,
});

beforeEach(() => {
  vi.useFakeTimers();
  useTrayUnloadStore.setState({ phase: "idle" });
  useStandMotionStore.setState({ busyUntil: 0, rackArrivals: [] });
  useReagentStorageStore.setState({ trayItems: [bottle("a", 0), bottle("b", 1), bottle("c", 4)], workbenchItems: [], fumeHoodItems: [] });
  useTestTubeStorageStore.setState({ trayTestTubes: [{ instanceId: "t1", contents: [] }, { instanceId: "t2", contents: [] }], workbenchTestTubes: [], fumeHoodTestTubes: [] });
  useBunsenStandStorageStore.setState({ onTray: false, onWorkbench: false, onFumeHood: false, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ place: "workbench", phase: "capped", lit: false });
});

afterEach(() => vi.useRealTimers());

const onTable = () => useReagentStorageStore.getState().workbenchItems.map((item) => item.instanceId);

describe("unloading the tray, one item after another", () => {
  it("does not move anything before its turn, and keeps the tray's copies until then", () => {
    unloadTrayAnimated("workbench");
    expect(useTrayUnloadStore.getState().phase).toBe("unloading");
    // Pressed: the first goes at once, the rest wait their turn.
    vi.advanceTimersByTime(0);
    expect(onTable()).toEqual(["a"]);
    expect(useReagentStorageStore.getState().trayItems.map((item) => item.instanceId)).toEqual(["b", "c"]);
    vi.advanceTimersByTime(UNLOAD_STAGGER_MS - 1);
    expect(onTable()).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(onTable()).toEqual(["a", "b"]);
    vi.advanceTimersByTime(UNLOAD_STAGGER_MS);
    expect(onTable()).toEqual(["a", "b", "c"]);
  });

  it("sends the tubes after the bottles, each with its own flight", () => {
    unloadTrayAnimated("workbench");
    vi.advanceTimersByTime(UNLOAD_STAGGER_MS * 2);
    expect(useTestTubeStorageStore.getState().workbenchTestTubes).toHaveLength(0);
    vi.advanceTimersByTime(UNLOAD_STAGGER_MS * 2);
    expect(useTestTubeStorageStore.getState().workbenchTestTubes.map((tube) => tube.instanceId)).toEqual(["t1", "t2"]);
  });

  it("ignores a second press while it runs, and is idle again at the end", () => {
    unloadTrayAnimated("workbench");
    vi.advanceTimersByTime(UNLOAD_STAGGER_MS);
    useReagentStorageStore.setState((state) => ({ trayItems: [...state.trayItems, bottle("late", 5)] }));
    unloadTrayAnimated("fumeHood");
    vi.runAllTimers();
    expect(useReagentStorageStore.getState().fumeHoodItems).toEqual([]);
    expect(useTrayUnloadStore.getState().phase).toBe("idle");
    // The one put on meanwhile can be unloaded by the next press.
    unloadTrayAnimated("workbench");
    vi.runAllTimers();
    expect(onTable()).toContain("late");
  });

  it("an empty tray starts nothing", () => {
    useReagentStorageStore.setState({ trayItems: [] });
    useTestTubeStorageStore.setState({ trayTestTubes: [] });
    unloadTrayAnimated("workbench");
    expect(useTrayUnloadStore.getState().phase).toBe("idle");
  });

  it("blocks the stand until the last item has landed", () => {
    unloadTrayAnimated("workbench");
    expect(useStandMotionStore.getState().busyUntil).toBeGreaterThan(Date.now() + UNLOAD_STAGGER_MS * 4);
  });
});
