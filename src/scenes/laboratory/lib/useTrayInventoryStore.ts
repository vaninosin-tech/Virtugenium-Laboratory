import { create } from "zustand";

/** Configurable in this one place — nothing else should hardcode a tray slot count. */
export const TRAY_CAPACITY = 6;

/** Placeholder shape for a future tray item (a taken reagent). Not populated yet — reagent ВЗЯТЬ is intentionally not implemented. */
export interface TrayItem {
  readonly id: string;
}

interface TrayInventoryState {
  /**
   * The tray's ONE shared logical contents. There must never be a second,
   * independent `items` array (e.g. a "workbench copy" vs. a "held copy") —
   * `LabTrayInstance`'s workbench/held placement is purely visual and reads
   * this same array regardless of which transform it's currently damping
   * toward.
   */
  readonly items: readonly TrayItem[];
  readonly capacity: number;
}

export const useTrayInventoryStore = create<TrayInventoryState>(() => ({
  items: [],
  capacity: TRAY_CAPACITY,
}));
