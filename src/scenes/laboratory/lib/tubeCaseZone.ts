import * as THREE from "three";

/**
 * The tube case on the workbench as a drop target, like the tray (`tableTray.ts`):
 * a carried test tube brought over the open case's tray is put away with a click.
 * `object` is the group at the tray's centre (set by `HermeticCaseOnWorkbench`);
 * `armed` is true only while the case stands on the table with its lid fully open.
 */
export const TUBE_CASE_ZONE = { object: null as THREE.Object3D | null, armed: false };

/** The tray's cell grid in the case's own space: 10 × 31.5 mm by 5 × 40 mm, a little inset. */
const HALF_X = 0.15;
const HALF_Z = 0.1;
const local = new THREE.Vector3();

/** Whether a world point is over the open case's tray (seen from above). */
export function overTubeCase(point: THREE.Vector3): boolean {
  const zone = TUBE_CASE_ZONE.object;
  if (!zone || !TUBE_CASE_ZONE.armed) return false;
  zone.updateWorldMatrix(true, false);
  zone.worldToLocal(local.copy(point));
  return Math.abs(local.x) < HALF_X && Math.abs(local.z) < HALF_Z;
}

/**
 * Shared between the case and the workbench: how far the case has travelled out of
 * the cabinet (0 = inside, 1 = on the table) and how far the bottom drawer front has
 * slid out with it. Plain numbers, written every frame by the case — not React state.
 */
export const TUBE_CASE_MOTION = { drawer: 0 };
/** The drawer front slides this far (m) towards the player while the case rides in it. */
export const DRAWER_TRAVEL = 0.42;
