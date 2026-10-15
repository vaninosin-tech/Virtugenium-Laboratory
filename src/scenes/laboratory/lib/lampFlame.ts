import * as THREE from "three";

import type { TubeLocation } from "./useTestTubeStorageStore";

/**
 * Where the spirit lamp's flame is hottest, in world space — written every
 * frame by the lamp wherever it stands (`SpiritBurner`'s `FlameAnchor`), read
 * by whatever is heated over it: the clamp off the stand (`HeldClampRig`)
 * and a tube heated in the hand (`HandHeatRig`, VL-020). The lamp is its own
 * piece of equipment with its own place, not a fixture beside the stand, so
 * nothing may assume where it is.
 *
 * A plain mutable object rather than store state, like `TUBE_FOCUS`: read
 * and written every frame, never a reason to re-render.
 */
export const LAMP_FLAME = {
  point: new THREE.Vector3(),
  valid: false,
  place: null as TubeLocation | null,
};

/** How close (horizontally, m) a tube in the hand has to be brought to the flame to heat it. */
export const FLAME_REACH = 0.1;
