import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { HOOD_WORKTOP_Y } from "../lib/hoodLayout";
import { activeWorktopZones } from "../lib/worktopBounds";
import { useWorktopZoneStore, WORKTOP_ZONE_IDS, type WorktopZoneId, type ZoneRect } from "../lib/useWorktopZoneStore";

const SELECTED_COLOR = new THREE.Color("#facc15");
const OTHER_COLOR = new THREE.Color("#38bdf8");
/** The edge under the cursor, or being dragged. */
const EDGE_COLOR = new THREE.Color("#f97316");
/** How near (CSS px) the cursor must be to an edge to take it. */
const EDGE_PICK_PX = 12;
/** The narrowest a rectangle may be dragged to (m, in its object's space). */
const MIN_SIZE = 0.02;
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

type Edge = "minX" | "maxX" | "minZ" | "maxZ";

/** The rectangle's edges, each as its two corners (X, Z) in the zone's space. */
const EDGES: readonly {
  readonly edge: Edge;
  readonly from: (r: ZoneRect) => readonly [number, number];
  readonly to: (r: ZoneRect) => readonly [number, number];
}[] = [
  { edge: "minZ", from: (r) => [r.minX, r.minZ], to: (r) => [r.maxX, r.minZ] },
  { edge: "maxX", from: (r) => [r.maxX, r.minZ], to: (r) => [r.maxX, r.maxZ] },
  { edge: "maxZ", from: (r) => [r.maxX, r.maxZ], to: (r) => [r.minX, r.maxZ] },
  { edge: "minX", from: (r) => [r.minX, r.maxZ], to: (r) => [r.minX, r.minZ] },
];

interface EdgeHit {
  readonly id: WorktopZoneId;
  readonly edge: Edge;
  readonly object: THREE.Object3D;
  /** The world height of the zone's surface — the plane the edge is dragged in. */
  readonly y: number;
}

/** Where a point in the zone's space (at world height `y`) is on the canvas, CSS px; null behind the camera. */
function onScreen(object: THREE.Object3D, x: number, z: number, y: number, camera: THREE.Camera, rect: DOMRect) {
  object.localToWorld(corner.set(x, 0, z));
  corner.y = y;
  corner.project(camera);
  if (corner.z > 1) return null;
  return [((corner.x + 1) / 2) * rect.width, ((1 - corner.y) / 2) * rect.height] as const;
}

