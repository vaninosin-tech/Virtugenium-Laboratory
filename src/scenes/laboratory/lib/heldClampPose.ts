import * as THREE from "three";

/**
 * Where the clamp and its tube are while the player heats them — see
 * `useHeatingStore`. The flame stays put (`docs/assets/SpiritLamp_flame_logic.txt`:
 * a lit spirit lamp is never moved); the tube moves through it, tilted in the
 * screen's plane so the player sees the flame travel along the glass.
 *
 * `sweep` (-1..1, the ellipse on the V) drives both where the flame is on the
 * glass and how the tube leans:
 * - the tops of the V put the tube's bottom in the flame's hot zone, the
 *   vertex the point `V_REACH` up the tube — dragging down an arm slides the
 *   tube down along its own axis and the flame climbs the glass;
 * - the arm picks the lean: the tube follows the arm's own slant, 45° to one
 *   side on one arm and 135° (45° to the other side) on the other, passing
 *   upright through the vertex, so the flame gets both flanks of the glass.
 */
export const HELD_TUBE_TILT = THREE.MathUtils.degToRad(45);
/** Outer radius of `LabTestTube.glb`'s glass. */
const TUBE_RADIUS = 0.0098;
/** How far up the tube, from its bottom, the vertex of the V puts the flame. */
export const V_REACH = 0.1;
/** Where along the tube the tops of the V put the flame: the rounded bottom. */
const V_TIP = 0.005;
/** Stretch of `sweep` around the vertex over which the lean swings from one side to the other. */
const LEAN_SWING = 0.2;

/**
 * Keep-out round the spirit lamp itself: its radius (plus a little air) and
 * a floor just above the wick holder, relative to the hot spot's height. The
 * flame runs from 0.0765 up; the hot spot sits near its top.
 */
const LAMP_KEEP_OUT_RADIUS = 0.045;
const LAMP_TOP_BELOW_HOT_SPOT = 0.022;

const UP = new THREE.Vector3(0, 1, 0);

export interface HeldClampPose {
  /** The clamp jaws' tube-axis point (`TubeClamp_TubeAxis`) — the rig's origin. */
  readonly jaws: THREE.Vector3;
  /** Rig rotation: local Y along the tube (bottom → mouth), clamp handle towards the player. */
  readonly quaternion: THREE.Quaternion;
  /** The tube's own bottom. */
  readonly bottom: THREE.Vector3;
}

/** Signed lean from upright, radians: positive leans the mouth to the player's right. */
export const heldTubeLean = (sweep: number): number => {
  const s = THREE.MathUtils.clamp(sweep, -1, 1);
  const t = THREE.MathUtils.clamp(s / LEAN_SWING, -1, 1);
  // Smooth through the vertex, flat along the arms.
  return HELD_TUBE_TILT * Math.sin((t * Math.PI) / 2);
};

/**
 * @param hotSpot centre of the flame's hot zone, in the same space as the result
 * @param away horizontal unit direction pointing away from the player
 * @param insertDepth how far below the jaws the tube's bottom hangs
 */
export function heldClampPose(
  sweep: number,
  hotSpot: THREE.Vector3,
  away: THREE.Vector3,
  insertDepth: number,
): HeldClampPose {
  const right = new THREE.Vector3().crossVectors(away, UP).normalize();
  const s = THREE.MathUtils.clamp(sweep, -1, 1);
  // The tube lies along the arm the ellipse is on — mouth up-left on the left
  // arm, up-right on the right — so dragging the ellipse down an arm slides
  // the tube down its own axis, the same way the ellipse moves.
  const lean = heldTubeLean(s);
  const axis = new THREE.Vector3()
    .copy(UP)
    .multiplyScalar(Math.cos(lean))
    .addScaledVector(right, Math.sin(lean));
  // The flame meets the glass on the underside of the leaning tube; upright,
  // at the vertex, it runs up the tube's middle, so the offset fades out there.
  const underside = new THREE.Vector3()
    .copy(right)
    .multiplyScalar(Math.sign(lean) * Math.cos(lean))
    .addScaledVector(UP, -Math.abs(Math.sin(lean)));
  const offset = TUBE_RADIUS * Math.abs(Math.sin(lean)) / Math.sin(HELD_TUBE_TILT);
  const along = V_TIP + (V_REACH - V_TIP) * (1 - Math.abs(s));

  const bottom = hotSpot
    .clone()
    .addScaledVector(axis, -along)
    .addScaledVector(underside, -offset);
  // Swinging upright through the vertex would push the bottom down into the
  // lamp: lift the tube just clear — as a hand does, out of the flame and over.
  const aside = Math.hypot(bottom.x - hotSpot.x, bottom.z - hotSpot.z);
  if (aside < LAMP_KEEP_OUT_RADIUS) {
    const floor = hotSpot.y - LAMP_TOP_BELOW_HOT_SPOT;
    if (bottom.y < floor) bottom.y = floor;
  }
  const jaws = bottom.clone().addScaledVector(axis, insertDepth);

  // The clamp's handle (its local -X) comes back towards the player's hand.
  const x = away.clone();
  const z = new THREE.Vector3().crossVectors(x, axis);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, axis, z));
  return { jaws, quaternion, bottom };
}
