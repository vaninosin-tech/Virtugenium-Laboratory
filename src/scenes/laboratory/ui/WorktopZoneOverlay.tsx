import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { HOOD_WORKTOP_Y } from "../lib/hoodLayout";
import { activeWorktopZones } from "../lib/worktopBounds";
import { useWorktopZoneStore, WORKTOP_ZONE_IDS, type WorktopZoneId } from "../lib/useWorktopZoneStore";

const SELECTED_COLOR = new THREE.Color("#facc15");
const OTHER_COLOR = new THREE.Color("#38bdf8");
/** Just above the surface, so the frame is not lost in it. */
const LIFT = 0.004;
/** The tray's inner floor, in its own space. */
const TRAY_FLOOR_Y = 0.004;

const box = new THREE.Box3();
const corner = new THREE.Vector3();

/** How high (world) the zone's surface is: the countertop, the hood's worktop, the tray's floor. */
function surfaceY(id: WorktopZoneId, object: THREE.Object3D): number {
  if (id === "table") {
    const top = object.getObjectByName("Countertop") ?? object;
    return box.setFromObject(top).max.y;
  }
  const localY = id === "fume-hood" ? HOOD_WORKTOP_Y : TRAY_FLOOR_Y;
  return object.localToWorld(corner.set(0, localY, 0)).y;
}

/**
 * F8 → «Границы» (VL-019): the rectangles a held item stays inside, drawn
 * where they are — the selected one yellow, the rest blue — drawn over
 * everything, so a frame hidden under a bottle still shows.
 */
export function WorktopZoneOverlay() {
  const isOpen = useWorktopZoneStore((state) => state.isOpen);
  const zones = useWorktopZoneStore((state) => state.zones);
  const selected = useWorktopZoneStore((state) => state.selected);
  const invalidate = useThree((state) => state.invalidate);
  // An edit in the panel shows at once, even when nothing else is moving.
  useEffect(() => invalidate(), [invalidate, isOpen, zones, selected]);
  const loops = useMemo(
    () =>
      Object.fromEntries(
        WORKTOP_ZONE_IDS.map((id) => {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
          const material = new THREE.LineBasicMaterial({ color: OTHER_COLOR, depthTest: false, transparent: true });
          const loop = new THREE.LineLoop(geometry, material);
          loop.renderOrder = 999;
          loop.frustumCulled = false;
          loop.raycast = () => {};
          return [id, loop];
        }),
      ) as Record<WorktopZoneId, THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>>,
    [],
  );

  useFrame(() => {
    if (!isOpen) return;
    const active = activeWorktopZones();
    for (const id of WORKTOP_ZONE_IDS) {
      const loop = loops[id];
      const zone = active.find((candidate) => candidate.id === id);
      loop.visible = !!zone;
      if (!zone) continue;
      const { object, minX, maxX, minZ, maxZ } = zone.rect;
      object.updateWorldMatrix(true, false);
      const y = surfaceY(id, object) + LIFT;
      const position = loop.geometry.getAttribute("position") as THREE.BufferAttribute;
      [
        [minX, minZ],
        [maxX, minZ],
        [maxX, maxZ],
        [minX, maxZ],
      ].forEach(([x, z], i) => {
        object.localToWorld(corner.set(x, 0, z));
        position.setXYZ(i, corner.x, y, corner.z);
      });
      position.needsUpdate = true;
      loop.material.color.copy(id === selected ? SELECTED_COLOR : OTHER_COLOR);
      loop.material.opacity = id === selected ? 1 : 0.6;
    }
  });

  if (!import.meta.env.DEV || !isOpen) return null;
  return (
    <group>
      {WORKTOP_ZONE_IDS.map((id) => (
        <primitive key={id} object={loops[id]} />
      ))}
    </group>
  );
}
