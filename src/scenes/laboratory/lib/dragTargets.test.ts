import * as THREE from "three";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// `useSceneInteractionStore` exposes itself on `window` in dev; the tests run without a DOM.
(globalThis as { window?: unknown }).window ??= globalThis;

const { getDragTargetState, resolveDragTargets } = await import("./dragTargets");
const { bottleToTray } = await import("./trayCarry");
const { trayHandAction } = await import("./trayUnloadPlace");
const { useBunsenStandStorageStore } = await import("./useBunsenStandStorageStore");
const { useBurnerStore } = await import("./useBurnerStore");
const { useReagentStorageStore } = await import("./useReagentStorageStore");
const { useSceneInteractionStore } = await import("./useSceneInteractionStore");
const { useStandMotionStore } = await import("./useStandMotionStore");
const { useTestTubeStorageStore } = await import("./useTestTubeStorageStore");
const { registerWorktopZone } = await import("./worktopBounds");

type HeldItem = import("./useHandStore").HeldItem;

const jar = { instanceId: "jar", reagentId: "hno3", containerType: "clear250", cabinetId: "cabinet-acids", slotIndex: 0 } as const;
const jarFromBench: HeldItem = { kind: "bottle", location: "workbench", instanceId: "jar", reagentId: "hno3", containerType: "clear250" };
const jarFromTray: HeldItem = { kind: "tray", what: "bottle", instanceId: "jar" };

/** The tray stands on the table 0.4 m in; over it is "table-tray", beside it just "table". */
const OVER_TRAY = new THREE.Vector3(0, 0, -0.4);
const OVER_TABLE = new THREE.Vector3(1, 0, -0.4);

beforeAll(() => {
  registerWorktopZone("table", new THREE.Object3D());
  const tray = new THREE.Object3D();
  tray.position.set(0, 0, -0.4);
  registerWorktopZone("table-tray", tray);
});

beforeEach(() => {
  useSceneInteractionStore.setState({ activeTargetId: "table", cabinetPhase: "room", focusedCabinetId: null });
  useReagentStorageStore.setState({ trayItems: [], workbenchItems: [jar], fumeHoodItems: [] });
  useTestTubeStorageStore.setState({ trayTestTubes: [], workbenchTestTubes: [{ instanceId: "t0", contents: [] }], fumeHoodTestTubes: [] });
  useBunsenStandStorageStore.setState({ onTray: false, onWorkbench: true, onFumeHood: false, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ place: "shelf", phase: "capped", lit: false });
  useStandMotionStore.setState({ busyUntil: 0 });
});

describe("drag target states", () => {
  it("TABLE ↔ TRAY: white is wherever the jar is now, blue the other place", () => {
    // On the table.
    expect(getDragTargetState(jarFromBench, "table")).toBe("CURRENT_DROP_ZONE");
    expect(getDragTargetState(jarFromBench, "table-tray")).toBe("AVAILABLE_DROP_ZONE");

    // Moved onto the tray: taken again, it is a tray item.
    expect(bottleToTray("workbench", "jar")).toBe(true);
    expect(getDragTargetState(jarFromTray, "table-tray")).toBe("CURRENT_DROP_ZONE");
    expect(getDragTargetState(jarFromTray, "table")).toBe("AVAILABLE_DROP_ZONE");
  });

  it("let go over its own tray, a tray item stays there; over the table it is set down", () => {
    useReagentStorageStore.setState({ workbenchItems: [], trayItems: [jar] });
    expect(trayHandAction(jarFromTray as Extract<HeldItem, { kind: "tray" }>, OVER_TRAY)).toBeNull();
    expect(trayHandAction(jarFromTray as Extract<HeldItem, { kind: "tray" }>, OVER_TABLE)?.blocked).toBe(false);
  });

  it("the tray is no place for the jar once it is full", () => {
    useReagentStorageStore.setState({
      trayItems: [0, 1, 4, 5].map((slotIndex) => ({ ...jar, instanceId: `b${slotIndex}`, slotIndex })),
    });
    expect(getDragTargetState(jarFromBench, "table-tray")).toBe("NONE");
  });

  it("green where it can be used now, red where it is used but not now, nothing where it is not used", () => {
    const tube: HeldItem = { kind: "workbench-tube", index: 0, instanceId: "t0" };
    expect(getDragTargetState(tube, "clamp")).toBe("AVAILABLE_INTERACTION");
    expect(getDragTargetState(tube, "workbench-rack")).toBe("CURRENT_DROP_ZONE");
    expect(getDragTargetState(tube, "table")).toBe("NONE");
    // The stand still moving: the clamp is the tube's, but not now.
    useStandMotionStore.setState({ busyUntil: Date.now() + 10_000 });
    expect(getDragTargetState(tube, "clamp")).toBe("BLOCKED_INTERACTION");

    // A bottle would pour into the tube in the clamp — there is none yet.
    useStandMotionStore.setState({ busyUntil: 0 });
    expect(getDragTargetState(jarFromBench, "clamp")).toBe("BLOCKED_INTERACTION");
    // The stand elsewhere: nothing to do with it.
    useBunsenStandStorageStore.setState({ onWorkbench: false, onFumeHood: true });
    expect(getDragTargetState(jarFromBench, "clamp")).toBe("NONE");
  });

  it("an empty tube at the lamp may be heated in the hand — nothing reacts, but the glass heats", () => {
    useBurnerStore.setState({ place: "workbench" });
    const tube: HeldItem = { kind: "workbench-tube", index: 0, instanceId: "t0" };
    expect(resolveDragTargets(tube).flame).toBe("AVAILABLE_INTERACTION");
    expect(resolveDragTargets(jarFromBench).flame).toBe("NONE");
  });
});
