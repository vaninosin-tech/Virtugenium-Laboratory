import type * as THREE from "three";
import { create } from "zustand";

import { heatInHandAction, jarPourAction, nearFlame, standActionFor, type StandTarget } from "./standTableActions";
import { JAR_AIM } from "./pourSources";
import { standLocation } from "./standStationActions";
import { WORKBENCH_CARRY } from "./tableTray";
import { WORKBENCH_TUBE_DROP } from "./workbenchTubeDrop";
import { useHeatingStore } from "./useHeatingStore";
import { standBusy } from "./useStandMotionStore";
import { trayUnloadPlace } from "./trayUnloadPlace";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import type { HandAim, HeldItem } from "./useHandStore";
import { nextFreeTraySlot, useReagentStorageStore } from "./useReagentStorageStore";
import { useTestTubeDragStore } from "./useTestTubeDragStore";
import { TEST_TUBE_TRAY_CAPACITY, useTestTubeStorageStore, type TubeLocation } from "./useTestTubeStorageStore";
import { activeWorktopZones } from "./worktopBounds";
import { equipmentMayGoOnTray } from "./equipmentCarry";
import type { WorktopZoneId } from "./useWorktopZoneStore";

/**
 * Where a carried item may go, and what it may do there — the one place that
 * decides it for the highlights shown while something is in the hand.
 * Semantic only: the colours are the UI's business (`dragHighlightStyle`).
 *
 * - CURRENT_DROP_ZONE — the item's own place: let go here, it stays there.
 * - AVAILABLE_DROP_ZONE — another place it may be moved to.
 * - AVAILABLE_INTERACTION — it can be used here right now.
 * - BLOCKED_INTERACTION — it is used here, but not now (a step first, the
 *   stand busy, nothing to heat…).
 * - NONE — the target has nothing to do with this item.
 *
 * Interaction outranks placement. Nothing is stored about where the item
 * "is": its place is read from the stores that already hold it (the bench,
 * the tray, the hood), so after a drop the next take resolves anew.
 */
export type DragTargetState =
  | "NONE"
  | "CURRENT_DROP_ZONE"
  | "AVAILABLE_DROP_ZONE"
  | "AVAILABLE_INTERACTION"
  | "BLOCKED_INTERACTION";

/** The worktops and trays (`WorktopZoneId`), the racks, and the stand's and lamp's interaction spots. */
export type DragTargetId =
  | WorktopZoneId
  | "workbench-rack"
  | "fume-hood-rack"
  /** The stand's clamp while it is empty. */
  | "clamp"
  /** The tube standing in the clamp. */
  | "clamped-tube"
  /** The spirit lamp's flame. */
  | "flame"
  /** The bottle a held tube is brought to, to be poured into (`JAR_AIM`). */
  | "reagent";

export const DRAG_TARGET_IDS: readonly DragTargetId[] = [
  "table",
  "table-tray",
  "fume-hood",
  "hood-tray",
  "workbench-rack",
  "fume-hood-rack",
  "clamp",
  "clamped-tube",
  "flame",
  "reagent",
];

export type DragTargetStates = Readonly<Record<DragTargetId, DragTargetState>>;

/** Where the item is carried at: the bench or the hood; null — nowhere it can be set down. */
function placeOf(held: HeldItem): TubeLocation | null {
  if (held.kind === "bottle") return held.location;
  if (held.kind === "tube") return held.location;
  if (held.kind === "workbench-tube") return "workbench";
  if (held.kind === "equipment" || held.kind === "clamp") return held.location;
  return trayUnloadPlace();
}

const TRAY_OF: Record<TubeLocation, WorktopZoneId> = { workbench: "table-tray", fumeHood: "hood-tray" };
const WORKTOP_OF: Record<TubeLocation, WorktopZoneId> = { workbench: "table", fumeHood: "fume-hood" };

/** The item's own place — its "current container". */
export function currentDropZone(held: HeldItem): DragTargetId | null {
  const place = placeOf(held);
  if (!place) return null;
  if (held.kind === "tray") return TRAY_OF[place];
  // The clamp's own place is on the stand.
  if (held.kind === "clamp") return "clamp";
  if (held.kind === "workbench-tube") return "workbench-rack";
  if (held.kind === "tube") return "fume-hood-rack";
  return WORKTOP_OF[place];
}

