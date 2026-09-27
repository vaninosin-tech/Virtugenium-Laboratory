import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useReagentStorageStore } from "./useReagentStorageStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";

export interface FumeHoodTransferSelection {
  readonly reagentInstanceIds: readonly string[];
  readonly tubeInstanceIds: readonly string[];
  readonly includeStand: boolean;
}

/**
 * The one place the three location stores are moved together.
 *
 * The stand is not an independent item: a tube clamped in its ring travels
 * WITH it, and `attachedTubeSlotIndex` is an index into whichever list the
 * tube currently lives in (workbench vs fume hood), so the clamp has to be
 * re-pointed in the same operation or it would silently reference a
 * different tube — or nothing at all.
 */
export function transferSelectionToFumeHood(selection: FumeHoodTransferSelection): void {
  const standState = useBunsenStandStorageStore.getState();
  const tubeState = useTestTubeStorageStore.getState();

  const clampedTube =
    selection.includeStand && standState.attachedTubeSlotIndex !== null
      ? tubeState.workbenchTestTubes[standState.attachedTubeSlotIndex]
      : undefined;

  const movingTubeIds = new Set(selection.tubeInstanceIds);
  if (clampedTube) movingTubeIds.add(clampedTube.instanceId);

  // Computed before the move, against the same filter order the store uses.
  const movingInOrder = tubeState.workbenchTestTubes.filter((tube) =>
    movingTubeIds.has(tube.instanceId),
  );
  const clampedPosition = clampedTube
    ? movingInOrder.findIndex((tube) => tube.instanceId === clampedTube.instanceId)
    : -1;
  const remappedIndex =
    clampedPosition >= 0 ? tubeState.fumeHoodTestTubes.length + clampedPosition : null;

  if (movingTubeIds.size > 0) {
    useTestTubeStorageStore.getState().transferTestTubesToFumeHood([...movingTubeIds]);
  }
  if (selection.reagentInstanceIds.length > 0) {
    useReagentStorageStore.getState().transferReagentsToFumeHood(selection.reagentInstanceIds);
  }
  if (selection.includeStand) {
    useBunsenStandStorageStore.getState().transferStandToFumeHood();
    useBunsenStandStorageStore.getState().remapAttachedTube(remappedIndex);
  }
}

export interface FumeHoodContents {
  readonly reagentIds: readonly string[];
  readonly tubeContents: readonly (readonly string[])[];
  readonly hasStand: boolean;
}

/** What is currently inside the hood — the shape step requirements ask about. */
export function readFumeHoodContents(): FumeHoodContents {
  return {
    reagentIds: useReagentStorageStore.getState().fumeHoodItems.map((item) => item.reagentId),
    tubeContents: useTestTubeStorageStore
      .getState()
      .fumeHoodTestTubes.map((tube) => tube.contents),
    hasStand: useBunsenStandStorageStore.getState().onFumeHood,
  };
}
