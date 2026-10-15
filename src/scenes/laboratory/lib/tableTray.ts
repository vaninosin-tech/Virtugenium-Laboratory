import * as THREE from "three";

/**
 * The tray resting on the workbench, as a drop target (VL-017): a bottle, a
 * tube or the stand brought over it goes onto it. The object is the tray's
 * table copy (`LabTrayInstance`, `mode="table"`), set by it.
 */
export const TABLE_TRAY = { object: null as THREE.Object3D | null };

/** The test tube rack on the workbench, as a place a tube goes back into — set by `WorkbenchTestTubeRackInstance`. */
export const WORKBENCH_RACK = { object: null as THREE.Object3D | null };

/**
 * Where something is put down on a tray, in the tray's own space
 * (`LabTray_Metal.glb`): on its floor, inside the rims — the floor runs
 * X −0.307..0.491, Z ±0.209 (measured), the rims rise round it. Brought over
 * this, an item goes onto the tray — at the table and in the hood alike.
 */
export const TRAY_PLACEMENT = { minX: -0.3, maxX: 0.48, minZ: -0.2, maxZ: 0.2 } as const;
const local = new THREE.Vector3();

/** Whether a world point is over the tray on the workbench (seen from above). */
export function overTableTray(point: THREE.Vector3): boolean {
  const tray = TABLE_TRAY.object;
  if (!tray || !tray.visible) return false;
  tray.updateWorldMatrix(true, false);
  tray.worldToLocal(local.copy(point));
  return (
    local.x > TRAY_PLACEMENT.minX &&
    local.x < TRAY_PLACEMENT.maxX &&
    local.z > TRAY_PLACEMENT.minZ &&
    local.z < TRAY_PLACEMENT.maxZ
  );
}

/**
 * Live while a workbench rack tube is carried (`InspectableTestTubeSlot`):
 * whether it is over the tray right now, or under the lamp's flame (VL-020)
 * — for the hand's caption.
 */
export const WORKBENCH_CARRY = { overTray: false, nearFlame: false };
