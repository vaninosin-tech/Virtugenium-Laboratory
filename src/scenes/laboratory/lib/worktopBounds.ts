import { useEffect, type RefObject } from "react";
import * as THREE from "three";

/**
 * Where a held bottle or tube may go (VL-018): over the worktop it was taken
 * from — the table's countertop, or the fume hood's worktop inside its walls
 * — and never into anything standing there (bottles, racks, the stand, the
 * lamp, the tube in the clamp). Whoever moves a held item constrains its
 * point here (`constrainOnWorktop`); the worktops and the things on them
 * register themselves.
 *
 * Everything is horizontal (X/Z): the item glides just over the worktop, so
 * whatever stands on it is in its way.
 */

/** A rectangle in `object`'s own space (X/Z) — a worktop the item stays over, or a thing it stays out of. */
export interface LocalRect {
  readonly object: THREE.Object3D;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** A thing on the worktop: a circle in the world, or a box in its own space. */
export type Obstacle =
  | { readonly kind: "circle"; readonly x: number; readonly z: number; readonly r: number }
  | ({ readonly kind: "box" } & LocalRect);

interface ObstacleSource {
  /** e.g. "rack" — so the workbench rack's own tubes can be carried back into it. */
  readonly tag?: string;
  readonly get: () => readonly Obstacle[];
}

const ZONES = new Map<string, LocalRect>();
const OBSTACLES = new Map<string, ObstacleSource>();

export function registerWorktopZone(id: string, zone: LocalRect): () => void {
  ZONES.set(id, zone);
  return () => {
    if (ZONES.get(id) === zone) ZONES.delete(id);
  };
}

export function registerWorktopObstacle(id: string, source: ObstacleSource): () => void {
  OBSTACLES.set(id, source);
  return () => {
    if (OBSTACLES.get(id) === source) OBSTACLES.delete(id);
  };
}

/** Shown in the scene: it and every parent visible. */
export function shownInWorld(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

const local = new THREE.Vector3();
const worldScale = new THREE.Vector3();

/** How far outside a zone (m) its item's home may be and still count as on it. */
const ZONE_MARGIN = 0.15;

function toLocal(rect: LocalRect, point: THREE.Vector3): number {
  rect.object.updateWorldMatrix(true, false);
  rect.object.worldToLocal(local.copy(point));
  rect.object.getWorldScale(worldScale);
  return worldScale.x || 1;
}

function backToWorld(rect: LocalRect, point: THREE.Vector3): void {
  const y = point.y;
  rect.object.localToWorld(point.copy(local));
  point.y = y;
}

/** The worktop `home` is on, if any. */
function zoneOf(home: THREE.Vector3): LocalRect | null {
  for (const zone of ZONES.values()) {
    if (!shownInWorld(zone.object)) continue;
    const s = toLocal(zone, home);
    const m = ZONE_MARGIN / s;
    if (local.x > zone.minX - m && local.x < zone.maxX + m && local.z > zone.minZ - m && local.z < zone.maxZ + m) return zone;
  }
  return null;
}

/** Keeps a circle of `radius` at `point` inside the zone. */
function keepInside(zone: LocalRect, point: THREE.Vector3, radius: number): void {
  const s = toLocal(zone, point);
  const r = radius / s;
  const x = THREE.MathUtils.clamp(local.x, zone.minX + r, Math.max(zone.minX + r, zone.maxX - r));
  const z = THREE.MathUtils.clamp(local.z, zone.minZ + r, Math.max(zone.minZ + r, zone.maxZ - r));
  if (x === local.x && z === local.z) return;
  local.x = x;
  local.z = z;
  backToWorld(zone, point);
}

/** Whether `point` is inside the obstacle (as a bare point). */
function contains(obstacle: Obstacle, point: THREE.Vector3): boolean {
  if (obstacle.kind === "circle") return Math.hypot(point.x - obstacle.x, point.z - obstacle.z) < obstacle.r;
  toLocal(obstacle, point);
  return local.x > obstacle.minX && local.x < obstacle.maxX && local.z > obstacle.minZ && local.z < obstacle.maxZ;
}

/** Pushes a circle of `radius` at `point` out of the obstacle, the shortest way. */
function pushOut(obstacle: Obstacle, point: THREE.Vector3, radius: number): void {
  if (obstacle.kind === "circle") {
    const dx = point.x - obstacle.x;
    const dz = point.z - obstacle.z;
    const reach = obstacle.r + radius;
    const d = Math.hypot(dx, dz);
    if (d >= reach) return;
    // Dead centre: out towards the viewer's side is as good as any.
    const nx = d > 1e-6 ? dx / d : 0;
    const nz = d > 1e-6 ? dz / d : 1;
    point.x = obstacle.x + nx * reach;
    point.z = obstacle.z + nz * reach;
    return;
  }
  const s = toLocal(obstacle, point);
  const r = radius / s;
  const minX = obstacle.minX - r;
  const maxX = obstacle.maxX + r;
  const minZ = obstacle.minZ - r;
  const maxZ = obstacle.maxZ + r;
  if (local.x <= minX || local.x >= maxX || local.z <= minZ || local.z >= maxZ) return;
  const toLeft = local.x - minX;
  const toRight = maxX - local.x;
  const toNear = local.z - minZ;
  const toFar = maxZ - local.z;
  const least = Math.min(toLeft, toRight, toNear, toFar);
  if (least === toLeft) local.x = minX;
  else if (least === toRight) local.x = maxX;
  else if (least === toNear) local.z = minZ;
  else local.z = maxZ;
  backToWorld(obstacle, point);
}

/**
 * Moves `point` (where a held item of `radius` would be) to the nearest place
 * it may be: over the worktop its `home` is on, out of everything there. The
 * item slides along what is in its way rather than stopping dead. What its
 * own place stands in (a tube's rack) does not keep it out — it goes back there.
 *
 * @param ignore obstacle ids not to keep out of — the held item's own
 * @param ignoreTags obstacle tags not to keep out of
 */
export function constrainOnWorktop(
  point: THREE.Vector3,
  radius: number,
  home: THREE.Vector3,
  ignore: ReadonlySet<string> = new Set(),
  ignoreTags: ReadonlySet<string> = new Set(),
): void {
  const zone = zoneOf(home);
  const obstacles: Obstacle[] = [];
  for (const [id, source] of OBSTACLES) {
    if (ignore.has(id) || (source.tag && ignoreTags.has(source.tag))) continue;
    for (const obstacle of source.get()) if (!contains(obstacle, home)) obstacles.push(obstacle);
  }
  // A few passes: out of one thing may be into the next, or past the edge.
  for (let pass = 0; pass < 4; pass += 1) {
    if (zone) keepInside(zone, point, radius);
    for (const obstacle of obstacles) pushOut(obstacle, point, radius);
  }
  if (zone) keepInside(zone, point, radius);
}

/** Registers the object in `ref` as a box in its own space while mounted. */
export function useBoxObstacle(
  id: string,
  ref: RefObject<THREE.Object3D | null>,
  box: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number },
  tag?: string,
): void {
  const { minX, maxX, minZ, maxZ } = box;
  useEffect(
    () =>
      registerWorktopObstacle(id, {
        tag,
        get: () => {
          const object = ref.current;
          return object && shownInWorld(object) ? [{ kind: "box", object, minX, maxX, minZ, maxZ }] : [];
        },
      }),
    [id, ref, minX, maxX, minZ, maxZ, tag],
  );
}

const circleAt = new THREE.Vector3();

/** Registers the object in `ref` as a circle of `radius` (m, at scale 1) round its origin while mounted. */
export function useCircleObstacle(id: string, ref: RefObject<THREE.Object3D | null>, radius: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return registerWorktopObstacle(id, {
      get: () => {
        const object = ref.current;
        if (!object || !shownInWorld(object)) return [];
        object.getWorldPosition(circleAt);
        object.getWorldScale(worldScale);
        return [{ kind: "circle", x: circleAt.x, z: circleAt.z, r: radius * worldScale.x }];
      },
    });
  }, [id, ref, radius, enabled]);
}
