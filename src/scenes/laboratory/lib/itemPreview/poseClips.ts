import * as THREE from "three";

import { pourPoseAt, type PouringItem } from "../pourPose";
import type { PoseOffset, TargetAnchor } from "./types";

/**
 * Pose clips: a use-animation as a function of its normalized time. The
 * project's animations are procedural (nothing is baked into the GLTFs), so a
 * "frozen frame" is a clip evaluated once at `normalizedTime` — nothing plays,
 * nothing needs cleaning up. A new use-animation = a new entry here; items
 * then name it in their data.
 *
 * A clip writes the item's ORIGIN in the world and its rotation.
 */
export type PoseClip = (
  t: number,
  item: PouringItem,
  anchor: TargetAnchor,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion,
) => void;

export const POSE_CLIPS: Readonly<Record<string, PoseClip>> = {
  /** A bottle tipping over a tube's mouth (`PourMotion`). */
  pour: (t, item, anchor, position, quaternion) => pourPoseAt(t, item, anchor.point, anchor.side, anchor.axis, position, quaternion),
};

const offsetQuaternion = new THREE.Quaternion();
const offsetEuler = new THREE.Euler();
const offsetVector = new THREE.Vector3();

/** Applies a rule's `PoseOffset` on top of a pose — position in the world, rotation in the item's own frame — and returns its scale. */
export function applyPoseOffset(offset: PoseOffset | undefined, position: THREE.Vector3, quaternion: THREE.Quaternion): number {
  if (!offset) return 1;
  if (offset.position) position.add(offsetVector.set(...offset.position));
  if (offset.rotationDeg) {
    const [x, y, z] = offset.rotationDeg;
    offsetEuler.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
    quaternion.multiply(offsetQuaternion.setFromEuler(offsetEuler));
  }
  return offset.scale ?? 1;
}
