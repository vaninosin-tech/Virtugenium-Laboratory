import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { handActionFor, standActionFor } from "../lib/standTableActions";
import { HAND, useHandStore, type HeldItem } from "../lib/useHandStore";
import { CLAMP_TUBE_MOUTH } from "../lib/useStandMotionStore";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { sharedMouseNdc, useTestTubeDragStore } from "../lib/useTestTubeDragStore";

/** How high above the worktop the held item is carried with no stand around. */
const CARRY_LIFT = 0.06;
/** The clamped tube's base below its mouth — the 15 cm tube. Things are carried with their base there. */
const TUBE_LENGTH = 0.15;
/**
 * The hand stays this close (horizontally) to the item's place: across the
 * whole worktop (a bottle at the hood's far end is ~0.7 m from the stand),
 * not off across the room.
 */
const REACH = 1.3;
/** Mouse travel (px) that moves the hand across half the screen — a little slower than the raw cursor, for aiming at a 2 cm tube mouth. */
const HALF_SCREEN_PX = 700;
/** Two clicks this close together put the item back. */
const DOUBLE_CLICK_MS = 350;

/**
 * Drives the hand (VL-015) while something is held: holds Pointer Lock so
 * the cursor is gone and the mouse moves the item, keeps the scene's own
 * pointer events off (under Pointer Lock they would all land on wherever the
 * cursor froze), finds what a click would do (`handActionFor`), does it on a
 * click, and puts the item back on a double click or when the lock is lost
 * (Esc). Mounted once in the canvas.
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
    let lastClick = 0;

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
      HAND.ndc.x = THREE.MathUtils.clamp(HAND.ndc.x + event.movementX / HALF_SCREEN_PX, -0.97, 0.97);
      HAND.ndc.y = THREE.MathUtils.clamp(HAND.ndc.y - event.movementY / HALF_SCREEN_PX, -0.97, 0.97);
      if (held.kind === "workbench-tube") sharedMouseNdc.copy(HAND.ndc);
    };
    const handleDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      // The hand owns the button while it holds something.
      event.stopPropagation();
      event.preventDefault();
      const action = held.kind === "workbench-tube" ? null : handActionFor(held, HAND.point);
      if (action && !action.blocked) {
        action.run([HAND.point.x, HAND.point.y, HAND.point.z]);
        letGo();
        return;
      }
      const now = Date.now();
      if (now - lastClick < DOUBLE_CLICK_MS) putBack();
      else lastClick = now;
    };
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
    window.addEventListener("keydown", handleKey, true);
    document.addEventListener("pointerlockchange", handleLockChange);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mousedown", handleDown, true);
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
      // The hand: where the virtual cursor's ray meets the plane things are
      // carried in — lifted to the clamped tube's own height when the stand
      // is there, so an item brought up to the tube on screen IS beside it.
      const carryY = CLAMP_TUBE_MOUTH.valid
        ? Math.max(CLAMP_TUBE_MOUTH.point.y - TUBE_LENGTH, HAND.home.y + CARRY_LIFT)
        : HAND.home.y + CARRY_LIFT;
      s.plane.set(new THREE.Vector3(0, 1, 0), -carryY);
      s.raycaster.setFromCamera(HAND.ndc, camera);
      if (!s.raycaster.ray.intersectPlane(s.plane, s.hit)) return;
      const dx = s.hit.x - HAND.home.x;
      const dz = s.hit.z - HAND.home.z;
      const far = Math.hypot(dx, dz);
      if (far > REACH) s.hit.set(HAND.home.x + (dx / far) * REACH, s.hit.y, HAND.home.z + (dz / far) * REACH);
      HAND.point.copy(s.hit);
      HAND.valid = true;
      const action = handActionFor(held, HAND.point);
      HAND.action = action ? { label: action.label, blocked: action.blocked } : null;
      // A bottle always aims at the tube in the clamp; a tube at the clamp
      // while it is empty, else at the tube in it (to pour into).
      const clampTaken = useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
      useHandStore
        .getState()
        .setAim(action ? { part: held.kind === "bottle" || clampTaken ? "tube" : "clamp", refused: action.blocked } : null);
      s.projected.copy(HAND.point).project(camera);
    }
    const rect = gl.domElement.getBoundingClientRect();
    HAND.screen.set(rect.left + ((s.projected.x + 1) / 2) * rect.width, rect.top + ((1 - s.projected.y) / 2) * rect.height);
  });

  return null;
}

/** The workbench carry clamps by itself near the ring; the hand only says so. */
function workbenchTubeHint(held: Extract<HeldItem, { kind: "workbench-tube" }>): { label: string; blocked: boolean } | null {
  const near = useTestTubeDragStore.getState().isNearHolder;
  if (near) return { label: "Поставить обратно в штатив для пробирок", blocked: false };
  const clamp = standActionFor({ kind: "rack-tube", location: "workbench", index: held.index }, { fromHand: true });
  return clamp && !clamp.blocked ? { label: "Поднесите к лапке штатива или к склянке", blocked: false } : null;
}
