import { create } from "zustand";

interface LightingState {
  /** Ceiling LED group A (panels 01/03/05 — the checkerboard half). */
  readonly groupA: boolean;
  /** Ceiling LED group B (panels 02/04/06). */
  readonly groupB: boolean;
  setGroupA: (on: boolean) => void;
  setGroupB: (on: boolean) => void;
  toggleGroupA: () => void;
  toggleGroupB: () => void;
}

/**
 * Runtime equivalent of the two Blender switch-driven light groups
 * (`light_group_a` / `light_group_b` custom properties on `LightSwitch`,
 * originally wired via AVERAGE+Generator drivers). Drivers don't survive
 * glTF export, so `LightingRuntime` recreates just the on/off *behavior* in
 * game code, driven by this store — same two independent groups, same
 * default-lit gameplay state, nothing redesigned.
 */
export const useLightingStore = create<LightingState>((set) => ({
  groupA: true,
  groupB: true,
  setGroupA: (groupA) => set({ groupA }),
  setGroupB: (groupB) => set({ groupB }),
  toggleGroupA: () => set((state) => ({ groupA: !state.groupA })),
  toggleGroupB: () => set((state) => ({ groupB: !state.groupB })),
}));
