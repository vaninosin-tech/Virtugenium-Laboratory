import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { handActionFor, heatInHandAction, jarPourAction, standActionFor } from "../lib/standTableActions";
import { JAR_AIM, jarAt } from "../lib/pourSources";
import { hoveredDragTarget, resolveDragTargets, useDragTargetStore } from "../lib/dragTargets";
import { carriedObstacleIds } from "../lib/equipmentCarry";
import { HAND, useHandStore, type HandAim, type HeldItem } from "../lib/useHandStore";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { WORKBENCH_CARRY } from "../lib/tableTray";
import { trayHandAction, trayUnloadPlace } from "../lib/trayUnloadPlace";
import { useWorkbenchReservationStore, workbenchInsertIndex } from "../lib/workbenchLayout";
import { constrainOnWorktop } from "../lib/worktopBounds";
import { clearGhostShape } from "../lib/handGhost";
import { HandGhosts } from "./HandGhosts";
import { sharedMouseNdc, useTestTubeDragStore } from "../lib/useTestTubeDragStore";

/** How high above the worktop the held item is carried — lifted clear of it, its shadow right under it (VL-018). */
const CARRY_LIFT = 0.045;
/**
 * The hand stays this close (horizontally) to the item's place: across the
 * whole worktop (a bottle at the hood's far end is ~0.7 m from the stand),
 * not off across the room.
 */
const REACH = 1.3;


/**
 * Drives the hand (VL-015) while something is held: holds Pointer Lock so
 * the cursor is gone and the mouse moves the item, keeps the scene's own
 * pointer events off (under Pointer Lock they would all land on wherever the
 * cursor froze), finds what a click would do (`handActionFor`), does it on a
 * left click, and puts the item back on a right click or when the lock is
 * lost (Esc). Mounted once in the canvas.
 */
