import * as THREE from "three";

import { CAMERA_TARGETS } from "../lib/layout";
import { DEFAULT_TABLE_POSITION, STAND_TABLE_YAW } from "../lib/useBunsenStandStorageStore";
import { lampLayout } from "./StandStation";

/**
 * Where the stand and the spirit lamp stand at the table and in the fume
 * hood — shared by what draws them there (`BunsenStandWorkbenchDisplay`,
 * `FumeHoodWorkArea`) and by the outlines of where a carried one will be set
 * down (`placementGhosts`), so the two can never disagree.
 */

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * "Away from the player" at the table: the table viewpoint's own look
 * direction, flattened — in the stand's own space: it stands turned round
 * on the table (`STAND_TABLE_YAW`).
 */
export const AWAY_AT_TABLE = new THREE.Vector3(Math.sin(CAMERA_TARGETS.table.yaw), 0, -Math.cos(CAMERA_TARGETS.table.yaw))
  .normalize()
  .applyAxisAngle(Y_AXIS, -STAND_TABLE_YAW);

/**
 * The lamp's own spot on the table (VL-020): where it used to stand beside the
 * stand in the stand's default place — so the table looks as it did — but
 * fixed, not following the stand when it is dragged. The lamp is its own
 * piece of equipment, heated over by the clamp off the stand or by a tube in
 * the hand wherever it stands.
 */
export const LAMP_TABLE_SPOT = (() => {
  const offset = new THREE.Vector3(...lampLayout(AWAY_AT_TABLE).lamp).applyAxisAngle(Y_AXIS, STAND_TABLE_YAW);
  return { x: DEFAULT_TABLE_POSITION.x + offset.x, z: DEFAULT_TABLE_POSITION.z + offset.z };
})();

/**
 * A dead-on quarter turn put the rod exactly behind the tube: the metal
 * showed through the liquid and the whole column read as a steel rod. This
 * much off the camera axis moves the rod beside the tube while the tube
 * still faces the camera.
 */
const HOOD_STAND_TURN_ASIDE = 0.5;

/**
 * The stand's ring arm points along the model's +X, i.e. sideways across
 * the hood, so the clamped tube hid beside the rod. A quarter turn points
 * the arm at the sash — at the camera — with the tube in front of the rod,
 * and turns the heating sweep (the tube's local Z) into left-right motion on
 * screen, the same axis as the knob's track.
 */
export const HOOD_STAND_ROTATION_Y = -Math.PI / 2 + HOOD_STAND_TURN_ASIDE;

/** "Away from the player" (the hood's back wall, hood -Z) in the stand's own turned space. */
export const HOOD_AWAY_FROM_PLAYER = new THREE.Vector3(0, 0, -1).applyAxisAngle(Y_AXIS, -HOOD_STAND_ROTATION_Y);

/** The lamp's own spot in the hood (VL-020) — where it used to stand beside the stand, in the stand's frame. */
export const HOOD_LONE_LAMP_POSITION = lampLayout(HOOD_AWAY_FROM_PLAYER).lamp;
