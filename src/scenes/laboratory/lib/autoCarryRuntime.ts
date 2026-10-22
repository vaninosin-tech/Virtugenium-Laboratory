import { autoCarryStep } from "./autoCarry";
import { trayUnloadPlace } from "./trayUnloadPlace";
import { useSceneInteractionStore } from "./useSceneInteractionStore";

/** Watches where the player stands and moves the stand and lamp on every change; returns the unsubscribe. */
export function startAutoCarry(): () => void {
  let previous = trayUnloadPlace();
  autoCarryStep(null, previous);
  return useSceneInteractionStore.subscribe(() => {
    const now = trayUnloadPlace();
    if (now === previous) return;
    const left = previous;
    previous = now;
    autoCarryStep(left, now);
  });
}
