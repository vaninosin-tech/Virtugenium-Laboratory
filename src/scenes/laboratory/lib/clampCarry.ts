import { standLocation } from "./standStationActions";
import { takeIntoHand, useHandStore, type HeldItem } from "./useHandStore";
import { useHeatingStore } from "./useHeatingStore";
import { standBusy } from "./useStandMotionStore";

/**
 * The stand's clamp is taken off the stand into the hand, with whatever tube
 * is in it (the tube stays clamped — the clamp's own child, `StandStation`).
 * Brought to the lamp's flame it heats the tube there — the same heating a
 * click on the lamp starts (`standActionFor` burner), the clamp held in the
 * flame as it always is (`heldClampPose`); let go anywhere else, it goes back
 * onto the stand (`standTableActions`' `handActionFor`).
 */

type Clamp = Extract<HeldItem, { kind: "clamp" }>;

/** The clamp's id in the hand (and of the `PourMotion` that carries it). */
export const CLAMP_INSTANCE = "stand-clamp";

/** Takes the clamp off the stand at `location` into the hand. */
export function takeClamp(location: Clamp["location"]): boolean {
  if (useHandStore.getState().held || standBusy() || useHeatingStore.getState().active) return false;
  if (standLocation() !== location) return false;
  takeIntoHand({ kind: "clamp", location, instanceId: CLAMP_INSTANCE }, [0, 0, 0]);
  return true;
}
