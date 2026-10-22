import { create } from "zustand";

import { getTrayItemObjects } from "./itemPreview/itemObjects";
import { shownInWorld } from "./worktopBounds";
import { notePlacedFrom } from "./placedFrom";
import { bottleFromTray, lampFromTray, standFromTray, tubeFromTray, type CarryPlace } from "./trayCarry";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { isHeld, useHandStore } from "./useHandStore";
import { useReagentStorageStore } from "./useReagentStorageStore";
import { useStandMotionStore } from "./useStandMotionStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";
import type { Position3 } from "./layout";
import * as THREE from "three";

/**
 * «Выгрузить поднос» (VL-021): everything on the tray leaves it one after
 * another — each flies from its place on the tray to its place on the table
 * or in the hood — instead of all appearing there at once.
 *
 * The flight itself is the one a single item makes when it is set down from
 * the hand (`notePlacedFrom` → `PourMotion`: a low arc, eased, 0.3–0.7 s; a
 * tube: `arriveInRack` → `ArrivalFlight`), so a stack of them looks like the
 * same thing happening to each, and the destination is whatever place the
 * stores give it (`trayCarry`) — there is no second idea of «where it goes».
 * An item cannot move between two React parents, so the tray's copy goes and
 * the placed one takes over flying from exactly where the tray's stood.
 *
 *   idle → unloading (items start one by one) → idle
 */

/** Between one item's start and the next's. */
export const UNLOAD_STAGGER_MS = 90;
/** The longest a bottle's flight takes (`PourMotion`'s `homeSeconds` ceiling) — when the last one has surely landed. */
const FLIGHT_MAX_MS = 700;

interface TrayUnloadState {
  readonly phase: "idle" | "unloading";
}

export const useTrayUnloadStore = create<TrayUnloadState>(() => ({ phase: "idle" }));

type Step = () => void;

const originOf = (id: string): Position3 | null => {
  let object: THREE.Object3D | null = null;
  for (const candidate of getTrayItemObjects(id) ?? []) if (shownInWorld(candidate)) object = candidate;
  if (!object) return null;
  const at = object.getWorldPosition(new THREE.Vector3());
  return [at.x, at.y, at.z];
};

/** One step per thing on the tray, bottles first, in the order they are listed. */
function stepsFor(place: CarryPlace): Step[] {
  const steps: Step[] = [];
  for (const item of useReagentStorageStore.getState().trayItems) {
    steps.push(() => {
      // The hand has it, or it already left: not this unload's to move.
      if (isHeld(item.instanceId)) return;
      const origin = originOf(item.instanceId);
      if (bottleFromTray(item.instanceId, place) && origin) notePlacedFrom(item.instanceId, origin);
    });
  }
  for (const tube of useTestTubeStorageStore.getState().trayTestTubes) {
    steps.push(() => {
      if (isHeld(tube.instanceId)) return;
      const origin = originOf(tube.instanceId);
      if (!tubeFromTray(tube.instanceId, place) || !origin) return;
      const state = useTestTubeStorageStore.getState();
      const tubes = place === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
      useStandMotionStore.getState().arriveInRack(place, tubes.length - 1, origin);
    });
  }
  // Each on its own: the lamp no longer rides with the stand (VL-020).
  if (useBunsenStandStorageStore.getState().onTray) steps.push(() => void standFromTray(place));
  if (useBurnerStore.getState().place === "tray") steps.push(() => void lampFromTray(place));
  return steps;
}

/** Starts unloading the tray down to `place`. A second press while it runs does nothing. */
export function unloadTrayAnimated(place: CarryPlace): void {
  if (useTrayUnloadStore.getState().phase !== "idle") return;
  // Something taken off the tray is in the hand: it is not unloaded from under it.
  if (useHandStore.getState().held) return;
  const steps = stepsFor(place);
  if (steps.length === 0) return;
  useTrayUnloadStore.setState({ phase: "unloading" });
  // Nothing at the stand can be clicked until the last one has landed.
  const total = (steps.length - 1) * UNLOAD_STAGGER_MS + FLIGHT_MAX_MS;
  useStandMotionStore.getState().hold(total);
  steps.forEach((step, index) => setTimeout(step, index * UNLOAD_STAGGER_MS));
  setTimeout(() => useTrayUnloadStore.setState({ phase: "idle" }), total);
}
