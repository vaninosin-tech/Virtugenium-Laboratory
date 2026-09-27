import { create } from "zustand";

import type { HotspotTargetId } from "./layout";

interface FumeHoodControlsState {
  /** Extraction-fan ON/OFF per fume hood, defaulting to OFF for any id not yet in the map — `CameraRig`'s staged approach turns it on partway through the intro, it doesn't start running. */
  readonly fanOnById: Readonly<Record<string, boolean>>;
  /** Light ON/OFF per fume hood, defaulting to OFF for any id not yet in the map. */
  readonly lightOnById: Readonly<Record<string, boolean>>;
  toggleFan: (id: HotspotTargetId) => void;
  toggleLight: (id: HotspotTargetId) => void;
  /** Explicit set (not toggle) — used by `CameraRig`'s scripted approach sequence, which must land on a known ON/OFF value regardless of whatever a previous visit left behind. */
  setFan: (id: HotspotTargetId, on: boolean) => void;
  setLight: (id: HotspotTargetId, on: boolean) => void;
}

/** Shared panel state: light drives the LED and local work light; CameraRig also controls the entry sequence. */
export const useFumeHoodControlsStore = create<FumeHoodControlsState>((set) => ({
  fanOnById: {},
  lightOnById: {},

  toggleFan: (id) =>
    set((state) => ({
      fanOnById: { ...state.fanOnById, [id]: !(state.fanOnById[id] ?? false) },
    })),

  toggleLight: (id) =>
    set((state) => ({
      lightOnById: { ...state.lightOnById, [id]: !(state.lightOnById[id] ?? false) },
    })),

  setFan: (id, on) => set((state) => ({ fanOnById: { ...state.fanOnById, [id]: on } })),
  setLight: (id, on) => set((state) => ({ lightOnById: { ...state.lightOnById, [id]: on } })),
}));
