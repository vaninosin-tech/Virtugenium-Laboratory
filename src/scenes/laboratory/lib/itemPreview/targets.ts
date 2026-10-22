import * as THREE from "three";

import { computeTrayReagentPosition, useTrayReagentAreaStore } from "../useTrayReagentAreaStore";
import { standLocation } from "../standStationActions";
import { TABLE_TRAY } from "../tableTray";
import { useBunsenStandStorageStore } from "../useBunsenStandStorageStore";
import { useReagentStorageStore, nextFreeTraySlot } from "../useReagentStorageStore";
import { CLAMP_TUBE_MOUTH } from "../useStandMotionStore";
import { createAnchor } from "./anchor";
import type { InteractionTarget, ResolveContext, TargetAnchor } from "./types";

export { createAnchor };

/**
 * Interaction targets: what an item can be put on or used on, each with tags
 * the items' rules ask for. A target knows how to find itself in the live
 * scene; items never look for anything. To make a new thing a target,
 * `registerTarget` it — items whose data asks for its tag pick it up.
 */
const targets = new Map<string, InteractionTarget>();

export function registerTarget(target: InteractionTarget): void {
  targets.set(target.id, target);
}

export const getTarget = (id: string): InteractionTarget | undefined => targets.get(id);
export const allTargets = (): IterableIterator<InteractionTarget> => targets.values();

const UP = new THREE.Vector3(0, 1, 0);
/** The 15 cm tube: its origin is at its base, this far below its mouth. */
const TUBE_LENGTH = 0.15;

const right = new THREE.Vector3();
const toRod = new THREE.Vector3();
const slotAt = new THREE.Vector3();

/** The side of the tube, as the player sees it, that the stand's rod is not on (as `PourMotion` approaches it). */
function sideAwayFromRod(camera: THREE.Camera, mouth: THREE.Vector3, out: TargetAnchor): void {
  right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
  const rodSide = Math.sign(toRod.subVectors(CLAMP_TUBE_MOUTH.rod, mouth).dot(right)) || -1;
  out.side.copy(right).multiplyScalar(-rodSide);
  out.axis.crossVectors(UP, out.side).normalize();
}

/** The stand's empty clamp: a tube put there hangs with its mouth at the clamp's. */
registerTarget({
  id: "stand-clamp-empty",
  kind: "placement",
  tags: ["clamp"],
  resolve: (_context: ResolveContext, out) => {
    const location = standLocation();
    if (!location || !CLAMP_TUBE_MOUTH.valid) return false;
    if (useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null) return false;
    out.point.copy(CLAMP_TUBE_MOUTH.point).addScaledVector(UP, -TUBE_LENGTH);
    out.location = location;
    return true;
  },
});

/** The mouth of the tube in the clamp: what a bottle pours into. */
registerTarget({
  id: "stand-clamped-tube-mouth",
  kind: "usage",
  tags: ["tube-mouth"],
  resolve: ({ camera }, out) => {
    const location = standLocation();
    if (!location || !CLAMP_TUBE_MOUTH.valid) return false;
    if (useBunsenStandStorageStore.getState().attachedTubeSlotIndex === null) return false;
    out.point.copy(CLAMP_TUBE_MOUTH.point);
    sideAwayFromRod(camera, CLAMP_TUBE_MOUTH.point, out);
    out.location = location;
    return true;
  },
});

/** The next free place on the tray standing on the workbench. */
registerTarget({
  id: "table-tray-next-slot",
  kind: "placement",
  tags: ["tray"],
  resolve: (_context, out) => {
    const tray = TABLE_TRAY.object;
    if (!tray || !tray.visible) return false;
    const slot = nextFreeTraySlot(useReagentStorageStore.getState().trayItems);
    if (slot < 0) return false;
    const [x, y, z] = computeTrayReagentPosition(useTrayReagentAreaStore.getState().config, slot);
    tray.updateWorldMatrix(true, false);
    out.point.copy(tray.localToWorld(slotAt.set(x, y, z)));
    out.location = "workbench";
    return true;
  },
});
