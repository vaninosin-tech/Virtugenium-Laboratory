import * as THREE from "three";

/**
 * The pose of a pouring bottle as a function of how far along the pour is —
 * one definition, read by the animation (`PourMotion`) and by the hover
 * preview that freezes it (`poseClips`).
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
/** Phases of a pour, as fractions of `POUR_MS`. */
export const COME = 0.3;
export const TIP = 0.44;
export const HOLD = 0.74;
export const UNTIP = 0.84;
/** Gap between a bottle standing beside the clamped tube and the tube. */
export const READY_GAP = 0.02;
/** The tube in the clamp's half-width: a bottle beside it stands this much further off. */
export const CLAMPED_TUBE_RADIUS = 0.011;

const UP = new THREE.Vector3(0, 1, 0);

const smooth = (t: number) => THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(t, 0, 1), 0, 1);

/** How far the bottle is tipped, 0..1, `k` into the pour. */
export function pourTip(k: number): number {
  if (k < COME) return 0;
  if (k < TIP) return smooth((k - COME) / (TIP - COME));
  if (k < HOLD) return 1;
  if (k < UNTIP) return 1 - smooth((k - HOLD) / (UNTIP - HOLD));
  return 0;
}

export interface PouringItem {
  /** The item's mouth relative to its origin, upright. */
  readonly mouthOffset: THREE.Vector3;
  readonly radius: number;
  readonly neckRadius: number;
}

const point = new THREE.Vector3();

/**
 * Where the item's origin is and how it is turned `k` into the pour, at the
 * tube whose mouth is `mouth`, approached from `side` and tipped about `axis`.
 * The part of the pour before `COME` — the trip over from its place — is not
 * a pose at the tube, so it is shown as the first moment at the tube.
 */
export function pourPoseAt(
  k: number,
  item: PouringItem,
  mouth: THREE.Vector3,
  side: THREE.Vector3,
  axis: THREE.Vector3,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion,
): void {
  const tip = pourTip(k);
  const pourAbove = item.neckRadius * Math.sin(Math.min(POUR_TILT, Math.PI / 2) * tip) + POUR_LIP_GAP;
  const above = THREE.MathUtils.lerp(Math.max(APPROACH_ABOVE_MOUTH, pourAbove + 0.02), pourAbove, tip);
  outQuaternion.setFromAxisAngle(axis, -POUR_TILT * tip);
  point.copy(item.mouthOffset).applyQuaternion(outQuaternion);
  outPosition.copy(mouth).addScaledVector(UP, above).addScaledVector(side, 0.004).sub(point);
  // Upright it would stand round the tube: it stands beside it until it tips.
  outPosition.addScaledVector(side, (item.radius + READY_GAP + CLAMPED_TUBE_RADIUS) * (1 - tip));
}
