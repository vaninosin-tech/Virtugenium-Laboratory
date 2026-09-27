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

  return {
    takenReagentIds: [...trayItems, ...workbenchItems].map((item) => item.reagentId),
    takenTestTubeCount: trayTestTubes.length + workbenchTestTubes.length,
  };
}
