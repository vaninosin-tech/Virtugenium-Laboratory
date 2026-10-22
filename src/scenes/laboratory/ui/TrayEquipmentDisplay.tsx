import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { Position3 } from "../lib/layout";
import { createHoverHitboxGeometry } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { TAKE_FROM_TRAY, takeFromTray, trayUnloadPlace } from "../lib/trayUnloadPlace";
import { useHandStore } from "../lib/useHandStore";
import { pressToTake } from "../lib/pressToTake";
import { PourMotion } from "./StandMotion";
import { useStandHintStore } from "../lib/useStandHintStore";

/** Held-tray true/real-world size — matches `useShelfTrayFlight`'s own flight target scale. */
const TRAY_WORLD_SCALE = 1;

/**
 * On the tray the lamp stands inside the stand's hitbox (its arm reaches
 * over it): where the pointer is on both, it is the lamp — the stand lets
 * the event through to it. Since the lamp comes off the tray on its own
 * (VL-020), it could not be taken at all otherwise.
 */
const yieldsToLamp = (what: "stand" | "lamp", event: ThreeEvent<PointerEvent | MouseEvent>) =>
  what === "stand" && event.intersections.some((hit) => hit.object.userData.trayEquipment === "lamp");

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
  what,
  owner,
  rotationY = 0,
}: {
  readonly instance: THREE.Object3D;
  readonly restPosition: Position3;
  /** What it is, when taken into the hand at the table or the hood (VL-017). */
  readonly what: "stand" | "lamp";
  /** Its id in the hand and for the hover caption. */
  readonly owner: string;
  /** Turned on the tray — round to face the player on the tray in the hood. */
  readonly rotationY?: number;
  readonly onReturn: (worldPos: Position3, worldQuat: readonly [number, number, number, number], worldScale: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const held = useHandStore((state) => state.held?.instanceId === owner);
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

  // While a bottle is being inspected (ВЗЯТЬ / ОСТАВИТЬ), the tray is out of play.
  const inspecting = useReagentInspectionStore((state) => state.inspectedId !== null);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (yieldsToLamp(what, event)) return;
    event.stopPropagation();
    if (useReagentInspectionStore.getState().inspectedId !== null) return;
    // At the table or the hood it was taken into the hand on the press.
    if (trayUnloadPlace()) return;
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
      rotation={[0, rotationY, 0]}
      onClick={handleClick}
      // At the table or the hood: into the hand, to be set down in its place (VL-017/018).
      onPointerDown={(event) => {
        if (yieldsToLamp(what, event)) return;
        if (!trayUnloadPlace() || useReagentInspectionStore.getState().inspectedId !== null) return;
        event.stopPropagation();
        pressToTake(event.nativeEvent, () => {
          if (!takeFromTray(what, owner)) return false;
          document.body.style.cursor = "auto";
          setHovered(false);
          return true;
        });
      }}
      onPointerOver={(event) => {
        if (yieldsToLamp(what, event)) return;
        event.stopPropagation();
        if (useReagentInspectionStore.getState().inspectedId !== null) return;
        document.body.style.cursor = "pointer";
        setHovered(true);
        if (trayUnloadPlace()) useStandHintStore.getState().showLabel(owner, TAKE_FROM_TRAY, { kind: what, place: "tray" });
      }}
      onPointerMove={(event) => {
        // Onto the lamp inside the stand's hitbox, the lamp is the one lit; off it, the stand again.
        if (what !== "stand" || useReagentInspectionStore.getState().inspectedId !== null) return;
        const onLamp = yieldsToLamp(what, event);
        if (onLamp === !hovered) return;
        setHovered(!onLamp);
        if (onLamp) useStandHintStore.getState().hide(owner);
        else if (trayUnloadPlace()) useStandHintStore.getState().showLabel(owner, TAKE_FROM_TRAY, { kind: what, place: "tray" });
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "auto";
        setHovered(false);
        useStandHintStore.getState().hide(owner);
      }}
    >
      <PourMotion instanceId={owner} pourPointHeight={0} keepCap>
        <primitive object={instance} />
        <ReagentHoverRim object={instance} active={(hovered && !inspecting) || held} />
      </PourMotion>
      <mesh geometry={hoverHitboxGeometry} userData={{ trayEquipment: what }}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
