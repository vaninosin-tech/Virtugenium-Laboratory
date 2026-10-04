import { useEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { TUBE_CLAMP_PIVOT, useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { CAMERA_TARGETS, type Position3 } from "../lib/layout";
import { STAND_BASE_BOTTOM_OFFSET, useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useStandStationStore } from "../lib/useStandStationStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { SpiritBurner } from "./SpiritBurner";
import { StandStation, lampLayout } from "./StandStation";

/**
 * "Away from the player" at the table: the table viewpoint's own look
 * direction, flattened. The stand is never turned on the table, so its local
 * space is the world's.
 */
const AWAY_AT_TABLE = new THREE.Vector3(Math.sin(CAMERA_TARGETS.table.yaw), 0, -Math.cos(CAMERA_TARGETS.table.yaw)).normalize();
/** A press that moves the stand less than this is a click (walk up to it), not a drag. */
const CLICK_SLOP = 0.004;

/**
 * The stand's final resting place вЂ” rendered once `useBunsenStandStorageStore`'s
 * `onWorkbench` flips true (see `CameraRig.startReturning`, which calls
 * `transferToWorkbench` the same frame reagents/test-tubes transfer off the
 * tray). Unlike the reagent workbench grid (`DraggableWorkbenchReagent`),
 * this is genuine free placement, not a fixed slot with drag-to-swap/
 * drag-to-return: the player explicitly asked to be able to move it around
 * the table, so a drop anywhere just persists that spot
 * (`setTablePosition`), no snap-back. Implemented with its own local
 * pointermove/pointerup listeners (a horizontal-plane raycast against the
 * camera, same technique `CameraRig`'s own table drags use) rather than
 * hooking into `CameraRig`'s global pointer handling вЂ” self-contained, no
 * changes needed to that already-large file for a single free-standing prop.
 */
export function BunsenStandWorkbenchDisplay({ tableWorldPosition }: { readonly tableWorldPosition: Position3 }) {
  const scene = useBunsenStandScene();
  const { camera, gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const tablePosition = useBunsenStandStorageStore((state) => state.tablePosition);
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const clampedTube = useTestTubeStorageStore((state) =>
    attachedTubeSlotIndex === null ? undefined : state.workbenchTestTubes[attachedTubeSlotIndex],
  );
  const crackZone = useHeatingStore((state) => (state.phase === "cracked" ? state.crackZone : null));
  // At the stand the camera is right on it — no hover outline then.
  const atStand = useStandStationStore((state) => state.viewing);
  // A carried test tube's own click handler decides release-vs-attach by
  // proximity to the ring alone (`InspectableTestTubeSlot`'s `nearRingRef`) вЂ”
  // it never checks whether the click ALSO hit the stand's own hitbox. Left
  // unguarded, a click anywhere on the stand's body (not just near the ring)
  // both started dragging the stand here AND, since that click usually isn't
  // within the ring's small attach radius, released the tube back to the
  // rack at the very same time вЂ” read as "grabbing the stand drops my
  // tube". The stand simply isn't draggable while a tube is being carried.
  const tubeHeld = useTestTubeDragStore((state) => state.heldInstanceId !== null);
  // Same counter-surface height reagents rest at (`useWorkbenchReagentAreaStore`'s
  // `originY`, ~0.9m) вЂ” `tableWorldPosition[1]` alone is the workbench
  // MODEL's own origin (near its base/legs), not the tabletop surface; using
  // it directly rendered the stand down inside the cabinet body, well below
  // the visible countertop.
  const counterSurfaceY = useWorkbenchReagentAreaStore((state) => state.config.originY);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    disableRaycast(clone);
    // The clamp is drawn by `StandStation`, which can take it off the boss.
    const clampPivot = clone.getObjectByName(TUBE_CLAMP_PIVOT);
    if (clampPivot) clampPivot.visible = false;
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

  const groupRef = useRef<THREE.Group>(null);
  const worldY = tableWorldPosition[1] + counterSurfaceY + STAND_BASE_BOTTOM_OFFSET;

  // Kept in sync with the live store position whenever NOT actively
  // dragging (a fresh mount, or `tablePosition` changing from elsewhere) вЂ”
  // while dragging, the imperative pointermove handler below owns
  // `group.position` directly every frame, the same "don't fight the drag
  // with a declarative prop" rule `DraggableWorkbenchReagent` follows.
  useEffect(() => {
    if (dragging) return;
    const group = groupRef.current;
    if (!group) return;
    group.position.set(
      tableWorldPosition[0] + tablePosition.x,
      worldY,
      tableWorldPosition[2] + tablePosition.z,
    );
  }, [dragging, tablePosition, tableWorldPosition, worldY]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    // Deliberately does NOT mark itself as "pressed" for the held tube's own
    // click-drop listener the way a jar's `handlePointerDown` does (see
    // `markPickablePressed`'s doc) вЂ” the stand's hitbox covers the whole
    // physical model, including right over `TubeRing`, and that listener's
    // own ring-proximity check (`nearRingRef`) is what decides whether a
    // click there attaches the tube instead of dropping it; marking this
    // press "handled" here would short-circuit that check before it ever
    // ran, breaking the attach gesture.
    if (event.button !== 0 || tubeHeld) return;
    event.stopPropagation();
    const group = groupRef.current;
    if (!group) return;

    const raycaster = new THREE.Raycaster();
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, worldY, 0),
    );
    const dragPoint = new THREE.Vector3();
    const rect = gl.domElement.getBoundingClientRect();
    const ndcAt = (clientX: number, clientY: number) =>
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );

    raycaster.setFromCamera(ndcAt(event.clientX, event.clientY), camera);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    const planeOffset = group.position.clone().sub(dragPoint);
    const pressedAt = group.position.clone();

    setDragging(true);
    document.body.style.cursor = "grabbing";

    const handleMove = (moveEvent: PointerEvent) => {
      raycaster.setFromCamera(ndcAt(moveEvent.clientX, moveEvent.clientY), camera);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      group.position.set(dragPoint.x + planeOffset.x, worldY, dragPoint.z + planeOffset.z);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      setDragging(false);
      document.body.style.cursor = "auto";
      if (group.position.distanceTo(pressedAt) < CLICK_SLOP) {
        // A click, not a drag: walk up to the stand.
        group.position.copy(pressedAt);
        if (!useHeatingStore.getState().active) useStandStationStore.getState().open();
        return;
      }
      useBunsenStandStorageStore
        .getState()
        .setTablePosition(group.position.x - tableWorldPosition[0], group.position.z - tableWorldPosition[2]);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <group ref={groupRef}>
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={(hovered || dragging) && !atStand} />
      <mesh
        geometry={hoverHitboxGeometry}
        onPointerDown={handlePointerDown}
        onPointerOver={(event) => {
          event.stopPropagation();
          if (!tubeHeld) document.body.style.cursor = "grab";
          setHovered(true);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "auto";
          setHovered(false);
        }}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <StandStation location="workbench" away={AWAY_AT_TABLE} tube={clampedTube} crackZone={crackZone} />
    </group>
  );
}


/** Table-local spot of a lamp on the table without the stand — where `StandStation` would put it. */
const LONE_LAMP_OFFSET = lampLayout(AWAY_AT_TABLE).lamp;

/**
 * The spirit lamp on the table while the stand is not (still in the cabinet,
 * or already in the hood). It stands where it will be beside the stand —
 * the spot it moves to when the stand arrives — and works the same: cap,
 * light, put out (`standTableActions`).
 */
export function LoneSpiritLampOnWorkbench({ tableWorldPosition }: { readonly tableWorldPosition: Position3 }) {
  const tablePosition = useBunsenStandStorageStore((state) => state.tablePosition);
  const counterSurfaceY = useWorkbenchReagentAreaStore((state) => state.config.originY);
  return (
    <group
      position={[
        tableWorldPosition[0] + tablePosition.x,
        tableWorldPosition[1] + counterSurfaceY,
        tableWorldPosition[2] + tablePosition.z,
      ]}
    >
      <SpiritBurner position={LONE_LAMP_OFFSET} />
    </group>
  );
}
