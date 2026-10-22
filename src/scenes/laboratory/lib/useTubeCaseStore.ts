import { create } from "zustand";

import type { StoredTestTube } from "./useTestTubeStorageStore";

/** How many tubes the case holds: the tray inside has a 10 × 5 grid of cells. */
export const TUBE_CASE_CAPACITY = 50;

interface TubeCaseState {
  /** Drawn out of the cabinet under the table and standing on the worktop. */
  readonly deployed: boolean;
  /** Lid open (latches released, lid up) — only meaningful while deployed. */
  readonly isOpen: boolean;
  /** Tubes the player put away into the case, in the order they went in (tube `n` stands in cell `n`). */
  readonly stored: readonly StoredTestTube[];
  toggleDeployed: () => void;
  toggleOpen: () => void;
  /** Puts a tube into the next free cell. Returns false when the case is full. */
  storeTube: (tube: StoredTestTube) => boolean;
}

export const useTubeCaseStore = create<TubeCaseState>((set, get) => ({
  deployed: false,
  isOpen: false,
  stored: [],
  // Putting the case away closes it first (`HermeticCaseOnWorkbench` waits for the lid before it moves).
  toggleDeployed: () => set((state) => ({ deployed: !state.deployed, isOpen: false })),
  toggleOpen: () => set((state) => (state.deployed ? { isOpen: !state.isOpen } : state)),
  storeTube: (tube) => {
    const { stored } = get();
    if (stored.length >= TUBE_CASE_CAPACITY) return false;
    set({ stored: [...stored, tube] });
    return true;
  },
}));
