import type { CarryPlace } from "./trayCarry";
import { useSceneInteractionStore } from "./useSceneInteractionStore";

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
