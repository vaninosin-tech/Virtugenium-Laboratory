import * as THREE from "three";

/**
 * Where a bottle is while it pours into a tube (VL-014/018) — one formula for
 * the pour itself (`PourMotion`) and for the outline showing it beforehand
 * (`placementGhosts`), so the two cannot disagree.
 */

/** Tip of a pouring bottle (radians): its neck well down over the tube's mouth. */
export const POUR_TILT = 1.6;
/**
 * The gap between the tipped bottle's lip — its lowest edge, a neck's radius
 * below the middle of its mouth — and the tube's rim while pouring (VL-018):
 * the neck stays over the tube, never in it.
 */
export const POUR_LIP_GAP = 0.008;
/** …and higher while it comes over and goes back, clear of the clamp. */
export const APPROACH_ABOVE_MOUTH = 0.05;
/** Gap between a bottle beside a tube and the tube. */
export const READY_GAP = 0.02;
/** A tube's half-width: a bottle beside one stands this much further off. */
export const TUBE_RADIUS = 0.011;
/** A 15 cm tube's mouth, above its origin (its base). */
export const TUBE_MOUTH_HEIGHT = 0.15;

/** What of a bottle the pour needs, measured at rest (`PourMotion`). */
export interface PourGeometry {
  /** Its mouth relative to its origin, in the world, upright. */
  readonly mouthOffset: THREE.Vector3;
  /** Half its width. */
  readonly radius: number;
  /** Half its mouth's width — how far its lip reaches below the middle of its mouth when tipped. */
  readonly neckRadius: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3();
const point = new THREE.Vector3();
const tilt = new THREE.Quaternion();

/**
 * The bottle's origin and turn while pouring into a tube whose mouth is at
 * `mouth`, coming in from `side` (a horizontal unit vector from the tube
 * towards the bottle): at `tip` 0 upright beside the tube, at 1 tipped with
 * its mouth just over the tube's.
 */
export function pourPose(
  geometry: PourGeometry,
  restQuat: THREE.Quaternion,
  mouth: THREE.Vector3,
  side: THREE.Vector3,
  tip: number,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion,
): void {
  axis.crossVectors(UP, side).normalize();
  // Tipping towards the tube turns the bottle's up about `axis` by −angle.
  tilt.setFromAxisAngle(axis, -POUR_TILT * tip);
  // Tipped, its lip hangs a neck's radius below the middle of its mouth.
  const pourAbove = geometry.neckRadius * Math.sin(Math.min(POUR_TILT, Math.PI / 2) * tip) + POUR_LIP_GAP;
  const above = THREE.MathUtils.lerp(Math.max(APPROACH_ABOVE_MOUTH, pourAbove + 0.02), pourAbove, tip);
  // The bottle sits so that its (tipped) mouth is just over the tube's, on the bottle's side.
  point.copy(geometry.mouthOffset).applyQuaternion(tilt);
  outPosition.copy(mouth).addScaledVector(UP, above).addScaledVector(side, 0.004).sub(point);
  // Upright, its mouth over the tube's would put its body round the tube
  // (VL-018): until it is tipped it stands beside the tube instead, and
  // swings over only as it tips.
  outPosition.addScaledVector(side, (geometry.radius + READY_GAP + TUBE_RADIUS) * (1 - tip));
  outQuaternion.copy(tilt).multiply(restQuat);
}
