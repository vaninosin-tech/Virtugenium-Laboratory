import { create } from "zustand";

/**
 * `SpiritLamp.glb`'s states, from `docs/assets/SpiritLamp_flame_logic.txt`:
 * capped (no flame, the starting state), open (cap off, no flame) and lit.
 * Putting the cap on a lit lamp is how it is put out.
 */
export type BurnerPhase = "capped" | "open" | "lit";

interface BurnerState {
  readonly phase: BurnerPhase;
  /** Whether the spirit lamp's wick is alight — `phase === "lit"`, kept as a field for the many readers. */
  readonly lit: boolean;
  /** The player's click on the lamp: take the cap off, light it, put the cap back on (which puts it out). */
  advance: () => void;
  /** Direct control for scripted setups: lit takes the cap off, unlit puts it back on. */
  setLit: (lit: boolean) => void;
}

const NEXT: Record<BurnerPhase, BurnerPhase> = { capped: "open", open: "lit", lit: "capped" };

/**
 * The spirit lamp is a single object in the lab (like the stand), so plain
 * state is enough — no per-instance registry.
 *
 * Kept out of `useLaboratoryStore`: this is scene state, and the heating
 * step reads it the same way `stageSceneConfig` reads the other scene
 * stores, rather than the domain session owning a flame.
 */
export const useBurnerStore = create<BurnerState>((set) => ({
  phase: "capped",
  lit: false,
  advance: () =>
    set((state) => {
      const phase = NEXT[state.phase];
      return { phase, lit: phase === "lit" };
    }),
  setLit: (lit) => set({ phase: lit ? "lit" : "capped", lit }),
}));
