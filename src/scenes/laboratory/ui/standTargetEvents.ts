import type { ThreeEvent } from "@react-three/fiber";

import { runStandAction, type StandTarget } from "../lib/standTableActions";
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
      runStandAction(target);
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
