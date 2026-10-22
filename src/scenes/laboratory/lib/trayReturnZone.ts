import { TABLE_TRAY_POSITION, TRAY_ROTATION_Y, type Position3 } from "./layout";

/** Exact `Tray_Body` dimensions measured from the shipped GLB. */
export const TRAY_BODY_SIZE_X = 0.81625;
export const TRAY_BODY_SIZE_Z = 0.437;
/** The stretched tray body is asymmetric around its authored root. */
export const TRAY_BODY_LOCAL_CENTER_X = 0.091875;
/** Extra fog around every outer edge, so the whole tray sits inside the volume. */
export const TRAY_RETURN_ZONE_EDGE_PADDING = 0.05;

/**
 * Horizontal return volume: larger than the tray on X/Z so its body and
 * raised edges are visibly enveloped. It stays parallel to the tray floor
 * because it is mounted directly inside the tray's own animated group.
 */
/** Keeps the panel's top at 0.1275 m while extending its volume down to the tabletop. */
export const TRAY_RETURN_ZONE_SIZE: Position3 = [
  TRAY_BODY_SIZE_X + TRAY_RETURN_ZONE_EDGE_PADDING * 2,
  0.1275,
  TRAY_BODY_SIZE_Z + TRAY_RETURN_ZONE_EDGE_PADDING * 2,
];

/** Full tray footprint used for drop detection, independent of panel thickness. */
export const TRAY_RETURN_ZONE_FOOTPRINT: readonly [number, number] = [
  TRAY_RETURN_ZONE_SIZE[0],
  TRAY_RETURN_ZONE_SIZE[2],
];

/** Local to `LabTrayInstance`, so the visual volume follows every tray transform. */
export const TRAY_RETURN_ZONE_LOCAL_POSITION: Position3 = [
  TRAY_BODY_LOCAL_CENTER_X,
  0.06375,
  0,
];

/** The tray root is at countertop height; this raises the volume above its rim. */
export const TRAY_RETURN_ZONE_POSITION: Position3 = [
  TABLE_TRAY_POSITION[0] + Math.cos(TRAY_ROTATION_Y) * TRAY_RETURN_ZONE_LOCAL_POSITION[0],
  TABLE_TRAY_POSITION[1] + TRAY_RETURN_ZONE_LOCAL_POSITION[1],
  TABLE_TRAY_POSITION[2] - Math.sin(TRAY_ROTATION_Y) * TRAY_RETURN_ZONE_LOCAL_POSITION[0],
];

/** Tests a world-space tabletop point against the tray-aligned return volume. */
export function isInsideTrayReturnZone(worldX: number, worldZ: number): boolean {
  const dx = worldX - TRAY_RETURN_ZONE_POSITION[0];
  const dz = worldZ - TRAY_RETURN_ZONE_POSITION[2];
  const cos = Math.cos(TRAY_ROTATION_Y);
  const sin = Math.sin(TRAY_ROTATION_Y);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;

  return (
    Math.abs(localX) <= TRAY_RETURN_ZONE_FOOTPRINT[0] / 2 &&
    Math.abs(localZ) <= TRAY_RETURN_ZONE_FOOTPRINT[1] / 2
  );
}

/**
 * If a world-space tabletop point falls inside the tray-aligned return
 * volume, pushes it straight back out to the NEAREST edge instead of just
 * flagging it — lets something dragged toward the tray slide right up
 * against its side and along it, rather than going dead the instant the
 * raw target crosses the boundary (freezing there reads as a much bigger
 * "blocked" area than the tray's own actual footprint, since the target
 * stops updating for every cursor position that would land inside it, not
 * just the ones the player thinks of as "on the tray"). A point already
 * outside is returned unchanged.
 */
export function pushOutsideTrayReturnZone(worldX: number, worldZ: number): readonly [number, number] {
  const dx = worldX - TRAY_RETURN_ZONE_POSITION[0];
  const dz = worldZ - TRAY_RETURN_ZONE_POSITION[2];
  const cos = Math.cos(TRAY_ROTATION_Y);
  const sin = Math.sin(TRAY_ROTATION_Y);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const halfX = TRAY_RETURN_ZONE_FOOTPRINT[0] / 2;
  const halfZ = TRAY_RETURN_ZONE_FOOTPRINT[1] / 2;

  if (Math.abs(localX) > halfX || Math.abs(localZ) > halfZ) {
    return [worldX, worldZ];
  }

  // Push out along whichever axis is closer to its own edge, so the point
  // slides along the tray's side instead of snapping across its middle.
  const overlapX = halfX - Math.abs(localX);
  const overlapZ = halfZ - Math.abs(localZ);
  const pushedLocalX = overlapX < overlapZ ? Math.sign(localX || 1) * halfX : localX;
  const pushedLocalZ = overlapX < overlapZ ? localZ : Math.sign(localZ || 1) * halfZ;

  return [
    TRAY_RETURN_ZONE_POSITION[0] + pushedLocalX * cos - pushedLocalZ * sin,
    TRAY_RETURN_ZONE_POSITION[2] + pushedLocalX * sin + pushedLocalZ * cos,
  ];
}
