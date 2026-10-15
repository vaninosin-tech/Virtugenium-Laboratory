import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { TUBE_CLAMP_PIVOT, useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { Position3 } from "../lib/layout";
import {
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
import { useNormalHoverOutline } from "./NormalHoverOutline";
import { SpiritBurner } from "./SpiritBurner";
import { StandStation } from "./StandStation";
import { useStandMotionStore } from "../lib/useStandMotionStore";
import { AWAY_AT_TABLE, LAMP_TABLE_SPOT } from "./equipmentPlaces";
import { EQUIPMENT_INSTANCE, takeEquipment } from "../lib/equipmentCarry";
import { pressToTake } from "../lib/pressToTake";
import { useHandStore } from "../lib/useHandStore";
import { ArrivalFlight, PourMotion } from "./StandMotion";

/** Whether a press or hover over the stand's hitbox is really on its clamp or the tube in it (`StandStation`) — those are taken on their own. */
const onClampedTube = (event: ThreeEvent<PointerEvent>) =>
  event.intersections.some((hit) => {
    for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
      if (object.userData.clampedTube || object.userData.standClamp) return true;
    }
    return false;
  });

/**
 * The stand's final resting place вЂ” rendered once `useBunsenStandStorageStore`'s
 * `onWorkbench` flips true (see `CameraRig.startReturning`, which calls
 * `transferToWorkbench` the same frame reagents/test-tubes transfer off the
 * tray). Unlike the reagent workbench grid (`DraggableWorkbenchReagent`),
 * this is genuine free placement, not a fixed slot with drag-to-swap/
 * drag-to-return: the player explicitly asked to be able to move it around
 * the table, so a drop anywhere just persists that spot
 * (`setTablePosition`), no snap-back. It is carried in the hand like
 * everything else on the table (`equipmentCarry`, `PourMotion`): set down
 * on the table where it is let go, or onto the tray.
 */
export function BunsenStandWorkbenchDisplay({ tableWorldPosition }: { readonly tableWorldPosition: Position3 }) {
  const scene = useBunsenStandScene();
  const [hovered, setHovered] = useState(false);
  const held = useHandStore((state) => state.held?.instanceId === EQUIPMENT_INSTANCE.stand);

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
  const worldY = tableWorldPosition[1] + counterSurfaceY + STAND_BASE_BOTTOM_OFFSET;

  // Kept at its spot on the table (carried, it moves inside: `PourMotion`).
  // Before the first frame (a layout effect), so whatever flies in under it
  // (`ArrivalFlight`) measures its start against where the stand really is.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.position.set(
      tableWorldPosition[0] + tablePosition.x,
      worldY,
      tableWorldPosition[2] + tablePosition.z,
    );
  }, [tablePosition, tableWorldPosition, worldY]);

  // In the hand like everything else on the table (`equipmentCarry`): a
  // press takes it — dragged or clicked — onto the tray or elsewhere on the
  // table. A press on the tube in its clamp takes the tube instead: the
  // stand's hitbox is all round it, so it gives way to the tube.
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || tubeHeld || onClampedTube(event)) return;
    event.stopPropagation();
    pressToTake(event.nativeEvent, () => takeEquipment("stand"));
  };

  const arrival = useStandMotionStore((state) => (state.equipmentArrival?.what === "stand" ? state.equipmentArrival : null));
  // Hovered: the silhouette outline (`NormalHoverOutline`); in the hand: the on-object rim.
  useNormalHoverOutline({ root: instance, active: hovered && !held });

  return (
    <group ref={groupRef} rotation={[0, STAND_TABLE_YAW, 0]}>
      {/* Set down off the tray: seen going from the hand into its place (`placementGhosts` shows where). */}
      <ArrivalFlight arrival={arrival} fromFirstFrame>
      <PourMotion instanceId={EQUIPMENT_INSTANCE.stand} pourPointHeight={0} keepCap obstacle={false}>
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={held} />
      <mesh
        geometry={hoverHitboxGeometry}
        onPointerDown={handlePointerDown}
        onPointerOver={(event) => {
          if (onClampedTube(event)) return;
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
        <meshBasicMaterial visible={false} />
      </mesh>
      <StandStation location="workbench" away={AWAY_AT_TABLE} tube={clampedTube} crackZone={crackZone} />
      </PourMotion>
      </ArrivalFlight>
    </group>
  );
}



/** The spirit lamp on the table, in its own place — whether the stand is on the table or not. */
export function LoneSpiritLampOnWorkbench({ tableWorldPosition }: { readonly tableWorldPosition: Position3 }) {
  const counterSurfaceY = useWorkbenchReagentAreaStore((state) => state.config.originY);
  const arrival = useStandMotionStore((state) => (state.equipmentArrival?.what === "lamp" ? state.equipmentArrival : null));
  return (
    <group
      position={[
        tableWorldPosition[0] + LAMP_TABLE_SPOT.x,
        tableWorldPosition[1] + counterSurfaceY,
        tableWorldPosition[2] + LAMP_TABLE_SPOT.z,
      ]}
      rotation={[0, STAND_TABLE_YAW, 0]}
    >
      {/* Set down off the tray: seen going from the hand into its place. */}
      <ArrivalFlight arrival={arrival} fromFirstFrame>
        {/* Carried in the hand off the table (`equipmentCarry`). */}
        <PourMotion instanceId={EQUIPMENT_INSTANCE.lamp} pourPointHeight={0} keepCap obstacle={false}>
          <SpiritBurner position={[0, 0, 0]} place="workbench" />
        </PourMotion>
      </ArrivalFlight>
    </group>
  );
}
