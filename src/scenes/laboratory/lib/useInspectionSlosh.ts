import { useEffect, useRef } from "react";
import * as THREE from "three";
import { InspectionSlosh } from "./inspectionSlosh";
import type { ReagentMaterialBinding } from "./reagentMaterials";
import { useReagentInspectionStore } from "./useReagentInspectionStore";

/** Called from the existing inspection frame, never owns position or scale. */
export function useInspectionSlosh(instance: THREE.Object3D, instanceId: string) {
  const state = useRef({
    motion: new InspectionSlosh(), active: false,
    shakeRequestId: 0,
    base: new THREE.Quaternion(), axis: new THREE.Vector3(),
    world: new THREE.Quaternion(), roll: new THREE.Quaternion(),
  });
  const binding = instance.userData.reagentMaterials as ReagentMaterialBinding;
  const bindingRef = useRef(binding);

  useEffect(() => {
    bindingRef.current = binding;
  }, [binding]);

  useEffect(() => () => {
    if (useReagentInspectionStore.getState().inspectedId === instanceId) {
      useReagentInspectionStore.getState().setCanShake(instanceId, false);
      useReagentInspectionStore.getState().finishShake();
    }
  }, [instanceId]);

  return (group: THREE.Group, camera: THREE.Camera, delta: number, ready: boolean) => {
    const s = state.current;
    const inspection = useReagentInspectionStore.getState();
    const currentBinding = bindingRef.current;
    const u = currentBinding.liquid?.uniforms;
    const copper = currentBinding.copper;
    const inspecting = inspection.inspectedId === instanceId && !inspection.isClosing && !inspection.isTaking;
    inspection.setCanShake(instanceId, inspecting && ready && (!!u || !!copper) && (!u || u.uFillLevel.value > 0));
    // A second shake is allowed once the short control lock expires, even
    // though the previous liquid-settling tail is still running. Reset the
    // motion in-place and restore the original bottle orientation first, so
    // repeated shakes never accumulate tilt from the preceding cycle.
    if (inspection.isShaking && inspection.shakeRequestId !== s.shakeRequestId) {
      s.shakeRequestId = inspection.shakeRequestId;
      if (s.active) group.quaternion.copy(s.base);
      s.active = false;
    }
    if (!inspecting || !inspection.isShaking || (!u && !copper)) {
      if (s.active) {
        group.quaternion.copy(s.base);
        s.active = false;
        // Three.js shader uniforms are intentionally mutable frame state.
        // eslint-disable-next-line react-hooks/immutability
        if (u) u.uSloshX.value = u.uSloshZ.value = u.uSloshStrength.value = 0;
        copper?.shake(0, 0, 0);
      }
      return false;
    }
    if (!s.active) {
      s.active = true;
      s.motion.reset();
      s.base.copy(group.quaternion);
      // Camera-facing roll axis, expressed in the user's current bottle frame.
      // Works after yaw/pitch dragging and in every cabinet orientation.
      group.getWorldQuaternion(s.world);
      s.axis.set(0, 0, 1).applyQuaternion(camera.quaternion).applyQuaternion(s.world.invert()).normalize();
    }
    s.motion.advance(delta);
    if (s.motion.controlsUnlocked && inspection.isShakeLocked) {
      inspection.releaseShakeLock();
    }
    group.quaternion.copy(s.base).multiply(s.roll.setFromAxisAngle(s.axis, s.motion.tilt));
    if (u) {
      const fill = Math.max(u.uFillLevel.value, 0.05);
      u.uSloshX.value = s.motion.angle * s.axis.z * s.motion.settle / fill;
      u.uSloshZ.value = -s.motion.angle * s.axis.x * s.motion.settle / fill;
      u.uSloshStrength.value = s.motion.strength * s.motion.settle;
    }
    copper?.shake(s.motion.tilt, s.motion.strength * s.motion.settle, s.motion.elapsed);
    if (s.motion.done) {
      group.quaternion.copy(s.base);
      if (u) u.uSloshX.value = u.uSloshZ.value = u.uSloshStrength.value = 0;
      copper?.shake(0, 0, 0);
      s.active = false;
      inspection.finishShake();
    }
    return true;
  };
}
