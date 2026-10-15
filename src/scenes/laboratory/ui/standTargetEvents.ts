import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { runStandAction, TAKE_CLAMPED_TUBE, takeClampedTube, takeLabel, type StandTarget } from "../lib/standTableActions";
import { takeIntoHand, type HeldItem } from "../lib/useHandStore";
import { useStandHintStore } from "../lib/useStandHintStore";
import { pressToTake } from "../lib/pressToTake";
import { takeClamp } from "../lib/clampCarry";
import type { TubeLocation } from "../lib/useTestTubeStorageStore";

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
 * Pointer handlers for something taken into the hand (VL-015) — a bottle or
 * a rack tube. Hover shows «Взять …» (`takeLabel`); a press takes it — to
 * be dragged, or carried after a click (`pressToTake`) — unless the stand is
 * busy (a pour, heating).
 */
export function takeTargetEvents(owner: string, target: StandTarget, item: HeldItem) {
  return {
    ...standTargetEvents(owner, target),
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      pressToTake(event.nativeEvent, () => {
        if (!takeLabel(target)) return false;
        useStandHintStore.getState().hide(owner);
        takeIntoHand(item, [0, 0, 0]);
        return true;
      });
    },
    // Taken on the press itself; the click that ends it does nothing more.
    onClick: (event: ThreeEvent<MouseEvent>) => event.stopPropagation(),
  };
}

/**
 * Pointer handlers for the tube in the clamp: hover says «take it out», a
 * press takes it into the hand — dragged or clicked (`pressToTake`) — out
 * of the clamp (`takeClampedTube`). The clamp's heating is the lamp's click.
 */
export function clampedTubeEvents(owner: string) {
  return {
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      useStandHintStore.getState().showLabel(owner, TAKE_CLAMPED_TUBE);
    },
    onPointerOut: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      useStandHintStore.getState().hide(owner);
      document.body.style.cursor = "auto";
    },
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      pressToTake(event.nativeEvent, () => {
        if (!takeClampedTube()) return false;
        useStandHintStore.getState().hide(owner);
        return true;
      });
    },
    // Taken on the press itself; the click that ends it does nothing more.
    onClick: (event: ThreeEvent<MouseEvent>) => event.stopPropagation(),
  };
}

/** The caption over the stand's clamp: it is taken off into the hand, with its tube. */
const TAKE_CLAMP = "Взять лапку штатива";

/**
 * Pointer handlers for the stand's clamp: hover says «take the clamp», a press
 * takes it off the stand into the hand — dragged or clicked (`pressToTake`) —
 * with whatever tube is in it (`clampCarry`).
 */
export function clampEvents(location: TubeLocation) {
  const owner = "stand-clamp";
  return {
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      useStandHintStore.getState().showLabel(owner, TAKE_CLAMP);
    },
    onPointerOut: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      useStandHintStore.getState().hide(owner);
      document.body.style.cursor = "auto";
    },
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      pressToTake(event.nativeEvent, () => {
        if (!takeClamp(location)) return false;
        useStandHintStore.getState().hide(owner);
        return true;
      });
    },
    onClick: (event: ThreeEvent<MouseEvent>) => event.stopPropagation(),
  };
}

