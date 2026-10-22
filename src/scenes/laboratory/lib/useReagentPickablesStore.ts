import { create } from "zustand";
import type * as THREE from "three";

/** Every reagent-related object the F8 dev menu's click-to-select can hit — kept separate from `useHotspotObjectsStore` (furniture) since these aren't gameplay hotspots, just dev-pick targets. `workbench-stopper-holder` and `workbench-reagent-area` are also drag targets — see `CameraRig`'s `handlePointerDown`/`handleMouseMove`. */
export type ReagentPickableId =
  | "held-tray"
  | "workbench-stopper-holder"
  | "workbench-reagent-area"
  | "inspection-bottle";

interface ReagentPickablesState {
  readonly objectsById: Readonly<Partial<Record<ReagentPickableId, THREE.Object3D>>>;
  register: (id: ReagentPickableId, object: THREE.Object3D) => void;
  unregister: (id: ReagentPickableId) => void;
}

/** Same registration pattern as `useHotspotObjectsStore` — each dev-pickable reagent component registers its own root `Object3D` on mount so the dev menu's mouse raycast only ever tests this small curated set. */
export const useReagentPickablesStore = create<ReagentPickablesState>((set) => ({
  objectsById: {},

  register: (id, object) =>
    set((state) => ({ objectsById: { ...state.objectsById, [id]: object } })),

  unregister: (id) =>
    set((state) => {
      const next = { ...state.objectsById };
      delete next[id];
      return { objectsById: next };
    }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __reagentPickablesStore?: unknown }).__reagentPickablesStore = useReagentPickablesStore;
}
