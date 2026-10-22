import * as THREE from "three";
import { create } from "zustand";

/**
 * World point the close-up camera looks at: the clamped tube in the fume
 * hood's stand, at its rest position (not following the heating sweep —
 * the camera would swing with every crank of the knob). Written every frame
 * by `TubeFocusAnchor`, read every frame by `CameraRig`; a plain mutable
 * object rather than store state so neither side re-renders for it.
 */
export const TUBE_FOCUS = {
  point: new THREE.Vector3(),
  valid: false,
};

interface TubeCloseUpState {
  /**
   * The player is at the stand, looking at its tube close up. Nothing opens
   * this any more — there is no close-up of the stand (VL-020) — so it stays
   * false; kept for the readers that still ask.
   */
  readonly viewing: boolean;
  setViewing: (viewing: boolean) => void;
  open: () => void;
  close: () => void;
}

/**
 * Close-up of the stand's tube. The heating mini-game gets the same close-up
 * on its own; this flag is for looking at a reaction without heating —
 * every sign the tablet asks about is centimetres across and unreadable from
 * the hood's normal viewpoint.
 */
export const useTubeCloseUpStore = create<TubeCloseUpState>((set) => ({
  viewing: false,
  setViewing: (viewing) => set({ viewing }),
  open: () => set({ viewing: true }),
  close: () => set({ viewing: false }),
}));
