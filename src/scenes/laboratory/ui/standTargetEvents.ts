import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { runStandAction, takeLabel, type StandTarget } from "../lib/standTableActions";
import { takeIntoHand, type HeldItem } from "../lib/useHandStore";
import { useStandHintStore } from "../lib/useStandHintStore";

/**
 * Pointer handlers that make a 3D object a stand action target — spread onto
 * the object's group: `<group {...standTargetEvents(id, target)}>`. Hover
 * shows the caption (`StandActionHint`), a click does the action. The
 * caption also decides the cursor, so these only reset it on the way out.
 *
 * @param owner a stable id for this object (its instance id)
 */
export function standTargetEvents(owner: string, target: StandTarget) {
  return {
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      // Where the clicked object is — a tube flies into the clamp from there.
      const at = event.object.getWorldPosition(new THREE.Vector3());
      runStandAction(target, [at.x, at.y, at.z]);
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      useStandHintStore.getState().show(owner, target);
    },
    onPointerOut: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      useStandHintStore.getState().hide(owner);
      document.body.style.cursor = "auto";
    },
  };
}

/**
 * Pointer handlers for something taken into the hand by a click (VL-015) —
 * a bottle or a rack tube. Hover shows «Взять …» (`takeLabel`); the click
 * takes it, unless the stand is busy (a pour, heating).
 */
export function takeTargetEvents(owner: string, target: StandTarget, item: HeldItem) {
  return {
    ...standTargetEvents(owner, target),
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      if (!takeLabel(target)) return;
      useStandHintStore.getState().hide(owner);
      takeIntoHand(item, [0, 0, 0]);
    },
  };
}
