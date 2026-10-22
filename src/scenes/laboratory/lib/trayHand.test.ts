import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The stores publish themselves on `window` in dev, and `pressToTake` listens on it; no DOM here.
const events = vi.hoisted(() => {
  const target = new EventTarget();
  (globalThis as unknown as { window: unknown }).window = target;
  return target;
});

import { pressToTake } from "./pressToTake";
import { UNLOAD_STAGGER_MS, unloadTrayAnimated, useTrayUnloadStore } from "./trayUnload";
import { takeFromTray, trayHandAction } from "./trayUnloadPlace";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { HAND, takeIntoHand, useHandStore } from "./useHandStore";
import { useReagentStorageStore, type StoredReagent } from "./useReagentStorageStore";
import { useSceneInteractionStore } from "./useSceneInteractionStore";
import { useStandMotionStore } from "./useStandMotionStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";

const bottle = (instanceId: string, slotIndex: number): StoredReagent => ({
  instanceId,
  reagentId: "nacl",
  containerType: "clear250",
  cabinetId: "cabinet-acids",
  slotIndex,
});

const everywhere = (id: string) => {
  const r = useReagentStorageStore.getState();
  return [r.trayItems, r.workbenchItems, r.fumeHoodItems].reduce((n, list) => n + list.filter((item) => item.instanceId === id).length, 0);
};

beforeEach(() => {
  vi.useFakeTimers();
  useHandStore.setState({ held: null, home: null, aim: null });
  HAND.dragging = false;
  useTrayUnloadStore.setState({ phase: "idle" });
  useStandMotionStore.setState({ busyUntil: 0, rackArrivals: [] });
  useReagentStorageStore.setState({ trayItems: [bottle("a", 0), bottle("b", 1)], workbenchItems: [], fumeHoodItems: [] });
  useTestTubeStorageStore.setState({ trayTestTubes: [], workbenchTestTubes: [], fumeHoodTestTubes: [] });
  useBunsenStandStorageStore.setState({ onTray: false, onWorkbench: false, onFumeHood: false, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ place: "workbench", phase: "capped", lit: false });
  useSceneInteractionStore.setState({ activeTargetId: "table", focusedCabinetId: null, cabinetPhase: "room" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("taking from the tray into the hand", () => {
  it("takes one item; a second take while the hand is full changes nothing", () => {
    expect(takeFromTray("bottle", "a")).toBe(true);
    expect(takeFromTray("bottle", "b")).toBe(false);
    expect(useHandStore.getState().held).toMatchObject({ kind: "tray", instanceId: "a" });
    // Still on the tray, logically: the hand only carries the picture.
    expect(everywhere("a")).toBe(1);
    expect(everywhere("b")).toBe(1);
  });

  it("takeIntoHand reports whether it took", () => {
    expect(takeIntoHand({ kind: "tray", what: "bottle", instanceId: "a" }, [0, 0, 0])).toBe(true);
    expect(takeIntoHand({ kind: "tray", what: "bottle", instanceId: "b" }, [0, 0, 0])).toBe(false);
    expect(useHandStore.getState().held?.instanceId).toBe("a");
  });

  it("does not take in a cabinet, where a tray item goes back to its shelf", () => {
    useSceneInteractionStore.setState({ activeTargetId: "table", focusedCabinetId: "cabinet-acids", cabinetPhase: "inspecting" });
    expect(takeFromTray("bottle", "a")).toBe(false);
    expect(useHandStore.getState().held).toBeNull();
  });

  it("a press while the hand is full neither takes nor starts a drag", () => {
    takeFromTray("bottle", "a");
    const take = vi.fn(() => true);
    pressToTake({ button: 2, clientX: 0, clientY: 0 }, take);
    const move = Object.assign(new Event("pointermove"), { clientX: 40, clientY: 0 });
    events.dispatchEvent(move);
    expect(take).not.toHaveBeenCalled();
    expect(HAND.dragging).toBe(false);
  });

  it("a drag whose take is refused does not leave the hand dragging", () => {
    pressToTake({ button: 2, clientX: 0, clientY: 0 }, () => false);
    events.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 40, clientY: 0 }));
    expect(HAND.dragging).toBe(false);
  });
});

describe("setting a tray item down from the hand", () => {
  it("moves it to the table exactly once — never on both", () => {
    takeFromTray("bottle", "a");
    const held = useHandStore.getState().held;
    if (held?.kind !== "tray") throw new Error("not held");
    trayHandAction(held)?.run([0, 1, 0]);
    expect(everywhere("a")).toBe(1);
    expect(useReagentStorageStore.getState().workbenchItems.map((item) => item.instanceId)).toEqual(["a"]);
    // A stale second run (double click) finds nothing on the tray to move.
    trayHandAction(held)?.run([0, 1, 0]);
    expect(everywhere("a")).toBe(1);
  });
});

describe("unloading while something is in the hand", () => {
  it("does not start under a held tray item", () => {
    takeFromTray("bottle", "a");
    unloadTrayAnimated("workbench");
    expect(useTrayUnloadStore.getState().phase).toBe("idle");
    vi.runAllTimers();
    expect(useReagentStorageStore.getState().trayItems).toHaveLength(2);
  });

  it("leaves an item taken in the hand mid-unload where it is, and loses nothing", () => {
    unloadTrayAnimated("workbench");
    vi.advanceTimersByTime(0);
    // `a` has gone; the player takes `b` before its turn.
    takeFromTray("bottle", "b");
    vi.advanceTimersByTime(UNLOAD_STAGGER_MS * 3);
    expect(useReagentStorageStore.getState().trayItems.map((item) => item.instanceId)).toEqual(["b"]);
    expect(everywhere("a")).toBe(1);
    expect(everywhere("b")).toBe(1);
  });
});
