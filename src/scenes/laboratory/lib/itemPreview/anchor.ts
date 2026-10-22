import * as THREE from "three";

import type { TargetAnchor } from "./types";

export function createAnchor(): TargetAnchor {
  return { point: new THREE.Vector3(), side: new THREE.Vector3(1, 0, 0), axis: new THREE.Vector3(0, 0, 1), location: null };
}
