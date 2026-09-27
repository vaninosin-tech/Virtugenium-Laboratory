import { create } from "zustand";

interface BurnerState {
  /** Whether the spirit burner's wick is alight. */
  readonly lit: boolean;
  toggle: () => void;
  setLit: (lit: boolean) => void;
}

/**
 * The spirit burner is a single object in the lab (like the stand), so a
 * plain flag is enough — no per-instance registry.
 *
 * Kept out of `useLaboratoryStore`: this is scene state, and the heating
 * step will read it the same way `stageSceneConfig` reads the other scene
 * stores, rather than the domain session owning a flame.
 */
export const useBurnerStore = create<BurnerState>((set) => ({
  lit: false,
  toggle: () => set((state) => ({ lit: !state.lit })),
  setLit: (lit) => set({ lit }),
}));