const zoneInPlay = (id: WorktopZoneId): boolean => activeWorktopZones().some((zone) => zone.id === id);

/** Whether letting the item go over `target` moves it there — the moves the hand already makes, nothing more. */
function isDropZoneFor(held: HeldItem, target: DragTargetId): boolean {
  if (target === currentDropZone(held)) return true;
  const place = placeOf(held);
  if (!place) return false;
  switch (held.kind) {
    // A bottle from the bench onto the tray on the table (`handActionFor`).
    case "bottle":
      return (
        place === "workbench" &&
        target === "table-tray" &&
        zoneInPlay("table-tray") &&
        nextFreeTraySlot(useReagentStorageStore.getState().trayItems) >= 0
      );
    // A tube from the hood's rack onto the tray there (`handActionFor`).
    case "tube":
      return (
        target === "hood-tray" &&
        zoneInPlay("hood-tray") &&
        useTestTubeStorageStore.getState().trayTestTubes.length < TEST_TUBE_TRAY_CAPACITY
      );
    // A rack tube onto the tray on the table (`InspectableTestTubeSlot`).
    case "workbench-tube":
      return (
        target === "table-tray" &&
        zoneInPlay("table-tray") &&
        useTestTubeStorageStore.getState().trayTestTubes.length < TEST_TUBE_TRAY_CAPACITY
      );
    // Off the tray: set down on the worktop where the player stands (`trayHandAction`).
    case "tray":
      return target === WORKTOP_OF[place];
    // The stand or the lamp off the table, onto the tray there (`equipmentCarry`).
    case "equipment":
      return target === "table-tray" && zoneInPlay("table-tray") && equipmentMayGoOnTray(held);
    default:
      return false;
  }
}

/** The held item as the stand sees it (`standActionFor`). */
function asStandTarget(held: HeldItem): StandTarget | null {
  if (held.kind === "bottle") {
    return { kind: "bottle", location: held.location, reagentId: held.reagentId, instanceId: held.instanceId };
  }
  if (held.kind === "tube") return { kind: "rack-tube", location: held.location, index: held.index };
  if (held.kind === "workbench-tube") return { kind: "rack-tube", location: "workbench", index: held.index };
  return null;
}

/**
 * Whether the item is used at `target` at all and, if so, whether right now.
 * Null: no interaction between them.
 */
function interactionWith(held: HeldItem, target: DragTargetId): { readonly available: boolean } | null {
  // A tube off the tray goes into the empty clamp where the player stands (`trayHandAction`).
  if (held.kind === "tray") {
    const place = placeOf(held);
    if (held.what !== "tube" || target !== "clamp" || !place || standLocation() !== place) return null;
    if (useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null) return null;
    return { available: !standBusy() && !useHeatingStore.getState().active };
  }
  // The clamp carried, with its tube, to the lamp's flame: heated there as a click on the lamp would.
  if (held.kind === "clamp") {
    if (target !== "flame" || useBurnerStore.getState().place !== held.location) return null;
    if (useBunsenStandStorageStore.getState().attachedTubeSlotIndex === null) return null;
    const heat = standActionFor({ kind: "burner" });
    return { available: !!heat && !heat.blocked };
  }
  // A held tube brought to a bottle: the bottle pours into it.
  if (target === "reagent") {
    if (!JAR_AIM.source) return null;
    const pour = jarPourAction(held, JAR_AIM.source);
    return pour ? { available: !pour.blocked } : null;
  }
  const standTarget = asStandTarget(held);
  if (!standTarget || standTarget.kind === "clamped-tube" || standTarget.kind === "burner") return null;
  const location = standTarget.location;
  const isTube = standTarget.kind === "rack-tube";

  if (target === "flame") {
    // Only a bare tube is heated in the hand, and only by the lamp where it is.
    if (!isTube || useBurnerStore.getState().place !== location) return null;
    const heat = heatInHandAction(location, standTarget.index);
    return { available: !!heat && !heat.blocked };
  }

  if (target !== "clamp" && target !== "clamped-tube") return null;
  // The stand is not where the item is: nothing to do with it.
  if (standLocation() !== location) return null;
  const clampTaken = useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
  // The empty clamp: a tube goes into it; a bottle would pour into it, but there is no tube yet.
  // The tube in the clamp: a bottle or a tube pours into it.
  if (target === "clamp" ? clampTaken : !clampTaken) return null;
  if (target === "clamp" && !isTube) return { available: false };
  // Busy, heating, a reagent this experiment does not use, nothing to pour — all "not now".
  const action = standActionFor(standTarget, { fromHand: true });
  return { available: !!action && !action.blocked };
}

