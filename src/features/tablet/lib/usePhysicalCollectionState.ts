import { useBunsenStandStorageStore } from "../../../scenes/laboratory/lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../../../scenes/laboratory/lib/useBurnerStore";
import { useReagentStorageStore } from "../../../scenes/laboratory/lib/useReagentStorageStore";
import { useTestTubeStorageStore } from "../../../scenes/laboratory/lib/useTestTubeStorageStore";
import type { PhysicalCollectionState } from "./stageRequiredConfig";

/**
 * Derives `PhysicalCollectionState` from the real 3D pickup stores — a
 * reagent/test tube counts as physically taken once it has left its
 * cabinet shelf, whether it's still riding the held tray or already moved
 * to the workbench (both `useReagentStorageStore`/`useTestTubeStorageStore`
 * only drop an item once it's returned, not once it reaches the bench).
 */
export function usePhysicalCollectionState(): PhysicalCollectionState {
  const trayItems = useReagentStorageStore((state) => state.trayItems);
  const workbenchItems = useReagentStorageStore((state) => state.workbenchItems);
  const trayTestTubes = useTestTubeStorageStore((state) => state.trayTestTubes);
  const workbenchTestTubes = useTestTubeStorageStore((state) => state.workbenchTestTubes);
  const fumeHoodItems = useReagentStorageStore((state) => state.fumeHoodItems);
  const fumeHoodTestTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const standTaken = useBunsenStandStorageStore((state) => state.onTray || state.onWorkbench || state.onFumeHood);
  const lampTaken = useBurnerStore((state) => state.place !== "shelf");

  // The fume hood counts too: carrying things on into it must not un-collect them.
  return {
    takenReagentIds: [...trayItems, ...workbenchItems, ...fumeHoodItems].map((item) => item.reagentId),
    takenTestTubeCount: trayTestTubes.length + workbenchTestTubes.length + fumeHoodTestTubes.length,
    standTaken,
    lampTaken,
  };
}
