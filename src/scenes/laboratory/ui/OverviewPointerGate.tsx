import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";

/**
 * In the room overview nothing in the scene takes the mouse: no hover
 * highlight, no click on a jar, tube, stand or lamp on the workbench — the
 * player has to walk up to the table (or a cabinet) first. Getting there is
 * `CameraRig`'s own crosshair raycast, which doesn't go through these events.
 *
 * Done as the event system's `filter` (every hit dropped), not `enabled`:
 * `HandController` owns `enabled` while something is held, and an empty hit
 * list also makes the scene send `pointerout` to whatever was highlighted
 * when the player stepped back from the table.
 */
export function OverviewPointerGate() {
  const setEvents = useThree((state) => state.setEvents);

  useEffect(() => {
    setEvents({
      filter: (items) => {
        const { activeTargetId, cabinetPhase } = useSceneInteractionStore.getState();
        const inOverview = activeTargetId === "overview" && cabinetPhase === "room";
        return inOverview ? [] : items;
      },
    });
    return () => setEvents({ filter: undefined });
  }, [setEvents]);

  return null;
}
