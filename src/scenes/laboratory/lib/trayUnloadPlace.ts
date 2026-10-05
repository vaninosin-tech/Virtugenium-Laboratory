import { bottleFromTray, lampFromTray, standFromTray, tubeFromTray, unloadLabel, type CarryPlace } from "./trayCarry";
import type { StandAction } from "./standTableActions";
import { takeIntoHand, type HeldItem } from "./useHandStore";
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
  if (!trayUnloadPlace()) return false;
  useStandHintStore.getState().hide(instanceId);
  takeIntoHand({ kind: "tray", what, instanceId }, [0, 0, 0]);
  return true;
}

/** What a click does with something taken off the tray: set it down in its usual place where the player stands. */
export function trayHandAction(held: Extract<HeldItem, { kind: "tray" }>): StandAction | null {
  const place = trayUnloadPlace();
  if (!place) return null;
  return {
    label: unloadLabel(place),
    blocked: false,
    part: "tray",
    run: () => {
      if (held.what === "bottle") bottleFromTray(held.instanceId, place);
      else if (held.what === "tube") tubeFromTray(held.instanceId, place);
      else if (held.what === "stand") standFromTray(place);
      else lampFromTray(place);
    },
  };
}
