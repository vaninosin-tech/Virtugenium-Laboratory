import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { Position3 } from "../lib/layout";
import { createHoverHitboxGeometry } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";

/** Held-tray true/real-world size — matches `useShelfTrayFlight`'s own flight target scale. */
const TRAY_WORLD_SCALE = 1;

/**
 * Static copy of a piece of equipment (the stand, the spirit lamp) resting
 * on the held tray, rendered as a CHILD of `LabTrayInstance`'s own group —
 * ordinary parent/child inheritance keeps it on the tray's live held/return
 * transform, exactly like `ReagentStaticDisplay` does for taken reagents.
 * The scale compensation reads the parent's LOCAL `.scale` directly rather
 * than `getWorldScale()` — see `ReagentStaticDisplay` for the one-frame lag
 * that avoids. Clicking it sends the item back to its shelf: `onReturn` gets
 * the exact world pose to fly home from (`useShelfTrayFlight`).
 *
 * @param instance the item's own clone, raycasting already disabled
 */
export function TrayEquipmentDisplay({
  instance,
  restPosition,
  onReturn,
}: {
  readonly instance: THREE.Object3D;
  readonly restPosition: Position3;
  readonly onReturn: (worldPos: Position3, worldQuat: readonly [number, number, number, number], worldScale: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);

  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);
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
    document.body.style.cursor = "auto";
    onReturn([wp.x, wp.y, wp.z], [wq.x, wq.y, wq.z, wq.w], ws.x);
  };

  return (
    <group
      ref={groupRef}
      position={restPosition}
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
