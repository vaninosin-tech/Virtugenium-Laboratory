import { create } from "zustand";

interface TestTubeHoverState {
  /** Which tube slot (in the workbench rack, while it's being inspected) the mouse is currently over — read by `ReagentInspectionOverlay` to show the contents tooltip above ОСТАВИТЬ. Only one at a time. */
  readonly hoveredInstanceId: string | null;
  setHovered: (id: string) => void;
  /** Only clears if `id` is the one currently hovered — avoids a stale pointerOut on a tube that's no longer the hovered one (e.g. after a fast pointer swap between two adjacent tubes) wiping out the NEW hover. */
  clearIfHovered: (id: string) => void;
}

export const useTestTubeHoverStore = create<TestTubeHoverState>((set) => ({
  hoveredInstanceId: null,
  setHovered: (id) => set({ hoveredInstanceId: id }),
  clearIfHovered: (id) => set((state) => (state.hoveredInstanceId === id ? { hoveredInstanceId: null } : state)),
}));
