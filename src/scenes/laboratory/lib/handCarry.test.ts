import * as THREE from "three";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// `useSceneInteractionStore` exposes itself on `window` in dev; the tests run without a DOM.
(globalThis as { window?: unknown }).window ??= globalThis;

const { getDragTargetState } = await import("./dragTargets");
const { heatInHandAction, takeClampedTube, jarPourAction } = await import("./standTableActions");
const { takeEquipment } = await import("./equipmentCarry");
const { takeClamp } = await import("./clampCarry");
const { pressToTake } = await import("./pressToTake");
const { JAR_AIM, registerPourSource } = await import("./pourSources");
const { trayHandAction } = await import("./trayUnloadPlace");
const { CLAMP_TUBE_MOUTH, useStandMotionStore } = await import("./useStandMotionStore");
const { HAND, useHandStore } = await import("./useHandStore");
const { useBunsenStandStorageStore } = await import("./useBunsenStandStorageStore");
const { useBurnerStore } = await import("./useBurnerStore");
const { useHeatingStore } = await import("./useHeatingStore");
const { useLaboratoryStore } = await import("../../../stores/laboratory/useLaboratoryStore");
const { useReagentStorageStore } = await import("./useReagentStorageStore");
const { useSceneInteractionStore } = await import("./useSceneInteractionStore");
const { useTestTubeDragStore } = await import("./useTestTubeDragStore");
const { useTestTubeStorageStore } = await import("./useTestTubeStorageStore");
const { registerWorktopZone } = await import("./worktopBounds");
const { ghostCandidates } = await import("../ui/placementGhosts");

type HeldItem = import("./useHandStore").HeldItem;

const rackTube: HeldItem = { kind: "workbench-tube", index: 0, instanceId: "workbench-tube-slot-0" };

beforeAll(() => {
  registerWorktopZone("table", new THREE.Object3D());
  const tray = new THREE.Object3D();
  tray.position.set(0, 0, -0.4);
  registerWorktopZone("table-tray", tray);
});

beforeEach(() => {
  useHandStore.setState({ held: null, home: null, aim: null });
  useTestTubeDragStore.setState({ heldInstanceId: null, pendingPickInstanceId: null });
  useSceneInteractionStore.setState({ activeTargetId: "table", cabinetPhase: "room", focusedCabinetId: null });
  useReagentStorageStore.setState({ trayItems: [], workbenchItems: [], fumeHoodItems: [] });
  useTestTubeStorageStore.setState({
    trayTestTubes: [],
    workbenchTestTubes: [{ instanceId: "t0", contents: [] }, { instanceId: "t1", contents: ["hno3"] }],
    fumeHoodTestTubes: [],
  });
  useBunsenStandStorageStore.setState({ onTray: false, onWorkbench: true, onFumeHood: false, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ place: "workbench", phase: "capped", lit: false });
  useHeatingStore.setState({ active: false });
  useStandMotionStore.setState({ busyUntil: 0, pour: null });
  CLAMP_TUBE_MOUTH.point.set(0, 0.2, 0);
  CLAMP_TUBE_MOUTH.valid = true;
  JAR_AIM.source = null;
});

afterEach(() => {
  JAR_AIM.source = null;
});

describe("heating in the hand", () => {
  it("an empty tube may be heated over the lamp — green, not red", () => {
    expect(heatInHandAction("workbench", 0)?.blocked).toBe(false);
    expect(getDragTargetState(rackTube, "flame")).toBe("AVAILABLE_INTERACTION");
  });
});

describe("the clamp and the tube in it", () => {
  it("a tube is taken out of the clamp into the hand: the clamp is left empty, the tube is the same tube", () => {
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 1 });
    expect(takeClampedTube()).toBe(true);
    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBeNull();
    expect(useHandStore.getState().held).toEqual({ kind: "workbench-tube", index: 1, instanceId: "workbench-tube-slot-1" });
    expect(useTestTubeStorageStore.getState().workbenchTestTubes[1].instanceId).toBe("t1");
  });

  it("the clamp is taken off the stand with its tube still in it", () => {
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 1 });
    expect(takeClamp("workbench")).toBe(true);
    expect(useHandStore.getState().held?.kind).toBe("clamp");
    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBe(1);
  });
});

describe("one thing in the hand at a time", () => {
  it("with something held, nothing else is taken — by a press or directly", () => {
    useHandStore.setState({ held: rackTube });
    let taken = false;
    pressToTake({ button: 0, clientX: 0, clientY: 0 }, () => (taken = true));
    expect(taken).toBe(false);
    expect(takeEquipment("lamp")).toBe(false);
    expect(takeEquipment("stand")).toBe(false);
    expect(takeClamp("workbench")).toBe(false);
    expect(takeClampedTube()).toBe(false);
  });

  it("but what is held still does its own thing at its target (a tube at the flame)", () => {
    useHandStore.setState({ held: rackTube });
    expect(heatInHandAction("workbench", 0)?.blocked).toBe(false);
  });
});

