import { create } from "zustand";

import type { Position3 } from "./layout";

/**
 * `SpiritLamp.glb`'s states, from `docs/assets/SpiritLamp_flame_logic.txt`:
 * capped (no flame, the starting state), open (cap off, no flame) and lit.
 * Putting the cap on a lit lamp is how it is put out.
 */
export type BurnerPhase = "capped" | "open" | "lit";

/**
 * Where the lamp is. It is its own piece of equipment (VL-014): taken from
 * the «Лаб. оборудование» cabinet separately from the stand, carried to the
 * table on the tray and into the fume hood by «Перенести».
 */
export type BurnerPlace = "shelf" | "tray" | "workbench" | "fumeHood";

/**
 * Local spot on the held tray: its free far corner beside the stand
 * (`BUNSEN_STAND_TRAY_ANCHOR`), on the inner floor the reagent grid uses.
 * The near corner (+Z) put the lamp under the bottom edge of the screen.
 * The reagent grid shares the area, but reagents and equipment come from
 * different cabinets, and the tray is emptied onto the table after each one.
 */
export const BURNER_TRAY_REST_POSITION: Position3 = [0.3, 0.004, -0.11];

/** A careful player does not carry a burning lamp: moving it caps it. */
const CAPPED = { phase: "capped" as const, lit: false };

interface BurnerState {
  readonly phase: BurnerPhase;
  /** Whether the spirit lamp's wick is alight — `phase === "lit"`, kept as a field for the many readers. */
  readonly lit: boolean;
  /** The player's click on the lamp: take the cap off, light it, put the cap back on (which puts it out). */
  advance: () => void;
  /** Direct control for scripted setups: lit takes the cap off, unlit puts it back on. */
  setLit: (lit: boolean) => void;
  readonly place: BurnerPlace;
  /** Captured world pose of the tray copy when it was clicked back to the shelf — see `useShelfTrayFlight`. */
  readonly returnRequest: {
    readonly worldPos: Position3;
    readonly worldQuat: readonly [number, number, number, number];
    readonly worldScale: number;
  } | null;
  take: () => void;
  requestReturn: (worldPos: Position3, worldQuat: readonly [number, number, number, number], worldScale: number) => void;
  clearReturnRequest: () => void;
  /** Same frame as the stand's: the cabinet session ends and the tray is emptied onto the table. */
  transferToWorkbench: () => void;
  transferToFumeHood: () => void;
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
export const useBurnerStore = create<BurnerState>((set, get) => ({
  phase: "capped",
  lit: false,
  place: "shelf",
  returnRequest: null,
  take: () => set({ place: "tray" }),
  requestReturn: (worldPos, worldQuat, worldScale) =>
    set({ place: "shelf", returnRequest: { worldPos, worldQuat, worldScale } }),
  clearReturnRequest: () => set({ returnRequest: null }),
  transferToWorkbench: () => {
    if (get().place === "tray") set({ place: "workbench", ...CAPPED });
  },
  transferToFumeHood: () => {
    if (get().place === "workbench") set({ place: "fumeHood", ...CAPPED });
  },
  advance: () =>
    set((state) => {
      const phase = NEXT[state.phase];
      return { phase, lit: phase === "lit" };
    }),
  setLit: (lit) => set({ phase: lit ? "lit" : "capped", lit }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __burnerStore?: unknown }).__burnerStore = useBurnerStore;
}
