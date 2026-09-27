import { useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { Position3 } from "../lib/layout";
import { fillTestTubeContents, resolveTubeContents } from "../lib/testTubeContents";
import { prepareTestTube } from "../lib/testTubeMaterials";
import {
  STAND_BASE_BOTTOM_OFFSET,
  TUBE_RING_INSERT_DEPTH,
  TUBE_RING_LOCAL_OFFSET,
  useBunsenStandStorageStore,
} from "../lib/useBunsenStandStorageStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { SpiritBurner } from "./SpiritBurner";

const MODEL_PATH = "/assets/models/BunsenStand.glb";
const TUBE_MODEL_PATH = "/assets/models/LabTestTube.glb";
const ATTACHED_TUBE_LOCAL_POSITION: Position3 = [
  TUBE_RING_LOCAL_OFFSET[0],
  TUBE_RING_LOCAL_OFFSET[1] - TUBE_RING_INSERT_DEPTH,
  TUBE_RING_LOCAL_OFFSET[2],
];
const ATTACHED_TUBE_TARGET = new THREE.Vector3(...ATTACHED_TUBE_LOCAL_POSITION);
/** Same damping rate `WorkbenchTestTubeRackInstance` uses for its own shelf<->stage moves вЂ” reaches ~95% of the way to a target in about 0.5s, a deliberate "clips into place" feel rather than an instant pop. */
const CLIP_IN_DAMPING = 10;
/** "Close enough" to the ring's own resting spot to snap the last bit and stop animating. */
const CLIP_IN_EPSILON = 0.004;

/**
 * The test tube currently clipped into `TubeRing` вЂ” a CHILD of the stand's
 * own group (see `BunsenStandWorkbenchDisplay`'s return below), so it
 * travels with the stand for free while it's dragged around the table,
 * instead of needing its own live position recompute every frame. Its rack
 * slot (`InspectableTestTubeSlot`, `index === attachedTubeSlotIndex`) shrinks
 * to an empty hole while this renders вЂ” see `attachedTubeSlotIndex`'s doc.
 *
 * Mounts starting at wherever the tube visually was the instant it clipped
 * in (`attachStartWorldPosition`, captured by `InspectableTestTubeSlot`'s
 * own click handler) and eases from there into `ATTACHED_TUBE_LOCAL_POSITION`
 * вЂ” reads as the tube being clipped into the ring instead of popping
 * straight into it. Click to detach: the rack slot flies back in with its
 * own matching "arrival" animation (see `InspectableTestTubeSlot`'s
 * `visuallyFilled` effect); this component itself just unmounts, same
 * "vanish here the instant it reappears there" convention
 * `ReagentStaticDisplay`'s shelf-return already uses.
 */
function AttachedTube({ slotIndex }: { readonly slotIndex: number }) {
  const { scene } = useGLTF(TUBE_MODEL_PATH);
  const contents = useTestTubeStorageStore((state) => state.workbenchTestTubes[slotIndex]?.contents);

  const instance = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => prepareTestTube(instance), [instance]);
  useEffect(() => disableRaycast(instance), [instance]);
  useEffect(() => {
    const configs = resolveTubeContents(contents);
    if (configs.length === 0) return;
    const binding = fillTestTubeContents(instance, configs);
    return () => binding.dispose();
  }, [instance, contents]);

  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);
  useEffect(() => {
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  const [hovered, setHovered] = useState(false);

  const groupRef = useRef<THREE.Group>(null);
  // Whether this run is still easing toward the ring вЂ” cleared once it
  // settles, so `useFrame` can skip touching position at all afterward
  // (a plain ref, not state: this shouldn't trigger a re-render).
  const arrivingRef = useRef(true);

  // Runs before paint (unlike a plain `useEffect`) so the tube's very first
  // rendered frame already sits at its captured start pose instead of
  // flashing at the group's local origin for one frame first.
  useLayoutEffect(() => {
    const group = groupRef.current;
    const parent = group?.parent;
    const startWorldPos = useBunsenStandStorageStore.getState().attachStartWorldPosition;
    if (!group || !parent || !startWorldPos) {
      arrivingRef.current = false;
      return;
    }
    group.position.copy(parent.worldToLocal(new THREE.Vector3(...startWorldPos)));
    arrivingRef.current = true;
    // Mount-time-only capture вЂ” deliberately not reactive to later store
    // changes (a later attach mounts a brand new instance of this component
    // anyway, since `slotIndex` changing remounts it via its parent's key).
  }, []);

  useFrame((_, delta) => {
    if (!arrivingRef.current) return;
    const group = groupRef.current;
    if (!group) return;
    group.position.x = THREE.MathUtils.damp(group.position.x, ATTACHED_TUBE_TARGET.x, CLIP_IN_DAMPING, delta);
    group.position.y = THREE.MathUtils.damp(group.position.y, ATTACHED_TUBE_TARGET.y, CLIP_IN_DAMPING, delta);
    group.position.z = THREE.MathUtils.damp(group.position.z, ATTACHED_TUBE_TARGET.z, CLIP_IN_DAMPING, delta);
    if (group.position.distanceTo(ATTACHED_TUBE_TARGET) < CLIP_IN_EPSILON) {
      group.position.copy(ATTACHED_TUBE_TARGET);
      arrivingRef.current = false;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={hovered} />
      <mesh
        geometry={hoverHitboxGeometry}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          useBunsenStandStorageStore.getState().detachTestTube();
        }}
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
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

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
  const { scene } = useGLTF(MODEL_PATH);
  const { camera, gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const tablePosition = useBunsenStandStorageStore((state) => state.tablePosition);
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
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
      <ReagentHoverRim object={instance} active={hovered || dragging} />
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
      {/* `key` forces a fresh mount (and so a fresh clip-in animation) any
          time the attached slot itself changes, not just on the null<->set
          edges вЂ” e.g. a different tube clipping in while one's already
          attached. */}
      {attachedTubeSlotIndex !== null && <AttachedTube key={attachedTubeSlotIndex} slotIndex={attachedTubeSlotIndex} />}
      <SpiritBurner />
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
useGLTF.preload(TUBE_MODEL_PATH);
