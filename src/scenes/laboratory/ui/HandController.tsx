import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { handActionFor, standActionFor } from "../lib/standTableActions";
import { HAND, useHandStore, type HeldItem } from "../lib/useHandStore";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { WORKBENCH_CARRY } from "../lib/tableTray";
import { trayHandAction } from "../lib/trayUnloadPlace";
import { constrainOnWorktop } from "../lib/worktopBounds";
import { sharedMouseNdc, useTestTubeDragStore } from "../lib/useTestTubeDragStore";

/** How high above the worktop the held item glides — just off it, its shadow right under it. */
const CARRY_LIFT = 0.02;
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
      const action = held.kind === "workbench-tube" ? null : (held.kind === "tray" ? trayHandAction(held) : handActionFor(held, HAND.rawPoint));
      if (!action || action.blocked) return;
      // From where the item is drawn (snapped beside its target), not the bare hand.
      const from = HAND.itemPosValid ? HAND.itemPos : HAND.point;
      action.run([from.x, from.y, from.z]);
      letGo();
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
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKey, true);
    document.addEventListener("pointerlockchange", handleLockChange);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mousedown", handleDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("pointerlockchange", handleLockChange);
      unsubscribeCarry();
      setEvents({ enabled: true });
      canvas.style.cursor = "";
      HAND.valid = false;
      HAND.action = null;
    };
  }, [held, gl, setEvents]);

  useFrame(() => {
    if (!held) return;
    if (held.kind === "workbench-tube") {
      HAND.action = workbenchTubeHint(held);
      s.projected.set(sharedMouseNdc.x, sharedMouseNdc.y, 0.5);
    } else {
      if (!HAND.homeValid) return;
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
      constrainOnWorktop(s.hit, HAND.radius, HAND.home, new Set([held.instanceId]));
      HAND.point.copy(s.hit);
      HAND.valid = true;
      const action = held.kind === "tray" ? trayHandAction(held) : handActionFor(held, HAND.rawPoint);
      HAND.action = action ? { label: action.label, blocked: action.blocked } : null;
      // A bottle always aims at the tube in the clamp; a tube at the clamp
      // while it is empty, else at the tube in it (to pour into).
      const clampTaken = useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
      useHandStore
        .getState()
        .setAim(
          action && action.part !== "tray"
            ? { part: held.kind === "bottle" || clampTaken ? "tube" : "clamp", refused: action.blocked }
            : null,
        );
      s.projected.copy(HAND.itemPosValid ? HAND.itemPos : HAND.point).project(camera);
    }
    const rect = gl.domElement.getBoundingClientRect();
    HAND.screen.set(rect.left + ((s.projected.x + 1) / 2) * rect.width, rect.top + ((1 - s.projected.y) / 2) * rect.height);
  });

  return null;
}

/** The workbench carry clamps by itself near the ring; the hand only says so. */
function workbenchTubeHint(held: Extract<HeldItem, { kind: "workbench-tube" }>): { label: string; blocked: boolean } | null {
  if (WORKBENCH_CARRY.overTray) return { label: "Поставить на поднос", blocked: false };
  const near = useTestTubeDragStore.getState().isNearHolder;
  if (near) return { label: "Поставить обратно в штатив для пробирок", blocked: false };
  const clamp = standActionFor({ kind: "rack-tube", location: "workbench", index: held.index }, { fromHand: true });
  return clamp && !clamp.blocked ? { label: "Поднесите к лапке штатива", blocked: false } : null;
}
