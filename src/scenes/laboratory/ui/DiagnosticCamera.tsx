import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { CLAMP_TUBE_MOUTH } from "../lib/useStandMotionStore";

/**
 * Developer-only spectator camera for recording the real pour from the side (`window.__diagCamera = { dist, lateral, height, targetY, fov }`).
 * It only places the render camera after the player camera has run; no simulation object, position or clock is touched,
 * and without the flag (or outside the dev build) it does nothing.
 */
interface DiagCameraSettings { dist?: number; lateral?: number; height?: number; targetY?: number; targetSide?: number; fov?: number }

const up = new THREE.Vector3(0, 1, 0);
const side = new THREE.Vector3();
const across = new THREE.Vector3();
const target = new THREE.Vector3();

export function DiagnosticCamera() {
  useFrame(({ camera }) => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    const settings = (window as Window & { __diagCamera?: DiagCameraSettings }).__diagCamera;
    if (!settings || !CLAMP_TUBE_MOUTH.valid) return;
    // Same horizontal direction the stand uses for the bottle side: from the rod to the tube mouth.
    side.subVectors(CLAMP_TUBE_MOUTH.point, CLAMP_TUBE_MOUTH.rod).setY(0);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    across.crossVectors(up, side).normalize();
    target.copy(CLAMP_TUBE_MOUTH.point).addScaledVector(side, settings.targetSide ?? 0.02);
    target.y += settings.targetY ?? -0.035;
    camera.position.copy(target).addScaledVector(across, settings.dist ?? 0.3)
      .addScaledVector(side, settings.lateral ?? 0);
    camera.position.y += settings.height ?? 0.02;
    camera.lookAt(target);
    const perspective = camera as THREE.PerspectiveCamera;
    if (settings.fov && perspective.fov !== settings.fov) { perspective.fov = settings.fov; perspective.updateProjectionMatrix(); }
  });
  return null;
}
