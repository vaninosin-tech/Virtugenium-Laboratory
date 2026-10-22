import { lampFromTray, lampToTray, standFromTray, standToTray, type CarryPlace } from "./trayCarry";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useHeatingStore } from "./useHeatingStore";

/**
 * The stand and the spirit lamp carry themselves: coming to the table or the
 * hood sets them down there off the tray, leaving takes them back onto it.
 * Bottles and tubes stay the player's to take (VL-017/018).
 *
 * Leaving leaves behind whatever is in use — a stand with a tube in its
 * clamp, a lamp while it is heated over — rather than refusing with a notice
 * on every walk away.
 */
export function autoCarryStep(left: CarryPlace | null, arrived: CarryPlace | null): void {
  if (left) {
    const stand = useBunsenStandStorageStore.getState();
    const standHere = left === "workbench" ? stand.onWorkbench : stand.onFumeHood;
    if (standHere && stand.attachedTubeSlotIndex === null) standToTray(left);
    if (useBurnerStore.getState().place === left && !useHeatingStore.getState().active) lampToTray(left);
  }
  if (arrived) {
    if (useBunsenStandStorageStore.getState().onTray) standFromTray(arrived);
    if (useBurnerStore.getState().place === "tray") lampFromTray(arrived);
  }
}
