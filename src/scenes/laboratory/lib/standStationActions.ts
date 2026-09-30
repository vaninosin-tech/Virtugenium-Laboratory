import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useHeatingStore } from "./useHeatingStore";
import { useLabNoticeStore } from "./useLabNoticeStore";
import { useTubeReactionStore } from "./tubeReactions";
import { useTestTubeStorageStore, type TubeLocation } from "./useTestTubeStorageStore";

/**
 * Where the stand is working: on the workbench or in the fume hood. Null
 * while it is still in its cabinet or riding the tray — no station then.
 */
export function standLocation(): TubeLocation | null {
  const stand = useBunsenStandStorageStore.getState();
  if (stand.onFumeHood) return "fumeHood";
  if (stand.onWorkbench) return "workbench";
  return null;
}

/**
 * A cracked tube is thrown away: a clean empty one goes into the clamp in
 * its place, the clamp goes back onto the stand, and the glass starts cold.
 * The player fills the new tube again from the bottles at hand.
 */
export function replaceCrackedTube(): void {
  const location = standLocation();
  const index = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
  if (location !== null && index !== null) {
    const list =
      location === "workbench"
        ? useTestTubeStorageStore.getState().workbenchTestTubes
        : useTestTubeStorageStore.getState().fumeHoodTestTubes;
    const old = list[index];
    useTestTubeStorageStore.getState().replaceWithEmptyTube(location, index);
    if (old) useTubeReactionStore.getState().clear(old.instanceId);
  }
  useHeatingStore.getState().reset();
  useLabNoticeStore
    .getState()
    .show("Треснувшую пробирку заменили чистой — наполните её заново", "info");
}