export function HandController() {
  const { gl, camera, setEvents } = useThree();
  const held = useHandStore((state) => state.held);
  const s = useMemo(
    () => ({ raycaster: new THREE.Raycaster(), plane: new THREE.Plane(), hit: new THREE.Vector3(), projected: new THREE.Vector3() }),
    [],
  );

  useEffect(() => {
    HAND.canvas = gl.domElement;
    return () => {
      HAND.canvas = null;
    };
  }, [gl]);

  useEffect(() => {
    if (!held) return;
    const canvas = gl.domElement;
    // Drag start: every target lit for this item at once (`dragTargets`).
    useDragTargetStore.getState().publish(resolveDragTargets(held), null);
    setEvents({ enabled: false });
    canvas.style.cursor = "none";

    const letGo = () => {
      useHandStore.getState().release();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
    const putBack = () => {
      // A workbench rack tube's own carry takes it back to its slot; the
      // others go home by themselves once let go (`PourMotion`).
      if (held.kind === "workbench-tube") useTestTubeDragStore.getState().releaseIfHeld(held.instanceId);
      letGo();
    };

    const handleMove = (event: MouseEvent) => {
      // 1:1 with the mouse — exactly as far as the cursor would have gone.
      const rect = canvas.getBoundingClientRect();
      HAND.ndc.x = THREE.MathUtils.clamp(HAND.ndc.x + (event.movementX / rect.width) * 2, -0.97, 0.97);
      HAND.ndc.y = THREE.MathUtils.clamp(HAND.ndc.y - (event.movementY / rect.height) * 2, -0.97, 0.97);
      if (held.kind === "workbench-tube") sharedMouseNdc.copy(HAND.ndc);
    };
    const handleDown = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 2) return;
      // The hand owns the buttons while it holds something.
      event.stopPropagation();
      event.preventDefault();
      if (event.button === 2) {
        putBack();
        return;
      }
      const action = held.kind === "workbench-tube" ? null : (held.kind === "tray" ? trayHandAction(held, HAND.rawPoint) : handActionFor(held, HAND.rawPoint));
      if (!action || action.blocked) return;
      // From where the item is drawn (snapped beside its target), not the bare hand.
      const from = HAND.itemPosValid ? HAND.itemPos : HAND.point;
      action.run([from.x, from.y, from.z]);
      // A tube a bottle is pouring into stays in the hand.
      if (!action.keepHeld) letGo();
    };
    // Dragged (`HAND.dragging`): letting go sets it down — does what a click
    // would there, or, anywhere else, puts it back where it was taken from.
    const handleUp = (event: MouseEvent) => {
      if (event.button !== 0 || !HAND.dragging || held.kind === "workbench-tube") return;
      event.stopPropagation();
      event.preventDefault();
      HAND.dragging = false;
      const action = held.kind === "tray" ? trayHandAction(held, HAND.rawPoint) : handActionFor(held, HAND.rawPoint);
      if (!action || action.blocked) {
        putBack();
        return;
      }
      const from = HAND.itemPosValid ? HAND.itemPos : HAND.point;
      action.run([from.x, from.y, from.z]);
      // A tube a bottle is pouring into stays in the hand.
      if (!action.keepHeld) letGo();
    };
    const handleContextMenu = (event: MouseEvent) => event.preventDefault();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      putBack();
    };
    const handleLockChange = () => {
      // Esc (or anything else) took the lock away: the item goes back.
      if (document.pointerLockElement !== canvas && useHandStore.getState().held === held) putBack();
    };
    // The workbench carry may have let go by itself (clamped near the ring).
    const unsubscribeCarry = useTestTubeDragStore.subscribe((state) => {
      if (held.kind === "workbench-tube" && state.heldInstanceId === null && state.pendingPickInstanceId === null) letGo();
    });

    if (held.kind === "workbench-tube") sharedMouseNdc.set(0, 0);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mousedown", handleDown, true);
    window.addEventListener("mouseup", handleUp, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKey, true);
    document.addEventListener("pointerlockchange", handleLockChange);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mousedown", handleDown, true);
      window.removeEventListener("mouseup", handleUp, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("pointerlockchange", handleLockChange);
      unsubscribeCarry();
      // Dropped, put back or cancelled: nothing stays lit, no slot stays kept.
      useDragTargetStore.getState().clear();
      useWorkbenchReservationStore.getState().clear();
      JAR_AIM.source = null;
      setEvents({ enabled: true });
      canvas.style.cursor = "";
      clearGhostShape();
      HAND.valid = false;
      HAND.action = null;
    };
  }, [held, gl, setEvents]);

  // A soft shadow on the worktop right under the carried item (VL-018): where
  // it is over the table — the lift alone hardly shows on a grey countertop.
  const shadowRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const shadow = shadowRef.current;
    if (shadow) {
      const show = !!held && held.kind !== "workbench-tube" && HAND.itemPosValid && HAND.homeValid;
      shadow.visible = show;
      if (show) {
        shadow.position.set(HAND.itemPos.x, HAND.home.y + 0.0015, HAND.itemPos.z);
        // Fainter the higher it is — beside the clamped tube it is well up.
        const height = Math.max(0, HAND.itemPos.y - HAND.home.y);
        shadow.scale.setScalar(HAND.radius * (1 + height * 2));
        shadowMaterials.forEach((material, i) => {
          material.opacity = SHADOW_OPACITY[i] * THREE.MathUtils.clamp(1 - height * 4, 0.25, 1);
        });
      }
    }
  });

  useFrame(() => {
    if (!held) return;
    if (held.kind === "workbench-tube") {
      aimAtJar(held);
      HAND.action = workbenchTubeHint(held);
      // The simulation may change under the carried item (the stand done moving): re-resolved every frame.
      useDragTargetStore.getState().publish(resolveDragTargets(held), hoveredDragTarget(held, null, null, null));
      s.projected.set(sharedMouseNdc.x, sharedMouseNdc.y, 0.5);
    } else {
      if (!HAND.homeValid) return;
      if (HAND.startAtItem) {
        // Over the item itself: it lifts where it stands and goes where the mouse takes it.
        HAND.startAtItem = false;
        // At the height it is carried at, or the hand lands short of it and the item slides towards the player.
        s.projected.copy(HAND.home).setY(HAND.home.y + CARRY_LIFT).project(camera);
        HAND.ndc.set(THREE.MathUtils.clamp(s.projected.x, -0.97, 0.97), THREE.MathUtils.clamp(s.projected.y, -0.97, 0.97));
      }
      // The hand: where the virtual cursor's ray meets a plane just above
      // the worktop — the item glides over it, its shadow under it, so it is
      // plain how near or far it is. Near the stand it snaps (`PourMotion`).
      s.plane.set(new THREE.Vector3(0, 1, 0), -(HAND.home.y + CARRY_LIFT));
      s.raycaster.setFromCamera(HAND.ndc, camera);
      if (!s.raycaster.ray.intersectPlane(s.plane, s.hit)) return;
      const dx = s.hit.x - HAND.home.x;
      const dz = s.hit.z - HAND.home.z;
      const far = Math.hypot(dx, dz);
      if (far > REACH) s.hit.set(HAND.home.x + (dx / far) * REACH, s.hit.y, HAND.home.z + (dz / far) * REACH);
      // Over its worktop and off everything on it (VL-018). The magnet still
      // answers to the bare hand: the item snaps beside the tube it is kept off.
      HAND.rawPoint.copy(s.hit);
      constrainOnWorktop(s.hit, HAND.radius, HAND.home, new Set([held.instanceId, ...carriedObstacleIds(held)]));
      HAND.point.copy(s.hit);
      HAND.valid = true;
      aimAtJar(held);
      const action = held.kind === "tray" ? trayHandAction(held, HAND.rawPoint) : handActionFor(held, HAND.rawPoint);
      HAND.action = action ? { label: action.label, blocked: action.blocked } : null;
      // A bottle always aims at the tube in the clamp; a tube at the clamp
      // while it is empty, else at the tube in it (to pour into).
      const clampTaken = useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
      const aim: HandAim | null =
        action && action.part === undefined && !JAR_AIM.source
          ? { part: held.kind === "bottle" || clampTaken ? "tube" : "clamp", refused: action.blocked }
          : null;
      useHandStore.getState().setAim(aim);
      useDragTargetStore.getState().publish(resolveDragTargets(held), hoveredDragTarget(held, action, aim, HAND.rawPoint));
      // A bottle from the tray that letting go now would set into the bench's
      // row keeps its slot there, the others making room (`workbenchLayout`).
      const slot =
        held.kind === "tray" && held.what === "bottle" && action && !action.blocked && trayUnloadPlace() === "workbench"
          ? workbenchInsertIndex(HAND.rawPoint)
          : null;
      if (slot !== null && held.kind === "tray") useWorkbenchReservationStore.getState().reserve({ instanceId: held.instanceId, index: slot });
      else useWorkbenchReservationStore.getState().clear();
      s.projected.copy(HAND.itemPosValid ? HAND.itemPos : HAND.point).project(camera);
    }
    const rect = gl.domElement.getBoundingClientRect();
    HAND.screen.set(rect.left + ((s.projected.x + 1) / 2) * rect.width, rect.top + ((1 - s.projected.y) / 2) * rect.height);
  });

  return (
    <>
    <HandGhosts />
    <group ref={shadowRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <mesh material={shadowMaterials[0]} raycast={() => {}}>
        <circleGeometry args={[1.25, 32]} />
      </mesh>
      <mesh material={shadowMaterials[1]} position={[0, 0, 0.0005]} raycast={() => {}}>
        <circleGeometry args={[0.85, 32]} />
      </mesh>
    </group>
    </>
  );
}

