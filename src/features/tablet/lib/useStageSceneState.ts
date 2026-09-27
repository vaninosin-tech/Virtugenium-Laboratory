import type { EntityId } from "../../../entities/laboratory";
import { useBunsenStandStorageStore } from "../../../scenes/laboratory/lib/useBunsenStandStorageStore";
import { useFumeHoodControlsStore } from "../../../scenes/laboratory/lib/useFumeHoodControlsStore";
import { useReagentStorageStore } from "../../../scenes/laboratory/lib/useReagentStorageStore";
import { useSceneInteractionStore } from "../../../scenes/laboratory/lib/useSceneInteractionStore";
import { useTestTubeStorageStore } from "../../../scenes/laboratory/lib/useTestTubeStorageStore";
import {
  getStageSceneRequirement,
  type SceneSnapshot,
  type StageSceneState,
} from "./stageSceneConfig";

export function useSceneSnapshot(): SceneSnapshot {
  const workbenchTubes = useTestTubeStorageStore((state) => state.workbenchTestTubes);
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const fumeHoodFanOn = useFumeHoodControlsStore(
    (state) => state.fanOnById["fume-hood"] ?? false,
  );
  const atFumeHood = useSceneInteractionStore((state) => state.activeTargetId === "fume-hood");
  // Selectors return the stored arrays as-is; mapping inside one would hand
  // `useSyncExternalStore` a fresh reference on every read and re-render forever.
  const fumeHoodItems = useReagentStorageStore((state) => state.fumeHoodItems);
  const fumeHoodTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const standInFumeHood = useBunsenStandStorageStore((state) => state.onFumeHood);

  return {
    workbenchTubes,
    attachedTubeSlotIndex,
    fumeHoodFanOn,
    atFumeHood,
    fumeHoodReagentIds: fumeHoodItems.map((item) => item.reagentId),
    fumeHoodTubeContents: fumeHoodTubes.map((tube) => tube.contents),
    standInFumeHood,
  };
}

/** `null` when this step has no scene condition at all — then the tablet alone decides. */
export function useStageSceneState(stepId: EntityId | null): StageSceneState | null {
  const snapshot = useSceneSnapshot();
  const requirement = getStageSceneRequirement(stepId);
  if (!requirement) return null;
  return { requirement, met: requirement.isMet(snapshot) };
}
