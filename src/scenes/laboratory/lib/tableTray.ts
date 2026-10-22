import * as THREE from "three";

/**
 * The tray resting on the workbench, as a drop target (VL-017): a bottle, a
 * tube or the stand brought over it goes onto it. The object is the tray's
 * table copy (`LabTrayInstance`, `mode="table"`), set by it.
 */
export const TABLE_TRAY = { object: null as THREE.Object3D | null };

/**
 * Whether the held copy of the tray (`LabTrayInstance`, `mode="held"`) is on
 * screen — flying out, in the hand, or flying home. The table copy is hidden
 * exactly that long, so one tray is always seen: handed over at the same pose.
 */
export const HELD_TRAY = { shown: false };

/**
 * How far `CameraRig`'s return tween from a cabinet has got (eased, 0..1), so
 * the tray in the hand can ride home with the camera and land on the table as
 * the table comes into view, instead of flying off alone while the camera
 * still looks at the cabinet. Only meaningful while `cabinetPhase` is
 * "returning".
 */
export const CABINET_RETURN = { progress: 0 };

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
 * whether it is over the tray right now, under the lamp's flame (VL-020) or
 * brought to a reagent jar, and where it is — for the hand's caption.
 */
export const WORKBENCH_CARRY = { overTray: false, overCase: false, nearFlame: false, nearJar: false, point: new THREE.Vector3() };
