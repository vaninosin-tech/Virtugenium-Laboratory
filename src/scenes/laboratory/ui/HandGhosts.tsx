import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { HAND_GHOST, createGhostMaterial, type GhostTone } from "../lib/handGhost";
import { TABLE_TRAY } from "../lib/tableTray";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { HAND, useHandStore, type HeldItem } from "../lib/useHandStore";
import { nextFreeTraySlot, useReagentStorageStore } from "../lib/useReagentStorageStore";
import { CLAMP_TUBE_MOUTH } from "../lib/useStandMotionStore";
import { hoodBottleLocal, hoodLocalToWorld } from "../lib/hoodLayout";
import { trayUnloadPlace } from "../lib/trayUnloadPlace";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { computeTrayReagentPosition, useTrayReagentAreaStore } from "../lib/useTrayReagentAreaStore";
import { computeWorkbenchReagentSlotOffsets, useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";

/** The 15 cm tube: its origin is at its base, this far below its mouth. */
const TUBE_LENGTH = 0.15;

type Slot = "from" | "placeA" | "placeB" | "now";
const SLOT_TONE: Record<Slot, GhostTone> = { from: "from", placeA: "place", placeB: "place", now: "now" };

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The carried item's outlines (VL-018), only its edges: where it was taken
 * from, every place it may be set down, and — brighter — where it will be
 * if let go now (`HAND_GHOST`). Mounted once in the canvas, by
 * `HandController`.
 */
export function HandGhosts() {
  const held = useHandStore((state) => state.held);
  const slots = useMemo(() => {
    const result = {} as Record<Slot, { group: THREE.Group; material: THREE.ShaderMaterial }>;
    for (const slot of Object.keys(SLOT_TONE) as Slot[]) {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.visible = false;
      group.renderOrder = 12;
      result[slot] = { group, material: createGhostMaterial(SLOT_TONE[slot]) };
    }
    return result;
  }, []);
  useEffect(() => () => Object.values(slots).forEach(({ material }) => material.dispose()), [slots]);

  const s = useMemo(
    () => ({
      version: -1,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      at: new THREE.Vector3(),
      tray: new THREE.Matrix4(),
      clamp: new THREE.Matrix4(),
      landing: new THREE.Matrix4(),
      landAt: new THREE.Vector3(),
      landQuaternion: new THREE.Quaternion(),
      landScale: new THREE.Vector3(),
      innerQuaternion: new THREE.Quaternion(),
      innerEuler: new THREE.Euler(),
    }),
    [],
  );

  useFrame(() => {
    const shape = held ? HAND_GHOST.shape : null;
    if (s.version !== HAND_GHOST.version) {
      // A new item: its shape into every slot.
      s.version = HAND_GHOST.version;
      for (const { group, material } of Object.values(slots)) {
        group.clear();
        for (const part of HAND_GHOST.shape ?? []) {
          const mesh = new THREE.Mesh(part.geometry, material);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(part.matrix);
          mesh.renderOrder = 12;
          mesh.raycast = () => {};
          group.add(mesh);
        }
      }
    }
    for (const { group } of Object.values(slots)) group.visible = false;
    if (!held || !shape) return;

    HAND_GHOST.from.decompose(s.position, s.quaternion, s.scale);
    const tray = traySpot(held, s);
    const clamp = clampSpot(held, s);
    const landing = trayBottleLanding(held, s);

    // Where it ends up if let go now: on the tray, in the clamp — or, with
    // nothing to do here, back where it was taken from. Pouring, it is the
    // tube in the clamp that lights up instead (`GlassRim`).
    const aim = useHandStore.getState().aim;
    const action = HAND.action;
    let now: THREE.Matrix4 | null = HAND_GHOST.from;
    if (aim?.part === "tube") now = null;
    else if (aim?.part === "clamp" && clamp) now = clamp;
    else if (action && !action.blocked && tray && WORKBENCH_TRAY_LABEL.test(action.label)) now = tray;
    // Off the tray: where it will stand once set down — its next place on the table, or in the hood.
    else if (action && !action.blocked && held.kind === "tray") now = landing;

    show(slots.now, now);
    show(slots.from, now === HAND_GHOST.from ? null : HAND_GHOST.from);
    show(slots.placeA, tray && now !== tray ? tray : null);
    show(slots.placeB, clamp && now !== clamp ? clamp : null);
  });

  return (
    <>
      {Object.values(slots).map(({ group }) => (
        <primitive key={group.uuid} object={group} />
      ))}
    </>
  );
}

/** «Поставить на поднос» — the hand's caption over the tray on the table. */
const WORKBENCH_TRAY_LABEL = /поднос/i;

function show(slot: { group: THREE.Group }, matrix: THREE.Matrix4 | null): void {
  slot.group.visible = matrix !== null;
  if (matrix) {
    slot.group.matrix.copy(matrix);
    slot.group.matrixWorldNeedsUpdate = true;
  }
}

/** A bottle from the bench may go onto the tray on the table: into its next free slot. */
function traySpot(
  held: HeldItem,
  s: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; at: THREE.Vector3; tray: THREE.Matrix4 },
): THREE.Matrix4 | null {
  const tray = TABLE_TRAY.object;
  if (held.kind !== "bottle" || held.location !== "workbench" || !tray || !tray.visible) return null;
  const slot = nextFreeTraySlot(useReagentStorageStore.getState().trayItems);
  if (slot < 0) return null;
  const [x, y, z] = computeTrayReagentPosition(useTrayReagentAreaStore.getState().config, slot);
  tray.updateWorldMatrix(true, false);
  tray.localToWorld(s.at.set(x, y, z));
  return s.tray.compose(s.at, s.quaternion, s.scale);
}