/** The state of one target for the item in the hand, from the stores as they are now. */
export function getDragTargetState(held: HeldItem, target: DragTargetId): DragTargetState {
  const interaction = interactionWith(held, target);
  if (interaction) return interaction.available ? "AVAILABLE_INTERACTION" : "BLOCKED_INTERACTION";
  if (isDropZoneFor(held, target)) return target === currentDropZone(held) ? "CURRENT_DROP_ZONE" : "AVAILABLE_DROP_ZONE";
  return "NONE";
}

export function resolveDragTargets(held: HeldItem): DragTargetStates {
  return Object.fromEntries(DRAG_TARGET_IDS.map((id) => [id, getDragTargetState(held, id)])) as Record<
    DragTargetId,
    DragTargetState
  >;
}

/**
 * Which target letting go right now would go to — drawn brighter than the
 * rest. Read from what the hand already worked out this frame (its action and
 * aim, the rack carry's own flags), not worked out again.
 */
export function hoveredDragTarget(
  held: HeldItem,
  action: { readonly blocked: boolean; readonly part?: "tray" | "place" } | null,
  aim: HandAim | null,
  point: THREE.Vector3 | null,
): DragTargetId | null {
  const clampTaken = useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
  const atStand = (): DragTargetId => (clampTaken ? "clamped-tube" : "clamp");
  // A held tube at a bottle: that use first.
  if ((held.kind === "workbench-tube" || held.kind === "tube") && JAR_AIM.source) return "reagent";
  // The clamp: at the flame, heated there; anywhere else, back onto the stand.
  if (held.kind === "clamp") return point && nearFlame(held.location, point) ? "flame" : "clamp";
  if (held.kind === "workbench-tube") {
    if (WORKBENCH_CARRY.nearFlame && useBurnerStore.getState().place === "workbench") return "flame";
    if (WORKBENCH_TUBE_DROP.nearRing && !clampTaken) return "clamp";
    if (WORKBENCH_CARRY.overTray) return "table-tray";
    if (useTestTubeDragStore.getState().isNearHolder) return "workbench-rack";
    return null;
  }
  if (held.kind === "tray") {
    const place = placeOf(held);
    if (!place) return null;
    if (!action || action.blocked) return TRAY_OF[place];
    // Set down off the tray, or (a tube) into the clamp.
    return action.part === "tray" ? WORKTOP_OF[place] : "clamp";
  }
  if (held.kind === "tube" && point && nearFlame(held.location, point)) return "flame";
  if (aim) return atStand();
  if (action?.part === "tray") {
    const place = placeOf(held);
    return place ? TRAY_OF[place] : null;
  }
  return currentDropZone(held);
}

const sameStates = (a: DragTargetStates | null, b: DragTargetStates | null): boolean =>
  a === b || (!!a && !!b && DRAG_TARGET_IDS.every((id) => a[id] === b[id]));

interface DragTargetStoreState {
  /** Null — nothing is carried, nothing is lit. */
  readonly states: DragTargetStates | null;
  readonly hovered: DragTargetId | null;
  /** Re-renders only when something actually changed. */
  publish: (states: DragTargetStates, hovered: DragTargetId | null) => void;
  clear: () => void;
}

/** Published by `HandController`: on taking (drag start), every frame while carried, cleared when let go. */
export const useDragTargetStore = create<DragTargetStoreState>((set) => ({
  states: null,
  hovered: null,
  publish: (states, hovered) =>
    set((state) =>
      sameStates(state.states, states) && state.hovered === hovered
        ? state
        : { states: sameStates(state.states, states) ? state.states : states, hovered },
    ),
  clear: () => set((state) => (state.states === null && state.hovered === null ? state : { states: null, hovered: null })),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __dragTargets?: unknown }).__dragTargets = { store: useDragTargetStore, resolveDragTargets };
}
