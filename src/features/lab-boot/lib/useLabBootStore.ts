import { create } from "zustand";

/**
 * The lab's loading screen state. `loading` from the moment the lab scene
 * mounts until every stage is done; `revealing` while the loading screen
 * turns out to be the tablet's screen and the tablet shrinks back to its
 * normal size; `done` once the player can use the tablet and the scene.
 */
export type LabBootPhase = "loading" | "revealing" | "done";

interface LabBootState {
  readonly phase: LabBootPhase;
  /** The 3D scene has mounted (every suspended model resolved) and rendered its first frames. */
  readonly sceneReady: boolean;
  begin: () => void;
  markSceneReady: () => void;
  setPhase: (phase: LabBootPhase) => void;
}

export const useLabBootStore = create<LabBootState>((set) => ({
  phase: "done",
  sceneReady: false,
  begin: () => set({ phase: "loading", sceneReady: false }),
  markSceneReady: () => set((state) => (state.sceneReady ? state : { sceneReady: true })),
  setPhase: (phase) => set({ phase }),
}));
