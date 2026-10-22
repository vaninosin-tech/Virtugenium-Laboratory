import { useEffect, useMemo, useRef, useState } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { TUBE_CLAMP_PIVOT, useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { useStandHintStore } from "../lib/useStandHintStore";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { CAMERA_TARGETS, type Position3 } from "../lib/layout";
import {
  DEFAULT_TABLE_POSITION,
  STAND_BASE_BOTTOM_OFFSET,
  STAND_TABLE_YAW,
  useBunsenStandStorageStore,
} from "../lib/useBunsenStandStorageStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { SpiritBurner } from "./SpiritBurner";
import { StandStation, lampLayout } from "./StandStation";
import { takeEquipment, useEquipmentPlacementStore } from "../lib/equipmentPlacement";
import { pressToTake } from "../lib/pressToTake";
import { useHandStore } from "../lib/useHandStore";
import { EquipmentCarrier } from "./EquipmentCarrier";

/**
 * "Away from the player" at the table: the table viewpoint's own look
 * direction, flattened. The stand is never turned on the table, so its local
 * space is the world's.
 */
const AWAY_AT_TABLE = new THREE.Vector3(Math.sin(CAMERA_TARGETS.table.yaw), 0, -Math.cos(CAMERA_TARGETS.table.yaw))
  .normalize()
  // In the stand's own space: it stands turned round on the table (`STAND_TABLE_YAW`).
  .applyAxisAngle(new THREE.Vector3(0, 1, 0), -STAND_TABLE_YAW);
/** The stand's base: half its width — how far a carried stand is kept off other things on the worktop. */
const STAND_RADIUS = 0.06;
/** The spirit lamp: 7.6 cm across. */
const LAMP_RADIUS = 0.038;

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
  const [hovered, setHovered] = useState(false);

  const tablePosition = useBunsenStandStorageStore((state) => state.tablePosition);
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const clampedTube = useTestTubeStorageStore((state) =>
    attachedTubeSlotIndex === null ? undefined : state.workbenchTestTubes[attachedTubeSlotIndex],
  );
  const crackZone = useHeatingStore((state) => (state.phase === "cracked" ? state.crackZone : null));
  // At the stand the camera is right on it — no hover outline then.
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
  const carried = useHandStore((state) => state.held?.kind === "equipment" && state.held.what === "stand" && state.held.location === "workbench");
  const worldY = tableWorldPosition[1] + counterSurfaceY + STAND_BASE_BOTTOM_OFFSET;

  // Kept in sync with the live store position whenever NOT actively
  // dragging (a fresh mount, or `tablePosition` changing from elsewhere) вЂ”
  // while dragging, the imperative pointermove handler below owns
  // `group.position` directly every frame, the same "don't fight the drag
  // with a declarative prop" rule `DraggableWorkbenchReagent` follows.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.position.set(
      tableWorldPosition[0] + tablePosition.x,
      worldY,
      tableWorldPosition[2] + tablePosition.z,
    );
  }, [tablePosition, tableWorldPosition, worldY]);

  // The right button takes the stand into the hand (VL-018): carried over the
  // worktop and set down anywhere on it, or on the tray — the same as a jar.
  // A carried tube's own click decides release-vs-attach by proximity to the
  // ring, so while a tube is carried the stand is not to be grabbed.
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 2 || tubeHeld) return;
    event.stopPropagation();
    pressToTake(event.nativeEvent, () => takeEquipment("stand", "workbench"));
  };

  return (
    <group ref={groupRef} rotation={[0, STAND_TABLE_YAW, 0]}>
     <EquipmentCarrier what="stand" location="workbench" radius={STAND_RADIUS}>
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={hovered || carried} />
      <mesh
        geometry={hoverHitboxGeometry}
        onPointerDown={handlePointerDown}
        onPointerOver={(event) => {
          event.stopPropagation();
          if (!tubeHeld) document.body.style.cursor = "grab";
          setHovered(true);
          useStandHintStore.getState().showLabel("stand-table", "", { kind: "stand", place: "workbench" });
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "auto";
          setHovered(false);
          useStandHintStore.getState().hide("stand-table");
        }}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <StandStation location="workbench" away={AWAY_AT_TABLE} tube={clampedTube} crackZone={crackZone} />
     </EquipmentCarrier>
    </group>
  );
}


/**
 * The lamp's own spot on the table (VL-020): where it used to stand beside the
 * stand in the stand's default place — so the table looks as it did — but
 * fixed, not following the stand when it is dragged. The lamp is its own
 * piece of equipment, heated over by the clamp off the stand or by a tube in
 * the hand wherever it stands.
 */
const LAMP_TABLE_SPOT = (() => {
  const offset = new THREE.Vector3(...lampLayout(AWAY_AT_TABLE).lamp).applyAxisAngle(new THREE.Vector3(0, 1, 0), STAND_TABLE_YAW);
  return { x: DEFAULT_TABLE_POSITION.x + offset.x, z: DEFAULT_TABLE_POSITION.z + offset.z };
})();

/** The spirit lamp on the table, in its own place — whether the stand is on the table or not. */
export function LoneSpiritLampOnWorkbench({ tableWorldPosition }: { readonly tableWorldPosition: Position3 }) {
  const counterSurfaceY = useWorkbenchReagentAreaStore((state) => state.config.originY);
  // Where the player last set it down, or its own spot.
  const spot = useEquipmentPlacementStore((state) => state.lampTable) ?? LAMP_TABLE_SPOT;
  return (
    <group
      position={[
        tableWorldPosition[0] + spot.x,
        tableWorldPosition[1] + counterSurfaceY,
        tableWorldPosition[2] + spot.z,
      ]}
      rotation={[0, STAND_TABLE_YAW, 0]}
    >
      <EquipmentCarrier what="lamp" location="workbench" radius={LAMP_RADIUS}>
        <SpiritBurner position={[0, 0, 0]} place="workbench" />
      </EquipmentCarrier>
    </group>
  );
}
