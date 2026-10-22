import { create } from "zustand";

import type { HotspotTargetId } from "./layout";

interface CabinetOpenState {
  /** Per-cabinet open/closed logical state — exactly two states, no third "opening"/"closing" state (the animation itself interpolates, this only tracks the target). */
  readonly openById: Readonly<Record<string, boolean>>;
  toggleOpen: (id: HotspotTargetId) => void;
  setOpen: (id: HotspotTargetId, open: boolean) => void;
}

/**
 * Tracks which cabinets are open, independent of camera/interaction state.
 * `useCabinetDoorAnimation` reads the relevant entry and eases toward it;
 * this store only ever holds the two logical states (default closed —
 * absent from the map reads as `false`).
 */
export const useCabinetOpenStore = create<CabinetOpenState>((set) => ({
  openById: {},
  toggleOpen: (id) =>
    set((state) => ({
      openById: { ...state.openById, [id]: !state.openById[id] },
    })),
  setOpen: (id, open) =>
    set((state) => ({
      openById: { ...state.openById, [id]: open },
    })),
}));