describe("the stand and the lamp off the table", () => {
  it("may go onto the tray — the stand only with nothing in its clamp", () => {
    const stand: HeldItem = { kind: "equipment", what: "stand", location: "workbench", instanceId: "workbench-stand" };
    const lamp: HeldItem = { kind: "equipment", what: "lamp", location: "workbench", instanceId: "workbench-lamp" };
    expect(getDragTargetState(stand, "table")).toBe("CURRENT_DROP_ZONE");
    expect(getDragTargetState(stand, "table-tray")).toBe("AVAILABLE_DROP_ZONE");
    expect(getDragTargetState(lamp, "table-tray")).toBe("AVAILABLE_DROP_ZONE");
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(getDragTargetState(stand, "table-tray")).toBe("NONE");
  });

  it("a burning lamp is not taken", () => {
    useBurnerStore.setState({ lit: true, phase: "lit" });
    expect(takeEquipment("lamp")).toBe(false);
  });
});

describe("tubes and the tray", () => {
  it("a rack tube may go onto the tray; one off the tray goes back to the rack or into the empty clamp", () => {
    expect(getDragTargetState(rackTube, "table-tray")).toBe("AVAILABLE_DROP_ZONE");
    const trayTube: HeldItem = { kind: "tray", what: "tube", instanceId: "t9" };
    useTestTubeStorageStore.setState({ trayTestTubes: [{ instanceId: "t9", contents: [] }] });
    expect(getDragTargetState(trayTube, "table-tray")).toBe("CURRENT_DROP_ZONE");
    expect(getDragTargetState(trayTube, "table")).toBe("AVAILABLE_DROP_ZONE");
    expect(getDragTargetState(trayTube, "clamp")).toBe("AVAILABLE_INTERACTION");

    // Brought to the clamp and let go: into it — the clamp points at it in the bench's rack list.
    const action = trayHandAction(trayTube as Extract<HeldItem, { kind: "tray" }>, new THREE.Vector3(0, 0.1, 0));
    expect(action?.label).toMatch(/лапке/);
    action?.run([0, 0.1, 0]);
    const bench = useTestTubeStorageStore.getState().workbenchTestTubes;
    expect(bench[useBunsenStandStorageStore.getState().attachedTubeSlotIndex!].instanceId).toBe("t9");
    expect(useTestTubeStorageStore.getState().trayTestTubes).toEqual([]);
  });
});

describe("a tube held up to a bottle", () => {
  const source = () => ({
    instanceId: "jar-hcl",
    reagentId: "hno3",
    location: "workbench" as const,
    root: new THREE.Object3D(),
    geometry: () => ({ mouthOffset: new THREE.Vector3(0, 0.1, 0), radius: 0.03, neckRadius: 0.012 }),
  });

  it("the bottle pours into it: green, and the tube stays in the hand", () => {
    const jar = source();
    const unregister = registerPourSource(jar);
    useLaboratoryStore.setState({ selectedExperimentId: null });
    JAR_AIM.source = jar;
    expect(getDragTargetState(rackTube, "reagent")).toBe("AVAILABLE_INTERACTION");
    const pour = jarPourAction(rackTube, jar);
    expect(pour?.keepHeld).toBe(true);
    pour?.run();
    expect(useStandMotionStore.getState().pour).toMatchObject({ instanceId: "jar-hcl", into: "hand" });
    unregister();
  });

  it("the same reagent twice is refused — red", () => {
    const jar = source();
    JAR_AIM.source = jar;
    const tubeWithIt: HeldItem = { kind: "workbench-tube", index: 1, instanceId: "workbench-tube-slot-1" };
    expect(getDragTargetState(tubeWithIt, "reagent")).toBe("BLOCKED_INTERACTION");
  });
});

describe("the outlines never move what is held", () => {
  it("working out where it could go leaves the hand and the held item as they are", () => {
    useHandStore.setState({ held: rackTube });
    HAND.point.set(0.3, 0.9, -0.2);
    HAND.itemPos.set(0.3, 0.9, -0.2);
    const before = [HAND.point.clone(), HAND.itemPos.clone()];
    ghostCandidates(rackTube, new THREE.PerspectiveCamera());
    expect(HAND.point.equals(before[0])).toBe(true);
    expect(HAND.itemPos.equals(before[1])).toBe(true);
  });
});
