import * as THREE from "three";
import { create } from "zustand";

import { hoodWorldToLocal, HOOD_STAND_LOCAL } from "./hoodLayout";
import type { Position3 } from "./layout";
import type { StandAction } from "./standTableActions";
import { standBusy } from "./useStandMotionStore";
import { overTableTray } from "./tableTray";
import { lampToTray, standToTray } from "./trayCarry";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useFurniturePositionStore } from "./useFurniturePositionStore";
import { useHandStore, takeIntoHand, type HeldItem } from "./useHandStore";
import { useHeatingStore } from "./useHeatingStore";
import { useLabNoticeStore } from "./useLabNoticeStore";
import type { TubeLocation } from "./useTestTubeStorageStore";
import { activeWorktopZones } from "./worktopBounds";

/** The worktop obstacles the stand and the lamp are (`StandStation`, `SpiritBurner`) — what they are kept off. */
export const STAND_OBSTACLE_ID = "stand-base";
export const LAMP_OBSTACLE_ID = "spirit-burner";

/** A flat spot on a worktop: table-local at the table, hood-local in the hood (X, Z). */
export interface Spot {
  readonly x: number;
  readonly z: number;
}

/**
 * Where the player has set the stand and the lamp down (VL-018). `null` — the
 * place they come to by themselves: the stand on the table keeps its own
 * persisted spot (`useBunsenStandStorageStore.tablePosition`); the rest start
 * at their default and stay wherever they were last put.
 */
interface EquipmentPlacementState {
  readonly standHood: Spot | null;
  readonly lampTable: Spot | null;
  readonly lampHood: Spot | null;
  place: (what: "stand" | "lamp", location: TubeLocation, world: THREE.Vector3) => void;
}

export const useEquipmentPlacementStore = create<EquipmentPlacementState>((set) => ({
  standHood: null,
  lampTable: null,
  lampHood: null,
  place: (what, location, world) => {
    if (location === "workbench") {
      const [tx, , tz] = useFurniturePositionStore.getState().getOverride("table").position;
      const spot = { x: world.x - tx, z: world.z - tz };
      if (what === "stand") useBunsenStandStorageStore.getState().setTablePosition(spot.x, spot.z);
      else set({ lampTable: spot });
      return;
    }
    const [x, , z] = hoodWorldToLocal(world);
    if (what === "stand") set({ standHood: { x, z } });
    else set({ lampHood: { x, z } });
  },
}));

/** The hood-local default of the stand, and (for the lamp) where `lampLayout` puts it beside the stand — see `FumeHoodWorkArea`. */
export const DEFAULT_HOOD_STAND: Spot = { x: HOOD_STAND_LOCAL[0], z: HOOD_STAND_LOCAL[2] };

/** When the last piece of equipment was set down: its carrier must not glide it back to where it was lifted from. */
export const EQUIPMENT_PLACED = { at: 0 };

/** Whether `point` is over the tray at `place` — the table's, or the hood's. */
export function overTrayAt(place: TubeLocation, point: THREE.Vector3): boolean {
  if (place === "workbench") return overTableTray(point);
  const found = activeWorktopZones().find((zone) => zone.id === "hood-tray");
  if (!found) return false;
  const { object, minX, maxX, minZ, maxZ } = found.rect;
  const local = object.worldToLocal(point.clone());
  return local.x > minX && local.x < maxX && local.z > minZ && local.z < maxZ;
}

const instanceIdOf = (what: "stand" | "lamp") => (what === "stand" ? STAND_OBSTACLE_ID : LAMP_OBSTACLE_ID);

/** Takes the stand or the lamp into the hand (the right button, on it). False if it cannot be carried now. */
export function takeEquipment(what: "stand" | "lamp", location: TubeLocation): boolean {
  if (useHandStore.getState().held || standBusy() || useHeatingStore.getState().active) return false;
  if (what === "lamp" && useBurnerStore.getState().phase !== "capped") {
    useLabNoticeStore.getState().show("Сначала закройте спиртовку колпачком", "refusal");
    return false;
  }
  return takeIntoHand({ kind: "equipment", what, location, instanceId: instanceIdOf(what) }, [0, 0, 0]);
}

/** What a click does with the stand or the lamp in the hand, at `point` over the worktop. */
export function equipmentHandAction(
  held: Extract<HeldItem, { kind: "equipment" }>,
  point: THREE.Vector3,
  placeAt: THREE.Vector3,
): StandAction {
  const { what, location } = held;
  const subject = { kind: what === "stand" ? "stand" : "lamp", place: location } as const;
  if (overTrayAt(location, point)) {
    const clamped = what === "stand" && useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
    if (clamped) return { label: "Сначала выньте пробирку из лапки", blocked: true, part: "tray", run: () => {}, subject };
    return {
      label: "Поставить на поднос",
      blocked: false,
      part: "tray",
      subject,
      run: () => void (what === "stand" ? standToTray(location) : lampToTray(location)),
    };
  }
  return {
    label: location === "workbench" ? "Поставить сюда" : "Поставить сюда, в вытяжном шкафу",
    blocked: false,
    part: "place",
    subject,
    run: () => {
      EQUIPMENT_PLACED.at = Date.now();
      useEquipmentPlacementStore.getState().place(what, location, placeAt);
    },
  };
}

/** The hood-local default spot of the lamp: beside the stand's default (`lampLayout` in the stand's turned frame). */
export function hoodLampDefault(standFrame: Position3, standYaw: number, lampInStandFrame: Position3): Spot {
  const offset = new THREE.Vector3(...lampInStandFrame).applyAxisAngle(new THREE.Vector3(0, 1, 0), standYaw);
  return { x: standFrame[0] + offset.x, z: standFrame[2] + offset.z };
}
