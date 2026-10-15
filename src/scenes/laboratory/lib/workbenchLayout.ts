import type * as THREE from "three";
import { create } from "zustand";

import { useFurniturePositionStore } from "./useFurniturePositionStore";
import { useReagentStorageStore } from "./useReagentStorageStore";
import { computeWorkbenchReagentSlotOffsets, useWorkbenchReagentAreaStore } from "./useWorkbenchReagentAreaStore";

/**
 * A bottle carried from the tray to the bench goes into the bench's row at
 * the slot the hand is at, the others making room (`bottleFromTray`). While
 * letting go now would put it there, that slot is RESERVED: the row is laid
 * out as if the bottle already stood in it (`WorkbenchReagentDisplayArea`,
 * the same `computeWorkbenchReagentSlotOffsets` and the same glide), so the
 * drop itself moves nothing else. Its outline stands in that slot
 * (`placementGhosts`). Set every frame by `HandController` from what a
 * release would do; cleared when the bottle is let go, put back or the
 * place stops being its release target.
 */
export interface WorkbenchReservation {
  /** The carried bottle. */
  readonly instanceId: string;
  /** Its slot in the row once set down (the index into `workbenchItems`). */
  readonly index: number;
}

interface WorkbenchReservationState {
  readonly reserved: WorkbenchReservation | null;
  reserve: (reservation: WorkbenchReservation) => void;
  clear: () => void;
}

export const useWorkbenchReservationStore = create<WorkbenchReservationState>((set) => ({
  reserved: null,
  reserve: (reservation) =>
    set((state) =>
      state.reserved?.instanceId === reservation.instanceId && state.reserved.index === reservation.index
        ? state
        : { reserved: reservation },
    ),
  clear: () => set((state) => (state.reserved === null ? state : { reserved: null })),
}));

/** How many bottles stand in the bench's row (a full row takes no more). */
export function workbenchRowCount(): number {
  return useReagentStorageStore.getState().workbenchItems.length;
}

/**
 * The slot a bottle let go at `point` goes into: the nearest slot of the row
 * laid out with it added. Null — the row is full.
 */
export function workbenchInsertIndex(point: THREE.Vector3): number | null {
  const config = useWorkbenchReagentAreaStore.getState().config;
  const count = workbenchRowCount();
  if (count >= config.maxDisplaySlots) return null;
  const [tx, , tz] = useFurniturePositionStore.getState().getOverride("table").position;
  const offsets = computeWorkbenchReagentSlotOffsets(config, count + 1);
  let best = count;
  let bestDistance = Infinity;
  offsets.forEach(([x, , z], index) => {
    const distance = Math.hypot(point.x - (tx + x), point.z - (tz + z));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
