import type * as THREE from "three";

import type { Position3 } from "./layout";
import { overTableTray } from "./tableTray";
import { lampToTray, standToTray } from "./trayCarry";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useFurniturePositionStore } from "./useFurniturePositionStore";
import { HAND, takeIntoHand, useHandStore, type HeldItem } from "./useHandStore";
import { useHeatingStore } from "./useHeatingStore";
import { standBusy, useStandMotionStore } from "./useStandMotionStore";

/**
 * The stand and the spirit lamp on the table are carried in the hand like
 * everything else (VL-018): taken with a press-and-drag (`pressToTake`),
 * they follow the hand (`PourMotion`), and — let go — the stand stays where
 * it is let go on the table or goes onto the tray, the lamp goes onto the
 * tray or back to its own spot. Set down on the tray, each is seen going
 * from the hand into its place there (`ArrivalFlight`).
 */

type Equipment = Extract<HeldItem, { kind: "equipment" }>;

/** Their ids in the hand (and of the `PourMotion` that carries each). */
export const EQUIPMENT_INSTANCE = { stand: "workbench-stand", lamp: "workbench-lamp" } as const;

/**
 * The stand's and the lamp's own obstacles (`worktopBounds`) — what the hand
 * must not keep the carried one off, or it would be pushed off itself.
 */
export function carriedObstacleIds(held: HeldItem): readonly string[] {
  // The clamp carries the clamped tube, and rests beside the stand's base.
  if (held.kind === "clamp") return ["clamped-tube", "stand-base"];
  if (held.kind !== "equipment") return [];
  return held.what === "stand" ? ["stand-base", "clamped-tube"] : ["spirit-burner"];
}

/** Whether it may be taken off the table now: the lamp only cold and capped (a burning lamp is not carried). */
export function canTakeEquipment(what: Equipment["what"]): boolean {
  if (useHandStore.getState().held || standBusy() || useHeatingStore.getState().active) return false;
  if (what === "stand") return useBunsenStandStorageStore.getState().onWorkbench;
  const burner = useBurnerStore.getState();
  return burner.place === "workbench" && !burner.lit && burner.phase === "capped";
}

/** Takes the stand or the lamp off the table into the hand. */
export function takeEquipment(what: Equipment["what"]): boolean {
  if (!canTakeEquipment(what)) return false;
  takeIntoHand({ kind: "equipment", what, location: "workbench", instanceId: EQUIPMENT_INSTANCE[what] }, [0, 0, 0]);
  return true;
}

/** Whether it may go onto the tray now: the stand not with a tube in its clamp (it would ride the tray unseen). */
export function equipmentMayGoOnTray(held: Equipment): boolean {
  return held.what === "lamp" || useBunsenStandStorageStore.getState().attachedTubeSlotIndex === null;
}

const NOTHING = () => {};

/** Seen going from the hand into its place, turning as it goes. */
function arriveFromHand(what: Equipment["what"], origin: Position3 | undefined): void {
  if (!origin || !HAND.itemPosValid) return;
  const { x, y, z, w } = HAND.itemQuat;
  useStandMotionStore.getState().arriveEquipment(what, origin, [x, y, z, w]);
}

/**
 * What letting go of the carried stand or lamp at `point` does: over the
 * table's tray — onto the tray; elsewhere on the table — the stand stays
 * there, the lamp goes back to its spot (null: put back).
 */
export function equipmentHandAction(
  held: Equipment,
  point: THREE.Vector3,
): { readonly label: string; readonly blocked: boolean; readonly part: "tray" | "place"; readonly run: (origin?: Position3) => void } | null {
  if (overTableTray(point)) {
    if (!equipmentMayGoOnTray(held)) {
      return { label: "Сначала выньте пробирку из лапки штатива", blocked: true, part: "tray", run: NOTHING };
    }
    return {
      label: "Поставить на поднос",
      blocked: false,
      part: "tray",
      run: (origin) => {
        const done = held.what === "stand" ? standToTray("workbench") : lampToTray("workbench");
        if (done) arriveFromHand(held.what, origin);
      },
    };
  }
  if (held.what === "lamp") return null;
  return {
    label: "Поставить сюда",
    blocked: false,
    part: "place",
    // Where it is drawn now, on the table — as the stand's own drag on the table used to set it.
    run: (origin) => {
      if (!origin) return;
      const [tx, , tz] = useFurniturePositionStore.getState().getOverride("table").position;
      useBunsenStandStorageStore.getState().setTablePosition(origin[0] - tx, origin[2] - tz);
    },
  };
}