const SHADOW_OPACITY = [0.14, 0.22] as const;
const shadowMaterials = SHADOW_OPACITY.map(
  (opacity) => new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity, depthWrite: false }),
);

/** The workbench carry clamps by itself near the ring; the hand only says so. */
/** The bottle the held tube is brought to now, if any (`JAR_AIM`): a bottle at its own place, beside the tube's mouth. */
function aimAtJar(held: HeldItem): void {
  const location = held.kind === "workbench-tube" ? "workbench" : held.kind === "tube" ? held.location : null;
  JAR_AIM.source = location && HAND.mouthValid ? jarAt(location, HAND.mouth) : null;
}

function workbenchTubeHint(held: Extract<HeldItem, { kind: "workbench-tube" }>): { label: string; blocked: boolean } | null {
  if (JAR_AIM.source) {
    // Held up to a bottle: it pours in, or says why not.
    const pour = jarPourAction(held, JAR_AIM.source);
    if (pour) return { label: pour.label, blocked: pour.blocked };
  }
  if (WORKBENCH_CARRY.nearFlame) {
    // Under the lamp's flame (VL-020): what a click does there, or why not.
    const heat = heatInHandAction("workbench", held.index);
    if (heat) return { label: heat.label, blocked: heat.blocked };
  }
  if (WORKBENCH_CARRY.overTray) return { label: "Поставить на поднос", blocked: false };
  const near = useTestTubeDragStore.getState().isNearHolder;
  if (near) return { label: "Поставить обратно в штатив для пробирок", blocked: false };
  const clamp = standActionFor({ kind: "rack-tube", location: "workbench", index: held.index }, { fromHand: true });
  return clamp && !clamp.blocked ? { label: "Поднесите к лапке штатива", blocked: false } : null;
}
