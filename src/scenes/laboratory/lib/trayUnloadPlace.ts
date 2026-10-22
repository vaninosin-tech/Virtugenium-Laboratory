import { bottleFromTray, lampFromTray, standFromTray, tubeFromTray, unloadLabel, type CarryPlace } from "./trayCarry";
import type { StandAction } from "./standTableActions";
import { notePlacedFrom } from "./placedFrom";
import { takeIntoHand, useHandStore, type HeldItem } from "./useHandStore";
import { useStandMotionStore } from "./useStandMotionStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";
import { useSceneInteractionStore } from "./useSceneInteractionStore";
import { useStandHintStore } from "./useStandHintStore";

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
  if (!trayUnloadPlace() || useHandStore.getState().held) return false;
  useStandHintStore.getState().hide(instanceId);
  return takeIntoHand({ kind: "tray", what, instanceId }, [0, 0, 0]);
}

/** What a click does with something taken off the tray: set it down in its usual place where the player stands. */
export function trayHandAction(held: Extract<HeldItem, { kind: "tray" }>): StandAction | null {
  const place = trayUnloadPlace();
  if (!place) return null;
  return {
    label: unloadLabel(place),
    blocked: false,
    part: "tray",
    // `origin`: where the item is in the world, in the hand — it is seen flying from there to its place.
    run: (origin) => {
      if (held.what === "bottle") {
        if (bottleFromTray(held.instanceId, place) && origin) notePlacedFrom(held.instanceId, origin);
      } else if (held.what === "tube") {
        if (tubeFromTray(held.instanceId, place) && origin) {
          const tubes = place === "workbench" ? useTestTubeStorageStore.getState().workbenchTestTubes : useTestTubeStorageStore.getState().fumeHoodTestTubes;
          useStandMotionStore.getState().arriveInRack(place, tubes.length - 1, origin);
        }
      } else if (held.what === "stand") standFromTray(place);
      else lampFromTray(place);
    },
  };
}
