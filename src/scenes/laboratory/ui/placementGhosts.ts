import * as THREE from "three";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { currentDropZone, getDragTargetState, useDragTargetStore, type DragTargetId } from "../lib/dragTargets";
import { HAND_GHOST } from "../lib/handGhost";
import { heldClampPose } from "../lib/heldClampPose";
import { HOOD_RACK_LOCAL, HOOD_STAND_LOCAL, hoodBottleLocal } from "../lib/hoodLayout";
import { LAMP_FLAME } from "../lib/lampFlame";
import { EQUIPMENT } from "../lib/layout";
import { TABLE_TRAY, WORKBENCH_RACK } from "../lib/tableTray";
import { trayUnloadPlace } from "../lib/trayUnloadPlace";
import { activeWorktopZones } from "../lib/worktopBounds";
import { STAND_BASE_BOTTOM_OFFSET, STAND_TABLE_YAW, useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import type { HeldItem } from "../lib/useHandStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { nextFreeTraySlot, useReagentStorageStore } from "../lib/useReagentStorageStore";
import { CLAMP_HEAT_POSE, CLAMP_TUBE_MOUTH } from "../lib/useStandMotionStore";
import {
  computeTubeSlotLocalOffset,
  computeTubeSlotPosition,
  TRAY_RACK_ANCHOR,
  useTestTubeStorageStore,
} from "../lib/useTestTubeStorageStore";
import {
  computeTrayReagentPosition,
  lampTrayRestPosition,
  standTrayRestPosition,
  useTrayReagentAreaStore,
} from "../lib/useTrayReagentAreaStore";
import { HAND } from "../lib/useHandStore";
import { pourPose } from "../lib/pourPose";
import { JAR_AIM } from "../lib/pourSources";
import { computeWorkbenchReagentSlotOffsets, useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { useWorkbenchReservationStore } from "../lib/workbenchLayout";
import type { GhostState } from "./dragHighlightStyle";
import { HOOD_LONE_LAMP_POSITION, HOOD_STAND_ROTATION_Y, LAMP_TABLE_SPOT } from "./equipmentPlaces";

/**
 * Where the carried item could end up, as outlines of the item itself
 * (`HandGhosts`): every place it may be set down — its own place included —
 * and every place it is used at the stand or the lamp.
 *
 * A place's transform comes from what puts the item there for real: the
 * tray's next free slot, the bench's next grid slot, the rack's next hole,
 * the stand's and the lamp's own spots (`equipmentPlaces`), the item's own
 * snap to the clamp (`PourMotion` → `HAND_GHOST`), the flame pose the
 * heating uses (`heldClampPose`). Which places and interactions exist at all,
 * and whether one is blocked, is `getDragTargetState`'s answer — nothing is
 * added here.
 *
 * Two separate things: the CANDIDATES — every place and use that exists for
 * this item now — and the ACTIVE RELEASE TARGET (`releaseTarget`) — what
 * letting go this very frame does. Its colour follows from both
 * (`ghostState`): a place is blue, white if it is the release target; a use
 * is green if it can be done now, red if not.
 */
export interface GhostCandidate {
  readonly target: DragTargetId;
  readonly kind: "drop" | "interaction";
  /** A use that can be done now (a place always can). */
  readonly available: boolean;
  /** Letting go now does this. */
  readonly isActiveReleaseTarget: boolean;
  /** The actor's origin there, in the world — its outline's shape is relative to it. */
  readonly matrix: THREE.Matrix4;
  /**
   * Who acts, when it is not the held item: a tube held up to a bottle shows
   * the BOTTLE, pouring into it (its shape is taken from this, `HandGhosts`).
   */
  readonly ghostSource?: THREE.Object3D;
}

/** The candidate's colour. */
export function ghostState(candidate: GhostCandidate): GhostState {
  if (candidate.kind === "drop") return candidate.isActiveReleaseTarget ? "white" : "blue";
  return candidate.available ? "green" : "red";
}

/**
 * What letting go now does — from the hand's own answer to that
 * (`handActionFor` / `trayHandAction` → `hoveredDragTarget`, published every
 * frame by `HandController`): the place it sets the item down at, the use
 * it does — or, over nothing or a use it cannot do now, its own place, where
 * it goes back.
 */
export function releaseTarget(held: HeldItem): DragTargetId | null {
  const hovered = useDragTargetStore.getState().hovered;
  const state = hovered ? getDragTargetState(held, hovered) : "NONE";
  if (state === "CURRENT_DROP_ZONE" || state === "AVAILABLE_DROP_ZONE" || state === "AVAILABLE_INTERACTION") return hovered;
  return currentDropZone(held);
}

/** The 15 cm tube: its origin is at its base, this far below its mouth. */
const TUBE_LENGTH = 0.15;
/** A rack tube brought beside the clamped one to pour: as far off its axis as a bottle stands (`PourMotion`). */
const TUBE_BESIDE = 0.011 + 0.02 + 0.011;

const UP = new THREE.Vector3(0, 1, 0);
const HOOD = EQUIPMENT.find((equipment) => equipment.id === "fume-hood")!;

const pool = Array.from({ length: 8 }, () => new THREE.Matrix4());
const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const sc = new THREE.Vector3();
const fromPosition = new THREE.Vector3();
const fromQuaternion = new THREE.Quaternion();
const fromScale = new THREE.Vector3();
const m = new THREE.Matrix4();
const right = new THREE.Vector3();
const sourcePosition = new THREE.Vector3();
const sourceQuaternion = new THREE.Quaternion();
const sourceScale = new THREE.Vector3();
const sourceSide = new THREE.Vector3();
const forward = new THREE.Vector3();

/** The table's own transform: the bench's origin (`Laboratory.tsx` puts the bench things relative to it). */
function tablePosition(): THREE.Vector3 {
  const [x, y, z] = useFurniturePositionStore.getState().getOverride("table").position;
  return v.set(x, y, z);
}

/** The fume hood work area's transform (`FumeHoodWorkArea`). */
function hoodMatrix(out: THREE.Matrix4): THREE.Matrix4 {
  const override = useFurniturePositionStore.getState().getOverride(HOOD.id);
  const [x, y, z] = override.position;
  return out.compose(
    v.set(x, y, z),
    q.setFromAxisAngle(UP, override.rotationY ?? HOOD.rotationY),
    sc.set(1, 1, 1),
  );
}

const r = new THREE.Matrix4();
const translation = (x: number, y: number, z: number) => m.makeTranslation(x, y, z);
const turn = (angle: number) => r.makeRotationY(angle);

/** Where a placement candidate's origin goes, or null — the place it goes to is not in the scene. */
function placementMatrix(held: HeldItem, target: DragTargetId, out: THREE.Matrix4): THREE.Matrix4 | null {
  // To the table's tray: the next free slot of its bottles' half / its rack.
  if (target === "table-tray") {
    const tray = TABLE_TRAY.object;
    if (!tray) return null;
    tray.updateWorldMatrix(true, false);
    if (held.kind === "bottle") {
      const slot = nextFreeTraySlot(useReagentStorageStore.getState().trayItems);
      if (slot < 0) return null;
      const [x, y, z] = computeTrayReagentPosition(useTrayReagentAreaStore.getState().config, slot);
      return out.multiplyMatrices(tray.matrixWorld, translation(x, y, z));
    }
    if (held.kind === "workbench-tube") {
      const [x, y, z] = computeTubeSlotPosition(TRAY_RACK_ANCHOR, useTestTubeStorageStore.getState().trayTestTubes.length);
      return out.multiplyMatrices(tray.matrixWorld, translation(x, y, z));
    }
    if (held.kind === "equipment") {
      // Where it rests on the tray (`BunsenStandTrayDisplay` / `SpiritLampTrayDisplay`).
      const [x, y, z] = held.what === "stand" ? standTrayRestPosition(STAND_BASE_BOTTOM_OFFSET) : lampTrayRestPosition();
      return out.multiplyMatrices(tray.matrixWorld, translation(x, y, z));
    }
    return null;
  }
  // A tube from the hood's rack onto the tray there: its rack's next hole.
  if (target === "hood-tray" && held.kind === "tube") {
    const tray = activeWorktopZones().find((zone) => zone.id === "hood-tray")?.rect.object;
    if (!tray) return null;
    tray.updateWorldMatrix(true, false);
    const [x, y, z] = computeTubeSlotPosition(TRAY_RACK_ANCHOR, useTestTubeStorageStore.getState().trayTestTubes.length);
    return out.multiplyMatrices(tray.matrixWorld, translation(x, y, z));
  }
  if (held.kind !== "tray") return null;
  // Off the tray, down to where the player stands (`trayHandAction`).
  const place = trayUnloadPlace();
  if (!place) return null;
  if (target === "table" && place === "workbench") return tableSpot(held, out);
  if (target === "fume-hood" && place === "fumeHood") return hoodSpot(held, out);
  return null;
}

/** The stand let go on the table: where it is drawn now, down on the table (`equipmentHandAction` → `setTablePosition`). */
function standSpotUnderHand(out: THREE.Matrix4): THREE.Matrix4 {
  HAND_GHOST.from.decompose(fromPosition, fromQuaternion, fromScale);
  if (!HAND.itemPosValid) return out.copy(HAND_GHOST.from);
  return out.compose(v.set(HAND.itemPos.x, fromPosition.y, HAND.itemPos.z), fromQuaternion, fromScale);
}

/** Off the tray onto the bench — appended, as `bottleFromTray` / `tubeFromTray` do. */
function tableSpot(held: Extract<HeldItem, { kind: "tray" }>, out: THREE.Matrix4): THREE.Matrix4 | null {
  const table = tablePosition();
  if (held.what === "bottle") {
    const config = useWorkbenchReagentAreaStore.getState().config;
    const count = useReagentStorageStore.getState().workbenchItems.length;
    if (count >= config.maxDisplaySlots) return null;
    // In the slot kept for it while it is the release target — the row is laid
    // out round it (`workbenchLayout`). Otherwise just past the row's end as
    // it stands now, one slot's step on: the row has not made room for it yet.
    const reserved = useWorkbenchReservationStore.getState().reserved;
    const withIt = computeWorkbenchReagentSlotOffsets(config, count + 1);
    let offset = withIt[count];
    if (reserved?.instanceId === held.instanceId) offset = withIt[reserved.index];
    else if (count > 0) {
      const last = computeWorkbenchReagentSlotOffsets(config, count)[count - 1];
      offset = [
        last[0] + withIt[count][0] - withIt[count - 1][0],
        last[1],
        last[2] + withIt[count][2] - withIt[count - 1][2],
      ];
    }
    return out.makeTranslation(table.x + offset[0], table.y + offset[1], table.z + offset[2]);
  }
  if (held.what === "tube") {
    const rack = WORKBENCH_RACK.object;
    if (!rack) return null;
    rack.updateWorldMatrix(true, false);
    const [x, y, z] = computeTubeSlotLocalOffset(useTestTubeStorageStore.getState().workbenchTestTubes.length);
    return out.multiplyMatrices(rack.matrixWorld, translation(x, y, z));
  }
  const counterY = useWorkbenchReagentAreaStore.getState().config.originY;
  if (held.what === "stand") {
    // `BunsenStandWorkbenchDisplay`: at its stored spot on the table, turned round.
    const spot = useBunsenStandStorageStore.getState().tablePosition;
    return out
      .makeTranslation(table.x + spot.x, table.y + counterY + STAND_BASE_BOTTOM_OFFSET, table.z + spot.z)
      .multiply(turn(STAND_TABLE_YAW));
  }
  // The lamp: `LoneSpiritLampOnWorkbench`.
  return out
    .makeTranslation(table.x + LAMP_TABLE_SPOT.x, table.y + counterY, table.z + LAMP_TABLE_SPOT.z)
    .multiply(turn(STAND_TABLE_YAW));
}

/** Off the tray into the hood — appended, as `bottleFromTray` / `tubeFromTray` do (`FumeHoodWorkArea`). */
function hoodSpot(held: Extract<HeldItem, { kind: "tray" }>, out: THREE.Matrix4): THREE.Matrix4 | null {
  hoodMatrix(out);
  if (held.what === "bottle") {
    // The sandbox lays its bottles out along the back wall instead.
    if (useLaboratoryStore.getState().mode === "sandbox") return null;
    const [x, y, z] = hoodBottleLocal(useReagentStorageStore.getState().fumeHoodItems.length);
    return out.multiply(translation(x, y, z));
  }
  if (held.what === "tube") {
    const [x, y, z] = computeTubeSlotLocalOffset(useTestTubeStorageStore.getState().fumeHoodTestTubes.length);
    return out.multiply(translation(...HOOD_RACK_LOCAL)).multiply(translation(x, y, z));
  }
  out.multiply(translation(...HOOD_STAND_LOCAL)).multiply(turn(HOOD_STAND_ROTATION_Y));
  return held.what === "stand" ? out : out.multiply(translation(...HOOD_LONE_LAMP_POSITION));
}

/** Where the item's origin goes for a use at the stand or the lamp, or null — not there now. */
function interactionMatrix(held: HeldItem, target: DragTargetId, camera: THREE.Camera, out: THREE.Matrix4): THREE.Matrix4 | null {
  if (target === "reagent") {
    // The bottle the held tube is at, pouring into it where it is held —
    // tipped over its mouth, from the bottle's own side (`pourPose`, as its pour will have it).
    const source = JAR_AIM.source;
    const geometry = source?.geometry();
    if (!source || !geometry || !HAND.mouthValid) return null;
    source.root.updateWorldMatrix(true, false);
    source.root.matrixWorld.decompose(sourcePosition, sourceQuaternion, sourceScale);
    sourceSide.subVectors(sourcePosition, HAND.mouth).setY(0);
    if (sourceSide.lengthSq() < 1e-8) sourceSide.set(1, 0, 0);
    pourPose(geometry, sourceQuaternion, HAND.mouth, sourceSide.normalize(), 1, v, q);
    return out.compose(v, q, sourceScale);
  }
  HAND_GHOST.from.decompose(fromPosition, fromQuaternion, fromScale);
  // The clamp, with its tube, held in the lamp's flame — as the heating holds it (`CLAMP_HEAT_POSE`).
  if (held.kind === "clamp") return target === "flame" && CLAMP_HEAT_POSE.valid ? out.copy(CLAMP_HEAT_POSE.matrix) : null;
  if (target === "flame") {
    // In the flame, as `TubeInFlame` holds it: away from the player, at the heating's sweep.
    if (!LAMP_FLAME.valid) return null;
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    const pose = heldClampPose(useHeatingStore.getState().sweep, LAMP_FLAME.point, forward.normalize(), 0);
    return out.compose(pose.bottom, pose.quaternion, fromScale);
  }
  if (!CLAMP_TUBE_MOUTH.valid) return null;
  const mouth = CLAMP_TUBE_MOUTH.point;
  const clampTaken = useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null;
  // A tube into the empty clamp: exactly where a clamped tube stands, turned as the clamp holds it.
  const intoClamp = target === "clamp" && held.kind !== "bottle" && !clampTaken;
  if (intoClamp) return out.copy(CLAMP_TUBE_MOUTH.root);
  // Anything else pours into the tube in the clamp.
  if (held.kind === "workbench-tube") {
    // The rack's tube has no pour motion of its own (`InspectableTestTubeSlot`): beside the mouth, as a bottle stands.
    right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    v.copy(mouth).addScaledVector(right, TUBE_BESIDE).addScaledVector(UP, -TUBE_LENGTH + 0.02);
    return out.compose(v, fromQuaternion, fromScale);
  }
  if (!HAND_GHOST.posesValid) return null;
  // Pouring into the clamped tube, tipped over its mouth — as its pour will have it (`pourPose`).
  return out.compose(HAND_GHOST.pourPosition, HAND_GHOST.pourQuaternion, fromScale);
}

const PLACEMENTS: readonly DragTargetId[] = ["table", "table-tray", "fume-hood", "hood-tray", "workbench-rack", "fume-hood-rack"];
const INTERACTIONS: readonly DragTargetId[] = ["clamp", "clamped-tube", "flame", "reagent"];

/** The outlines to show now for `held` — at most one per target. */
export function ghostCandidates(held: HeldItem, camera: THREE.Camera): GhostCandidate[] {
  const result: GhostCandidate[] = [];
  const home = currentDropZone(held);
  const active = releaseTarget(held);
  let used = 0;
  // Its own place among them, whatever it is (the clamp's is on the stand).
  const places = home && !PLACEMENTS.includes(home) ? [...PLACEMENTS, home] : PLACEMENTS;
  for (const target of places) {
    const state = getDragTargetState(held, target);
    if (state !== "CURRENT_DROP_ZONE" && state !== "AVAILABLE_DROP_ZONE") continue;
    // Its own place: where it was taken from, exactly — but the stand let go
    // on the table stays where it is let go (`equipmentHandAction`).
    const movedStand = held.kind === "equipment" && held.what === "stand" && target === home && active === home;
    const matrix = movedStand
      ? standSpotUnderHand(pool[used])
      : target === home
        ? pool[used].copy(HAND_GHOST.from)
        : placementMatrix(held, target, pool[used]);
    if (!matrix) continue;
    used += 1;
    result.push({ target, kind: "drop", available: true, isActiveReleaseTarget: active === target, matrix });
  }
  for (const target of INTERACTIONS) {
    if (target === home) continue;
    const state = getDragTargetState(held, target);
    if (state !== "AVAILABLE_INTERACTION" && state !== "BLOCKED_INTERACTION") continue;
    const matrix = interactionMatrix(held, target, camera, pool[used]);
    if (!matrix) continue;
    used += 1;
    const available = state === "AVAILABLE_INTERACTION";
    const ghostSource = target === "reagent" ? JAR_AIM.source?.root : undefined;
    result.push({ target, kind: "interaction", available, isActiveReleaseTarget: available && active === target, matrix, ghostSource });
  }
  return result;
}