/**
 * A bottle off the tray, set down where the player stands: its next place in
 * the table's row of jars, or in the hood's column (the same slot
 * `WorkbenchReagentDisplayArea` / `FumeHoodWorkArea` will give it). The
 * outline is the item's own, resized and turned the way it stands there.
 */
function trayBottleLanding(
  held: HeldItem,
  s: {
    landing: THREE.Matrix4;
    landAt: THREE.Vector3;
    landQuaternion: THREE.Quaternion;
    landScale: THREE.Vector3;
    innerQuaternion: THREE.Quaternion;
    innerEuler: THREE.Euler;
  },
): THREE.Matrix4 | null {
  const part = HAND_GHOST.shape?.[0];
  const place = trayUnloadPlace();
  if (held.kind !== "tray" || held.what !== "bottle" || !part || !place) return null;
  // How the glass sits in the carried item now: its size and its turn.
  part.matrix.decompose(s.landAt, s.innerQuaternion, s.landScale);
  const innerScale = Math.max(s.landScale.x, 1e-6);
  const innerYaw = s.innerEuler.setFromQuaternion(s.innerQuaternion, "YXZ").y;
  let yaw: number;
  let scale = 1;
  if (place === "workbench") {
    const config = useWorkbenchReagentAreaStore.getState().config;
    const count = useReagentStorageStore.getState().workbenchItems.length + 1;
    if (count > config.maxDisplaySlots) return null;
    const offset = computeWorkbenchReagentSlotOffsets(config, count)[count - 1];
    const table = useFurniturePositionStore.getState().getOverride("table").position;
    s.landAt.set(table[0] + offset[0], table[1] + offset[1], table[2] + offset[2]);
    yaw = config.rotationY;
    scale = config.scale;
  } else {
    yaw = hoodLocalToWorld(hoodBottleLocal(useReagentStorageStore.getState().fumeHoodItems.length), s.landAt);
  }
  s.landQuaternion.setFromAxisAngle(UP, yaw - innerYaw);
  s.landScale.setScalar(scale / innerScale);
  return s.landing.compose(s.landAt, s.landQuaternion, s.landScale);
}

/** A tube may go into the empty clamp. */
function clampSpot(
  held: HeldItem,
  s: { quaternion: THREE.Quaternion; scale: THREE.Vector3; at: THREE.Vector3; clamp: THREE.Matrix4 },
): THREE.Matrix4 | null {
  if (held.kind !== "tube" || !CLAMP_TUBE_MOUTH.valid || useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null) return null;
  s.at.copy(CLAMP_TUBE_MOUTH.point).addScaledVector(UP, -TUBE_LENGTH);
  return s.clamp.compose(s.at, s.quaternion, s.scale);
}
