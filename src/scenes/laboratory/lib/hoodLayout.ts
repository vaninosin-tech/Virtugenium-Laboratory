import * as THREE from "three";

import { EQUIPMENT, type Position3 } from "./layout";
import { useFurniturePositionStore } from "./useFurniturePositionStore";

/**
 * Where things stand on the fume hood's worktop, in the hood model's own
 * space (its worktop surface is at local Y 0.9, `FumeHood_Modern.glb`'s
 * `WorkSurface`; the inner walls at X ±0.714, back wall to sash Z −0.4..0.35).
 *
 * The carried tray takes the left part (VL-017), its long axis running into
 * the hood — the test-tube rack end at the back, the equipment end towards
 * the player. Everything carried in
 * stands to the right of it: the hood's tube rack, the stand, the bottles.
 */
export const HOOD_WORKTOP_Y = 0.9;
/**
 * The tray's origin, at the size it is held at (`heldTray.scale`, 0.7: 0.31 ×
 * 0.57 m). Its model's origin is not its middle (its own X runs −0.316..0.5),
 * so with its turn it spans Z −0.24 (the back panel) .. 0.33 (the sash),
 * X −0.61..−0.30.
 */
export const HOOD_TRAY_LOCAL: Position3 = [-0.455, HOOD_WORKTOP_Y, -0.02];
/** Three quarters of a turn: the tray's own +X (its equipment end) to the hood's +Z — towards the player; its test-tube rack at the back. */
export const HOOD_TRAY_YAW = -Math.PI / 2;
/** The hood's own test-tube rack (0.37 m wide), right of the tray. */
export const HOOD_RACK_LOCAL: Position3 = [-0.08, HOOD_WORKTOP_Y, 0.02];
/** The stand, with the lamp beside it (`lampLayout`), right of the rack. */
export const HOOD_STAND_LOCAL: Position3 = [0.22, HOOD_WORKTOP_Y, 0.02];

/** The bottles carried in: a column along the right of the view, back to front, a second one beside it. */
export function hoodBottleLocal(index: number): Position3 {
  const column = Math.floor(index / 3);
  const row = index % 3;
  return [0.46 - column * 0.11, HOOD_WORKTOP_Y, -0.17 + row * 0.12];
}

const HOOD = EQUIPMENT.find((equipment) => equipment.id === "fume-hood")!;
const UP = new THREE.Vector3(0, 1, 0);

/** The tray's world pose on the hood's worktop, from the hood's live (calibrated) transform. */
export function hoodTrayWorldPose(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
  const override = useFurniturePositionStore.getState().getOverride(HOOD.id);
  const yaw = override.rotationY ?? HOOD.rotationY;
  position.set(...HOOD_TRAY_LOCAL).applyAxisAngle(UP, yaw).add(new THREE.Vector3(...override.position));
  quaternion.setFromAxisAngle(UP, yaw + HOOD_TRAY_YAW);
}
