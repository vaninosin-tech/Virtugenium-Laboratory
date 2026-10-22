import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import * as THREE from "three";

import { fillTubeAction, heatInHandAction, runStandAction, standActionFor } from "./standTableActions";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useHeatingStore } from "./useHeatingStore";
import { POUR_COMMIT_MS, POUR_MS, useStandMotionStore } from "./useStandMotionStore";
import { useReagentStorageStore } from "./useReagentStorageStore";
import { useTestTubeDragStore } from "./useTestTubeDragStore";
import { registerWorktopObstacle } from "./worktopBounds";
import { useTestTubeStorageStore, type StoredTestTube } from "./useTestTubeStorageStore";

const EXP1 = "experiment-copper-nitric-acid";

const tube = (instanceId: string, ...contents: string[]): StoredTestTube => ({ instanceId, contents });
const hoodTubes = () => useTestTubeStorageStore.getState().fumeHoodTestTubes;

const rackTube = (index: number) => ({ kind: "rack-tube", location: "fumeHood", index }) as const;
const bottle = (reagentId: string) => ({ kind: "bottle", location: "fumeHood", reagentId }) as const;

/** Lets every running motion at the stand finish. */
const settle = () => vi.advanceTimersByTime(POUR_MS + 100);

beforeEach(() => {
  vi.useFakeTimers();
  useStandMotionStore.setState({ busyUntil: 0, pour: null, clampArrival: null, rackArrivals: [] });
  useLaboratoryStore.setState({ selectedExperimentId: EXP1 });
  useTestTubeStorageStore.setState({
    workbenchTestTubes: [],
    fumeHoodTestTubes: [tube("t0", "cu"), tube("t1")],
  });
  useBunsenStandStorageStore.setState({ onWorkbench: false, onFumeHood: true, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ phase: "capped", lit: false, place: "fumeHood" });
  useHeatingStore.setState({ active: false });
  useTestTubeDragStore.setState({ heldInstanceId: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stand actions on the table (VL-014)", () => {
  it("clamps a rack tube while the clamp is empty", () => {
    expect(standActionFor(rackTube(0))).toMatchObject({ label: "Закрепить пробирку в лапке штатива", blocked: false });
    runStandAction(rackTube(0));
    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBe(0);
  });

  it("pours from a bottle into the clamped tube, and says when there is nothing to pour into", () => {
    expect(standActionFor(bottle("hno3"))).toMatchObject({ blocked: true, label: "Сначала закрепите пробирку в лапке штатива" });

    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(standActionFor(bottle("hno3"))).toMatchObject({ blocked: false, label: "Прилить HNO₃ в пробирку в лапке" });
    runStandAction(bottle("hno3"));
    settle();
    expect(hoodTubes()[0].contents).toEqual(["cu", "hno3"]);
    expect(standActionFor(bottle("hno3"))).toMatchObject({ blocked: true });
  });

  it("says «насыпать» for a solid", () => {
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 1 });
    expect(standActionFor(bottle("cu"))?.label).toBe("Насыпать Cu в пробирку в лапке");
  });

  it("blocks a reagent the experiment does not use, without pouring it", () => {
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    const refused = standActionFor(bottle("nacl"));
    expect(refused?.blocked).toBe(true);
    refused?.run();
    expect(hoodTubes()[0].contents).toEqual(["cu"]);
  });

  it("leaves a wrong mixing order clickable — it is the player's mistake to make: charged, and poured (VL-018)", () => {
    useTestTubeStorageStore.setState({ fumeHoodTestTubes: [tube("t0", "hno3"), tube("t1")] });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(standActionFor(bottle("cu"))?.blocked).toBe(false);
    runStandAction(bottle("cu"));
    expect(hoodTubes()[0].contents).toEqual(["hno3", "cu"]);
  });

  it("pours a filled rack tube into the clamped one; an empty one has nothing to pour", () => {
    useTestTubeStorageStore.setState({ fumeHoodTestTubes: [tube("t0", "cu"), tube("t1", "hno3"), tube("t2")] });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(standActionFor(rackTube(2))?.blocked).toBe(true);
    runStandAction(rackTube(1));
    expect(hoodTubes()[0].contents).toEqual(["cu", "hno3"]);
  });

  it("one click on the lamp lights it and takes the clamp to the flame — the mini-game starts (VL-020)", () => {
    useTestTubeStorageStore.setState({ fumeHoodTestTubes: [tube("t0", "cu", "hno3"), tube("t1")] });
    expect(standActionFor({ kind: "burner" })).toMatchObject({ blocked: true, label: "Сначала закрепите пробирку в лапке штатива" });

    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(standActionFor({ kind: "burner" })).toMatchObject({ blocked: false, label: "Нагреть пробирку в лапке" });
    runStandAction({ kind: "burner" });
    expect(useBurnerStore.getState().lit).toBe(true);
    expect(useHeatingStore.getState()).toMatchObject({ active: true, target: { mode: "clamp" } });
    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBe(0);
  });

  it("the clamped tube is heated by a click on it too, while the lamp stands here", () => {
    useTestTubeStorageStore.setState({ fumeHoodTestTubes: [tube("t0", "cu", "hno3"), tube("t1")] });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(standActionFor({ kind: "clamped-tube" })?.label).toBe("Нагреть пробирку в лапке");
    runStandAction({ kind: "clamped-tube" });
    expect(useBurnerStore.getState().lit).toBe(true);
    expect(useHeatingStore.getState().active).toBe(true);
  });

  it("heats nothing that has no reaction needing heat — the lamp says so, the tube just goes back (VL-020)", () => {
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    expect(standActionFor({ kind: "burner" })).toMatchObject({
      blocked: true,
      label: "Нагревать нечего — в пробирке нет реакции, которой нужен нагрев",
    });
    expect(standActionFor({ kind: "clamped-tube" })?.label).toBe("Вернуть пробирку в штатив для пробирок");
    runStandAction({ kind: "clamped-tube" });
    expect(useHeatingStore.getState().active).toBe(false);
    expect(useBurnerStore.getState().lit).toBe(false);
  });

  it("heats only with the lamp in the same place — a lamp left on the workbench does not count", () => {
    useTestTubeStorageStore.setState({ fumeHoodTestTubes: [tube("t0", "cu", "hno3"), tube("t1")] });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    useBurnerStore.setState({ place: "workbench" });
    expect(standActionFor({ kind: "clamped-tube" })?.label).toBe("Вернуть пробирку в штатив для пробирок");
    expect(standActionFor({ kind: "burner" })?.blocked).toBe(true);
  });

  it("a tube in the hand is heated over the lamp too — the lamp lights itself — and that is charged as a mistake (VL-020)", () => {
    useTestTubeStorageStore.setState({ fumeHoodTestTubes: [tube("t0", "cu", "hno3"), tube("t1", "cu")] });
    useLaboratoryStore.setState({ scoreEvents: [], errors: [] });

    expect(heatInHandAction("fumeHood", 1)?.blocked).toBe(true);
    const heat = heatInHandAction("fumeHood", 0);
    expect(heat?.blocked).toBe(false);
    heat?.run();
    expect(useBurnerStore.getState().lit).toBe(true);
    expect(useHeatingStore.getState()).toMatchObject({
      active: true,
      target: { mode: "hand", location: "fumeHood", index: 0, instanceId: "t0" },
    });
    expect(useLaboratoryStore.getState().scoreEvents.map((event) => event.ruleId)).toContain("error-1-heat-hand");
  });

  it("a bottle pours when it is tipped over the tube, and the stand takes no clicks until it is back", () => {
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    runStandAction({ ...bottle("hno3"), instanceId: "jar-hno3" });
    expect(useStandMotionStore.getState().pour?.instanceId).toBe("jar-hno3");
    expect(standActionFor({ kind: "burner" })).toBeNull();
    expect(hoodTubes()[0].contents).toEqual(["cu"]);

    vi.advanceTimersByTime(POUR_COMMIT_MS + 10);
    expect(hoodTubes()[0].contents).toEqual(["cu", "hno3"]);
    expect(standActionFor({ kind: "burner" })).toBeNull();

    settle();
    expect(useStandMotionStore.getState().pour).toBeNull();
    expect(standActionFor({ kind: "burner" })).not.toBeNull();
  });

  it("a tube clamped from the rack flies in from where it stood", () => {
    runStandAction(rackTube(1), [1, 2, 3]);
    expect(useBunsenStandStorageStore.getState().attachedTubeSlotIndex).toBe(1);
    expect(useStandMotionStore.getState().clampArrival?.world).toEqual([1, 2, 3]);
    expect(standActionFor(rackTube(0))).toBeNull();
  });

  it("stays out of the way where there is no stand, while heating, and while a tube is carried", () => {
    expect(standActionFor({ kind: "bottle", location: "workbench", reagentId: "hno3" })).toBeNull();

    useHeatingStore.setState({ active: true });
    expect(standActionFor(rackTube(0))).toBeNull();
    useHeatingStore.setState({ active: false });

    useTestTubeDragStore.setState({ heldInstanceId: "workbench-tube-slot-1" });
    expect(standActionFor(rackTube(0))).toBeNull();
  });
});

