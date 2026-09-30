import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { useBunsenStandScene } from "../lib/bunsenStandAssembly";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { Position3 } from "../lib/layout";
import { BUNSEN_STAND_TRAY_REST_POSITION, useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";

/** Held-tray true/real-world size — matches `BunsenStandInstance`'s own flight target scale. */
const TRAY_WORLD_SCALE = 1;

/**
 * Static copy of the stand resting on the held tray, rendered as a CHILD of
 * `LabTrayInstance`'s own group (see that file) — ordinary Three.js
 * parent/child inheritance keeps it tracking the tray's live held/return
 * transform for free, exactly like `ReagentStaticDisplay` does for taken
 * reagents. `worldScale` holds it at a constant real-world size regardless
 * of the tray's own changing scale (1 at rest, `heldTray.scale` while held)
 * — same compensation trick, see `ReagentStaticDisplay`'s doc for why this
 * has to read the parent's LOCAL `.scale` directly rather than
 * `getWorldScale()` (a one-frame-lag issue during the tray's own pickup/
 * return tween). Clicking it sends the stand back to its shelf, via
 * `useBunsenStandStorageStore.requestReturn` — mirrors
 * `ReagentStaticDisplay`'s own return-to-shelf click.
 */
export function BunsenStandTrayDisplay() {
  const scene = useBunsenStandScene();
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    disableRaycast(clone);
    return clone;
  }, [scene]);

  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);

  useEffect(() => {
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, () => {});
  }, [instance]);
  useEffect(() => {
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  useFrame(() => {
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    group.scale.setScalar(TRAY_WORLD_SCALE / parent.scale.x);
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const group = groupRef.current;
    if (!group) return;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();
    group.getWorldPosition(wp);
    group.getWorldQuaternion(wq);
    group.getWorldScale(ws);
    useBunsenStandStorageStore
      .getState()
      .requestReturn([wp.x, wp.y, wp.z] as Position3, [wq.x, wq.y, wq.z, wq.w], ws.x);
  };

  return (
    <group
      ref={groupRef}
      position={BUNSEN_STAND_TRAY_REST_POSITION}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        setHovered(true);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "auto";
        setHovered(false);
      }}
    >
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={hovered} />
      <mesh geometry={hoverHitboxGeometry}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

