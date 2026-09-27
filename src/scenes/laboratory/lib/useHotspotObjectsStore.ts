import { create } from "zustand";
import type * as THREE from "three";

import type { HotspotTargetId } from "./layout";

interface HotspotObjectsState {
  /** Each interactive component's own root `Object3D`, keyed by the hotspot id it represents — registered/unregistered on mount/unmount. */
  readonly objectsById: Readonly<Partial<Record<HotspotTargetId, THREE.Object3D>>>;
  register: (id: HotspotTargetId, object: THREE.Object3D) => void;
  unregister: (id: HotspotTargetId) => void;
}

/**
 * Lets `CameraRig`'s crosshair hover-detection raycast against real
 * geometry — any part of a cabinet/equipment piece/the workbench, not a
 * single fixed "anchor" point with a screen-space distance threshold
 * (the old approach, which needed aiming well above the object's actual
 * visible bulk before the hover-pick loop had it "close enough" — reported
 * for the workbench, but the same fixed-point heuristic affected every
 * hotspot). Each interactive component registers its own outer group here
 * on mount so `CameraRig` only ever raycasts this small curated set, never
 * the room/walls/floor.
 */
export const useHotspotObjectsStore = create<HotspotObjectsState>((set) => ({
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