describe("a tube in the hand brought to a jar", () => {
  const JAR_AT = { x: 0.5, z: 0.2, r: 0.04 };
  let unregister: () => void;

  beforeEach(() => {
    useReagentStorageStore.setState({
      fumeHoodItems: [
        { instanceId: "jar-hno3", reagentId: "hno3", containerType: "clear250", cabinetId: "cabinet-acids", slotIndex: 0 },
        { instanceId: "jar-cu", reagentId: "cu", containerType: "wide120", cabinetId: "cabinet-simple", slotIndex: 1 },
      ],
    });
    unregister = registerWorktopObstacle("jar-hno3", { get: () => [{ kind: "circle", ...JAR_AT }] });
  });
  afterEach(() => unregister());

  const at = (x: number, z: number) => new THREE.Vector3(x, 1, z);

  it("fills on a click — nothing pours by itself — and only when it is near enough", () => {
    expect(fillTubeAction("fumeHood", 1, at(0.9, 0.2))).toBeNull();
    const near = fillTubeAction("fumeHood", 1, at(0.55, 0.2));
    expect(near).toMatchObject({ label: "Налить HNO₃ в пробирку", blocked: false, part: "jar" });
    expect(hoodTubes()[1].contents).toEqual([]);
    near!.run();
    expect(hoodTubes()[1].contents).toEqual(["hno3"]);
  });

  it("refuses a reagent the tube already has", () => {
    useTestTubeStorageStore.setState({ fumeHoodTestTubes: [tube("t0", "hno3"), tube("t1")] });
    expect(fillTubeAction("fumeHood", 0, at(0.55, 0.2))).toMatchObject({ blocked: true, label: "HNO₃ уже в пробирке" });
  });
});
