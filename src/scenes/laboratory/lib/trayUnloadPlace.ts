import type * as THREE from "three";

import { bottleFromTray, lampFromTray, standFromTray, tubeFromTray, unloadLabel, type CarryPlace } from "./trayCarry";
import type { StandAction } from "./standTableActions";
import { HAND, takeIntoHand, type HeldItem } from "./useHandStore";
import { standBusy, useStandMotionStore } from "./useStandMotionStore";
import { nearClamp } from "./standTableActions";
import { standLocation } from "./standStationActions";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useHeatingStore } from "./useHeatingStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";
import { useWorkbenchReservationStore } from "./workbenchLayout";
import { useSceneInteractionStore } from "./useSceneInteractionStore";
import { useStandHintStore } from "./useStandHintStore";
import { worktopZoneAt } from "./worktopBounds";

const FUME_HOOD_ID = "fume-hood";

/**
 * Where something taken off the tray would be put down, from where the
 * player stands: at the table — on it; at the fume hood — in it. Null
 * elsewhere (in a cabinet a tray item goes back to its shelf instead).
 */
export function trayUnloadPlace(): CarryPlace | null {
  const scene = useSceneInteractionStore.getState();
  if (scene.activeTargetId === "table" && scene.cabinetPhase === "room") return "workbench";
  if (scene.focusedCabinetId === FUME_HOOD_ID && scene.cabinetPhase === "inspecting") return "fumeHood";
  return null;
}

/** The hover caption for something on the tray at the table or the hood. */
export const TAKE_FROM_TRAY = "Взять с подноса";

/**
 * Takes something on the tray into the hand, to be set down in its usual
 * place where the player stands (VL-017). Clicked at the table or the hood.
 */
export function takeFromTray(what: "bottle" | "tube" | "stand" | "lamp", instanceId: string): boolean {
  if (!trayUnloadPlace()) return false;
  useStandHintStore.getState().hide(instanceId);
  takeIntoHand({ kind: "tray", what, instanceId }, [0, 0, 0]);
  return true;
}

/**
 * What a click does with something taken off the tray: set it down in its
 * usual place where the player stands. Over the tray it came from — nothing:
 * let go there, it goes back onto the tray (the tray is its own place).
 *
 * @param point the hand over the worktop, when known
 */
export function trayHandAction(held: Extract<HeldItem, { kind: "tray" }>, point?: THREE.Vector3): StandAction | null {
  const place = trayUnloadPlace();
  if (!place) return null;
  // A tube brought to the empty clamp where the player stands goes into it — its use there before any placing.
  if (held.what === "tube" && point && nearClamp(point) && standLocation() === place) {
    if (useBunsenStandStorageStore.getState().attachedTubeSlotIndex === null) {
      return {
        label: "Закрепить пробирку в лапке штатива",
        blocked: standBusy() || useHeatingStore.getState().active,
        run: (origin) => {
          if (!tubeFromTray(held.instanceId, place)) return;
          const list = useTestTubeStorageStore.getState();
          const index = (place === "workbench" ? list.workbenchTestTubes : list.fumeHoodTestTubes).length - 1;
          useBunsenStandStorageStore.getState().attachTestTube(index, origin ?? [0, 0, 0]);
          if (origin) useStandMotionStore.getState().arriveInClamp(origin);
        },
      };
    }
  }
  if (point && worktopZoneAt(point) === (place === "workbench" ? "table-tray" : "hood-tray")) return null;
  return {
    label: unloadLabel(place),
    blocked: false,
    part: "tray",
    run: (origin) => {
      if (held.what === "bottle") {
        // Into the row at the slot kept for it (`workbenchLayout`) — where its outline stood and the others made room.
        const reserved = useWorkbenchReservationStore.getState().reserved;
        const index = place === "workbench" && reserved?.instanceId === held.instanceId ? reserved.index : undefined;
        bottleFromTray(held.instanceId, place, index);
        // In the same update as the bottle itself, so the row never counts it twice.
        useWorkbenchReservationStore.getState().clear();
      } else if (held.what === "tube") tubeFromTray(held.instanceId, place);
      else {
        if (held.what === "stand") standFromTray(place);
        else lampFromTray(place);
        // Seen going from the hand into its place, turning as it goes — not appearing there (`ArrivalFlight`).
        if (origin && HAND.itemPosValid) {
          const { x, y, z, w } = HAND.itemQuat;
          useStandMotionStore.getState().arriveEquipment(held.what, origin, [x, y, z, w]);
        }
      }
    },
  };
}
