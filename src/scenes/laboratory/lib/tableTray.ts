import * as THREE from "three";

/**
 * The tray resting on the workbench, as a drop target (VL-017): a bottle, a
 * tube or the stand brought over it goes onto it. The object is the tray's
 * table copy (`LabTrayInstance`, `mode="table"`), set by it.
 */
export const TABLE_TRAY = { object: null as THREE.Object3D | null };

/** The tray model's footprint in its own space (`LabTray_Metal.glb`), a little inset from its rim. */
const MIN_X = -0.3;
const MAX_X = 0.48;
const HALF_Z = 0.2;
const local = new THREE.Vector3();

/** Whether a world point is over the tray on the workbench (seen from above). */
export function overTableTray(point: THREE.Vector3): boolean {
  const tray = TABLE_TRAY.object;
  if (!tray || !tray.visible) return false;
  tray.updateWorldMatrix(true, false);
  tray.worldToLocal(local.copy(point));
  return local.x > MIN_X && local.x < MAX_X && Math.abs(local.z) < HALF_Z;
}

/**
 * Live while a workbench rack tube is carried (`InspectableTestTubeSlot`):
 * whether it is over the tray right now — for the hand's caption.
 */
export const WORKBENCH_CARRY = { overTray: false };
