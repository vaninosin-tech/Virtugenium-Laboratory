import { create } from "zustand";

import type { HotspotTargetId } from "./layout";

interface CabinetPageState {
  /** Current page per cabinet, 1-indexed. Defaults to 1 for any cabinet not yet in the map. */
  readonly currentPageById: Readonly<Record<string, number>>;
  nextPage: (id: HotspotTargetId, totalPages: number) => void;
  previousPage: (id: HotspotTargetId, totalPages: number) => void;
}

/**
 * Runtime current-page state per cabinet — separate from `CabinetDef.totalPages`
 * (static config) since this changes via player interaction while the total
 * count doesn't. Every cabinet currently has `totalPages: 1`, so both
 * actions are no-ops in practice today (clamped to stay within
 * [1, totalPages]) until a cabinet's `totalPages` is actually raised.
 * `useCabinetDoorAnimation`'s screen touch-zone interaction is the source
 * that calls these.
 */
export const useCabinetPageStore = create<CabinetPageState>((set) => ({
  currentPageById: {},

  nextPage: (id, totalPages) =>
    set((state) => {
      const current = state.currentPageById[id] ?? 1;
      const next = Math.min(current + 1, totalPages);
      if (next === current) return state;
      return { currentPageById: { ...state.currentPageById, [id]: next } };
    }),

  previousPage: (id, totalPages) =>
    set((state) => {
      const current = state.currentPageById[id] ?? 1;
      const previous = Math.max(current - 1, 1);
      if (previous === current) return state;
      return { currentPageById: { ...state.currentPageById, [id]: Math.min(previous, totalPages) } };
    }),
}));