/** The edge of a zone in play within reach of the cursor at (`px`, `py`) — the selected zone's first. */
function edgeUnder(px: number, py: number, camera: THREE.Camera, rect: DOMRect, selected: WorktopZoneId): EdgeHit | null {
  let best: EdgeHit | null = null;
  let bestPx = EDGE_PICK_PX;
  const zones = activeWorktopZones().sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  for (const { id, rect: zone } of zones) {
    const { object } = zone;
    object.updateWorldMatrix(true, false);
    const y = surfaceY(id, object) + LIFT;
    for (const { edge, from, to } of EDGES) {
      const a = onScreen(object, ...from(zone), y, camera, rect);
      const b = onScreen(object, ...to(zone), y, camera, rect);
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = THREE.MathUtils.clamp(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      const d = Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
      // Strictly nearer only: on a shared line the selected zone, looked at first, keeps it.
      if (d < bestPx) {
        bestPx = d;
        best = { id, edge, object, y };
      }
    }
  }
  return best;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * F8 → «Границы» (VL-019): the rectangles a held item stays inside, drawn
 * where they are — the selected one yellow, the rest blue — drawn over
 * everything, so a frame hidden under a bottle still shows.
 *
 * Any edge can be taken with the mouse and dragged (orange while under the
 * cursor or dragged): only that edge moves, the opposite one stays. The
 * press is caught before the scene's own (the F8 furniture drag) sees it.
 */
export function WorktopZoneOverlay() {
  const isOpen = useWorktopZoneStore((state) => state.isOpen);
  const zones = useWorktopZoneStore((state) => state.zones);
  const selected = useWorktopZoneStore((state) => state.selected);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
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

  /** The edge under the cursor or being dragged — drawn orange. */
  const hotRef = useRef<{ readonly hit: EdgeHit; readonly dragging: boolean } | null>(null);
  const edgeLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    const material = new THREE.LineBasicMaterial({ color: EDGE_COLOR, depthTest: false, transparent: true });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 1000;
    line.frustumCulled = false;
    line.raycast = () => {};
    return line;
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !isOpen) return;
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane();
    const up = new THREE.Vector3(0, 1, 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();

    const pointer = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { rect, px: event.clientX - rect.left, py: event.clientY - rect.top };
    };
    const setHot = (next: { hit: EdgeHit; dragging: boolean } | null) => {
      const was = hotRef.current;
      hotRef.current = next;
      canvas.style.cursor = next ? (next.dragging ? "grabbing" : "grab") : "";
      if (was?.hit.id !== next?.hit.id || was?.hit.edge !== next?.hit.edge || was?.dragging !== next?.dragging) invalidate();
    };

    const handleDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.target !== canvas) return;
      const { rect, px, py } = pointer(event);
      const found = edgeUnder(px, py, camera, rect, useWorktopZoneStore.getState().selected);
      if (!found) return;
      // Ours, not the scene's: no furniture pick, no drag of what is under it.
      event.stopPropagation();
      event.preventDefault();
      useWorktopZoneStore.getState().select(found.id);
      setHot({ hit: found, dragging: true });
    };
    const handleMove = (event: MouseEvent) => {
      const hot = hotRef.current;
      const { rect, px, py } = pointer(event);
      if (!hot?.dragging) {
        if (event.target !== canvas) {
          if (hot) setHot(null);
          return;
        }
        const found = edgeUnder(px, py, camera, rect, useWorktopZoneStore.getState().selected);
        setHot(found ? { hit: found, dragging: false } : null);
        return;
      }
      event.stopPropagation();
      ndc.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      plane.set(up, -hot.hit.y);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      const local = hot.hit.object.worldToLocal(hit);
      const { id, edge } = hot.hit;
      const zone = useWorktopZoneStore.getState().zones[id];
      const next = { ...zone };
      if (edge === "minX") next.minX = Math.min(local.x, zone.maxX - MIN_SIZE);
      else if (edge === "maxX") next.maxX = Math.max(local.x, zone.minX + MIN_SIZE);
      else if (edge === "minZ") next.minZ = Math.min(local.z, zone.maxZ - MIN_SIZE);
      else next.maxZ = Math.max(local.z, zone.minZ + MIN_SIZE);
      useWorktopZoneStore
        .getState()
        .setZone(id, { minX: round(next.minX), maxX: round(next.maxX), minZ: round(next.minZ), maxZ: round(next.maxZ) });
    };
    const handleUp = (event: MouseEvent) => {
      const hot = hotRef.current;
      if (!hot?.dragging) return;
      event.stopPropagation();
      setHot({ hit: hot.hit, dragging: false });
    };

    window.addEventListener("mousedown", handleDown, true);
    window.addEventListener("mousemove", handleMove, true);
    window.addEventListener("mouseup", handleUp, true);
    return () => {
      window.removeEventListener("mousedown", handleDown, true);
      window.removeEventListener("mousemove", handleMove, true);
      window.removeEventListener("mouseup", handleUp, true);
      hotRef.current = null;
      canvas.style.cursor = "";
    };
  }, [isOpen, gl, camera, invalidate]);

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
    // The edge under the cursor, or being dragged.
    const hot = hotRef.current;
    const zone = hot ? active.find((candidate) => candidate.id === hot.hit.id) : undefined;
    const spec = hot ? EDGES.find((candidate) => candidate.edge === hot.hit.edge) : undefined;
    edgeLine.visible = !!(hot && zone && spec);
    if (hot && zone && spec) {
      const position = edgeLine.geometry.getAttribute("position") as THREE.BufferAttribute;
      const y = surfaceY(hot.hit.id, zone.rect.object) + LIFT * 2;
      [spec.from(zone.rect), spec.to(zone.rect)].forEach(([x, z], i) => {
        zone.rect.object.localToWorld(corner.set(x, 0, z));
        position.setXYZ(i, corner.x, y, corner.z);
      });
      position.needsUpdate = true;
    }
  });

  if (!import.meta.env.DEV || !isOpen) return null;
  return (
    <group>
      {WORKTOP_ZONE_IDS.map((id) => (
        <primitive key={id} object={loops[id]} />
      ))}
      <primitive object={edgeLine} />
    </group>
  );
}
