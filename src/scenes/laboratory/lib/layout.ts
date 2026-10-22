import * as THREE from "three";

import type { CameraView } from "../../../entities/laboratory";

export type Position3 = readonly [number, number, number];

/**
 * Every fixed viewpoint the camera can rest at: the general overview, the
 * work table, each of the standalone reagent/equipment cabinets — the
 * ToR's original "пять шкафов" (acids, bases, oxides, salts, glassware)
 * plus `cabinet-lab-equipment`, added later per the player's own request
 * and not part of that original spec — and the two
 * equipment pieces (`fume-hood`, `ppe-cabinet` — see `EQUIPMENT`). This is
 * finer-grained than the domain `CameraView` (which only distinguishes
 * reagent/equipment/safety at the zone level) — several cabinets share a
 * `CameraView`, but each still gets its own precise camera pose so clicking
 * any one of them frames *that* cabinet instead of jumping to a generic
 * "left wall" shot.
 */
export type SceneTargetId =
  | "overview"
  | "table"
  | "cabinet-acids"
  | "cabinet-bases"
  | "cabinet-oxides"
  | "cabinet-salts"
  | "cabinet-glassware"
  | "cabinet-lab-equipment"
  | "cabinet-simple"
  | "fume-hood"
  | "ppe-cabinet";

/** A hotspot the crosshair can aim at — every target except the overview itself. */
export type HotspotTargetId = Exclude<SceneTargetId, "overview">;

/**
 * Generic tray-eligibility rule (not a per-cabinet allowlist): every one of
 * the reagent/glassware/equipment cabinets shares the `"cabinet-"` id prefix
 * (`cabinet-acids`, `cabinet-glassware`, `cabinet-lab-equipment`, ...), while the excluded zones
 * (`table`, `fume-hood`, `ppe-cabinet`) don't — so a newly added cabinet is
 * automatically eligible without touching this function.
 */
export function isTrayHeldEligible(id: HotspotTargetId | null): boolean {
  // The fume hood too: the tray is carried there and unloaded into it (VL-017).
  return id !== null && (id.startsWith("cabinet-") || id === "fume-hood");
}

export interface CabinetDef {
  readonly id: HotspotTargetId;
  readonly label: string;
  readonly accentColor: string;
  readonly zone: CameraView;
  readonly position: Position3;
  readonly rotationY: number;
  /**
   * Whether a production-ready 3D asset exists for this cabinet. Ready slots
   * render the real `ReagentCabinet.glb` (reused across all four reagent
   * categories, per the reagent-cabinet asset design); not-ready slots
   * render nothing, per the standing rule against fabricating placeholder
   * cabinet models once a real asset pipeline exists. Since crosshair hover
   * is now real geometry raycasting (`useHotspotObjectsStore`), a not-ready
   * slot has no hoverable/clickable hotspot either — there's nothing to
   * raycast against until it gets a real asset. Every cabinet is ready
   * today (verified — none currently sets this `false`).
   */
  readonly assetReady: boolean;
  /**
   * Total reagent/content pages this cabinet has. Every cabinet is 1 for
   * now (no per-page content exists yet) — kept as per-cabinet config
   * rather than a hardcoded "1" in the display component so a cabinet can
   * later be given more pages without touching rendering code. Current
   * page is separate *runtime* state (see `useCabinetPageStore`), since
   * unlike this static count it changes via player interaction.
   */
  readonly totalPages: number;
}

export interface CameraTarget {
  readonly position: Position3;
  /** Base heading in radians. 0 = facing world -Z (into the room from the entrance). */
  readonly yaw: number;
  /** Base pitch in radians. Positive = looking up, negative = looking down. */
  readonly pitch: number;
}

/**
 * These dimensions and every position/rotation derived from them below are
 * measured directly from the approved production room asset
 * (`public/assets/models/LabRoom.glb`, exported from
 * `LabRoom_STAGE2_ARCHITECTURE_V6_MASCOT_FIX.blend` after final QA) rather
 * than assumed — this is an import/integration correction, not a room
 * redesign. Two things differ from the old primitive placeholder's
 * assumptions and are load-bearing for everything below:
 *
 * 1. The entrance door and the window/radiator sit on *opposite* walls from
 *    what the placeholder guessed — door on the −Z wall, window on the +Z
 *    wall — so "front"/"back" are effectively swapped versus the old code.
 * 2. The two walls aren't equidistant from center: the window wall is
 *    thicker (measured ~0.48 m, to house the radiator niche) than the
 *    door wall and the two side walls (~0.15 m each), so depth is encoded
 *    as two independent interior Z faces rather than one symmetric
 *    `HALF_DEPTH`.
 */
export const ROOM = {
  width: 9,
  height: 3.2,
  wallThickness: 0.15,
} as const;

const HALF_WIDTH = ROOM.width / 2;

/** Interior wall face — everything freestanding must sit in front of it, not behind. */
const RIGHT_WALL_INNER_X = HALF_WIDTH - ROOM.wallThickness / 2;
/** Door wall (entrance), interior face. */
const FRONT_WALL_INNER_Z = -3.125;
/** Window/radiator wall, interior face. */
const BACK_WALL_INNER_Z = 3.125;

export const DOOR = {
  width: 0.97,
  height: 2.1,
  centerX: 3.2,
} as const;

export const WINDOW = {
  width: 1.8,
  height: 1.5,
  centerX: 2.3,
} as const;

export const TABLE = {
  width: 2.8,
  depth: 1.3,
  height: 0.9,
  topThickness: 0.06,
} as const;

/** Margin kept clear of the countertop's own physical edge for anything dragged across it — small enough that a dragged prop still reads as sitting right at the edge, large enough that it never visibly overhangs into empty air. */
export const TABLE_DRAG_EDGE_MARGIN = 0.08;

/**
 * Clamps a world X/Z to the countertop's own physical bounds (minus
 * `TABLE_DRAG_EDGE_MARGIN`), centered on `tablePosition` — shared by every
 * "drag a prop across the table" mechanic (workbench reagent jars in
 * `CameraRig`, a picked-up test tube in `InspectableTestTubeSlot`) so they
 * all respect the exact same physical edge instead of each guessing their
 * own bounds.
 */
export function clampToTableWorldXZ(worldX: number, worldZ: number, tablePosition: Position3): readonly [number, number] {
  const halfWidth = TABLE.width / 2 - TABLE_DRAG_EDGE_MARGIN;
  const halfDepth = TABLE.depth / 2 - TABLE_DRAG_EDGE_MARGIN;
  return [
    THREE.MathUtils.clamp(worldX, tablePosition[0] - halfWidth, tablePosition[0] + halfWidth),
    THREE.MathUtils.clamp(worldZ, tablePosition[2] - halfDepth, tablePosition[2] + halfDepth),
  ];
}

/** ReagentCabinet.glb's real depth (perpendicular to the wall it hugs) — see `PLACEHOLDER_Cabinet_*` bounding box. */
const CABINET_DEPTH = 0.62;
/**
 * Uniform scale applied to every visible reagent cabinet instance (see
 * `ReagentCabinetInstance.tsx`). Cabinets read slightly small against the
 * room at 1:1, so they're scaled up modestly here — applied once, at the
 * outer wrapper `<group>`, so the whole cloned hierarchy (doors, shutter,
 * hinge pivots, rail travel) scales together and stays internally
 * consistent; the door-open animation's angles/travel distances are
 * computed in the cabinet's own local space and are unaffected by this.
 */
export const CABINET_SCALE = 1.1;
/** Real depth at `CABINET_SCALE` — the wall-clearance math below must use this, not the unscaled depth, or the bigger cabinet would either poke into the wall or leave a too-wide gap. */
const CABINET_DEPTH_SCALED = CABINET_DEPTH * CABINET_SCALE;
/**
 * Small physically-believable standoff between a cabinet's back and the
 * wall it hugs (baseboard/skirting clearance) so the cabinet's back face
 * isn't exactly coplanar with the wall's interior face — coplanar geometry
 * z-fights under a moving camera even though it looks fine in a single
 * static screenshot.
 */
const WALL_CLEARANCE = 0.03;
/**
 * The left wall itself no longer hosts any `CabinetDef` (the reagent trio
 * that used to live here moved to the back wall — see `BACK_CABINET_Z`
 * below — and `FumeHood`/`PPECabinet` compute their own wall-flush X
 * directly, per-asset, since their depths differ from `CABINET_DEPTH`); so
 * unlike `RIGHT_CABINET_X`, there's no shared "left cabinet X" left to
 * factor out.
 */
const RIGHT_CABINET_X = RIGHT_WALL_INNER_X - CABINET_DEPTH_SCALED / 2 - WALL_CLEARANCE;
/**
 * Back/window wall Z for the simple-substances/oxides/glassware trio, which
 * moved here from the left wall to make room for `FumeHood`/`PPECabinet`
 * (see the `CABINETS` comment below). Same wall-hugging + clearance
 * convention as `RIGHT_CABINET_X`, mirrored for a
 * Z-normal wall: these cabinets face -Z (rotationY = 0, the asset's own
 * unrotated default — verified against the existing ±90° side-wall
 * placements, see `computeInspectionTarget`'s general `forward` vector),
 * so their back sits toward +Z, against `BACK_WALL_INNER_Z`.
 */
const BACK_CABINET_Z = BACK_WALL_INNER_Z - CABINET_DEPTH_SCALED / 2 - WALL_CLEARANCE;
/**
 * Focus-camera standoff from the cabinet centerline (see `CAMERA_TARGETS`)
 * — close enough that the ~2.2 m scaled cabinet fills roughly 80–90% of
 * the vertical frame at the Canvas's 55° FOV, without clipping through the
 * doors when they swing open (±95°, well short of reaching this distance).
 */
const CABINET_FOCUS_DISTANCE = 2.3;

/**
 * Furniture anchor positions below (cabinets, work table) are not
 * guessed — they're read from the `PLACEHOLDER_Cabinet_*` /
 * `PLACEHOLDER_WorkTable` empties already authored inside the approved
 * Blender scene (parented under a `DEBUG_FurniturePlaceholders` group,
 * hidden from render, not exported into `LabRoom.glb`), converted from
 * Blender's Z-up to three.js Y-up. Cabinets hug the interior wall faces with
 * zero gap by construction (their depth was sized against this same wall
 * position), three per side wall, matching the door/window swap noted above.
 */
export const LAYOUT = {
  room: ROOM,
  door: DOOR,
  window: {
    position: [WINDOW.centerX, 1.9, BACK_WALL_INNER_Z] as Position3,
  },
  table: {
    position: [0, 0, -0.4] as Position3,
  },
} as const;

/**
 * `LabTray_Metal.glb` placement on the workbench countertop — read directly
 * from `LaboratoryWorkbench.glb`'s own authored anchor nodes (parsed from
 * the glb's node list, not guessed): `Workbench_RightZone` sits at local
 * X -0.925, the same X the `CabinetBody_Drawers` module (no sink, no doors
 * opening onto the countertop) is centered under, while
 * `Workbench_WetZone`/`Sink_Anchor` claim the opposite side at X=+0.925 —
 * so this X reads as the countertop's right (drawer) side without
 * overlapping the sink/faucet or the center `Experiment_Anchor_0{1..4}`
 * strip (X ±0.45). Y matches the real `Countertop` node's top face
 * (translation.y 0.875 + half its 0.05 scale = 0.9); the tray's own glb
 * origin is its base center, so this Y alone rests it flush with zero
 * extra offset.
 *
 * Z is NOT simply the anchor's own depth-centered value anymore (it was,
 * historically, at -0.425 — the midpoint of the countertop's real Z span,
 * -0.85 front apron to 0 rear panel in the workbench's own local frame).
 * That assumed `Tray_Body`'s geometric center sat at its own local origin,
 * true only for the ORIGINAL, symmetric tray (local X ±0.3162). Every
 * later jar-side stretch (+60/+40/+50/+18.75mm, rack-side edge -0.3162
 * left untouched each time — see `useTrayReagentAreaStore`'s `originX`
 * doc) grew the mesh only in +X, so its center drifted to local X
 * +0.09188 (`(-0.3162 + 0.5) / 2`) while this anchor kept centering the
 * unchanged local ORIGIN instead of the shape. Player-reported and
 * confirmed by direct measurement: with -0.425, `Tray_Body`'s real world Z
 * span came out [-1.325, -0.509] against the countertop's [-1.25, -0.4] —
 * the jar side overhung the countertop edge by 75mm while the rack side
 * had 109mm to spare. Since this rotation maps local +X to world -Z (see
 * `TRAY_ROTATION_Y`), compensating for that +0.09188 drift means adding
 * the same 0.09188 here: -0.425 + 0.091875 = -0.333125. Re-measured after
 * the fix: `Tray_Body` world Z span [-1.2331, -0.4169], exactly 16.9mm of
 * clearance from the countertop's own edge on both sides.
 */
const WORKBENCH_RIGHT_ZONE_LOCAL: Position3 = [-0.925, 0.9, -0.333125];

export const TRAY_POSITION: Position3 = [
  LAYOUT.table.position[0] + WORKBENCH_RIGHT_ZONE_LOCAL[0],
  LAYOUT.table.position[1] + WORKBENCH_RIGHT_ZONE_LOCAL[1],
  LAYOUT.table.position[2] + WORKBENCH_RIGHT_ZONE_LOCAL[2],
];

/** Fixed world-space position for the tray when it is resting on the table. */
export const TABLE_TRAY_POSITION: Position3 = TRAY_POSITION;

/** Turns the tray's authored 0.816 m long axis (local X in the source glb) to run front-to-back (Z) on the tabletop, per placement spec. */
export const TRAY_ROTATION_Y = Math.PI / 2;

/**
 * The ToR's original five (acids, bases, oxides, salts, glassware) plus
 * `cabinet-lab-equipment`, added later on the player's own request. PPE is
 * explicitly *not* one of these — it's a different asset (`PPECabinet.glb`),
 * listed in `EQUIPMENT` below alongside the fume hood.
 *
 * Wall assignment swapped once already (acids/bases/oxides used to be on
 * the world −X wall, screen-right from the overview camera, with
 * salts/glassware on world +X/screen-left; that's now mirrored). This pass
 * moves `cabinet-oxides` again — off the back wall, onto the right wall
 * alongside the other three reagent categories (acids/salts/bases), per
 * the player's own "change of approach": group all four reagent-family
 * cabinets on one wall, leave the back wall for glassware/equipment.
 *
 * Right wall now hosts FOUR cabinets, not three, so they're recentered on
 * Z=0 at the same 1.4 m rhythm (−2.1/−0.7/0.7/2.1) rather than simply
 * appending oxides at old-acids-position + 1.4 (which would have reached Z
 * 2.8, overflowing `BACK_WALL_INNER_Z` — the room is 6.25 m deep between
 * the two side-wall interior faces, and 4 cabinets at this rhythm need
 * 2×2.1 + the cabinet's own real scaled width (1.2106 m, measured off
 * `ReagentCabinet.glb` via `tests/measure-cabinet.mjs`) = 5.41 m,
 * comfortably inside that, but only when centered; anchored to the old
 * trio's positions it isn't).
 * This shifts acids/bases/salts each by exactly −0.7 m from their previous
 * spots — a deliberate, uniform recenter, not three independent moves.
 *
 * Back wall is back to its original three-slot geometry (0.3/−1.1/−2.5,
 * the plain 1.4 m rhythm off `BACK_CABINET_Z` with no special-cased
 * anchor) now that oxides has vacated the middle slot —
 * `cabinet-lab-equipment` takes it, `cabinet-simple`/`cabinet-glassware`
 * are untouched. This retired the one-off dedicated X constant a previous
 * pass needed while lab-equipment was still squeezed in past glassware
 * toward the corner (there wasn't room for a plain 1.4 m-rhythm 4th slot
 * on this wall). Moving oxides to the right wall instead removed that
 * whole constraint.
 *
 * Only the reagent categories (acids/bases/oxides/salts) share
 * `ReagentCabinet.glb` as a reusable body with glassware/lab-equipment —
 * see the reagent-cabinet asset design. Every cabinet here has a
 * production-ready asset (`assetReady: true`).
 */
export const CABINETS: readonly CabinetDef[] = [
  // Right wall: ОСНОВАНИЯ / СОЛИ / КИСЛОТЫ / ОКСИДЫ — four cabinets,
  // recentered on Z=0 at the shared 1.4 m rhythm (see the block doc above
  // for why appending oxides at the old rhythm's end would've overflowed
  // the room instead).
  {
    id: "cabinet-bases",
    label: "Основания",
    accentColor: "#3E7BFA",
    zone: "reagent-cabinet",
    position: [RIGHT_CABINET_X, 0, -2.1],
    rotationY: Math.PI / 2,
    assetReady: true,
    totalPages: 1,
  },
  {
    id: "cabinet-salts",
    label: "Соли",
    accentColor: "#2FA8A0",
    zone: "reagent-cabinet",
    position: [RIGHT_CABINET_X, 0, -0.7],
    rotationY: Math.PI / 2,
    assetReady: true,
    totalPages: 1,
  },
  {
    id: "cabinet-acids",
    label: "Кислоты",
    accentColor: "#C94B4B",
    zone: "reagent-cabinet",
    position: [RIGHT_CABINET_X, 0, 0.7],
    rotationY: Math.PI / 2,
    assetReady: true,
    totalPages: 1,
  },
  {
    id: "cabinet-oxides",
    label: "Оксиды",
    accentColor: "#6F7782",
    zone: "reagent-cabinet",
    // Window end of the row (matches the back wall's own window-side
    // corner, where cabinet-simple sits) — appended after acids rather
    // than before bases, an arbitrary but as-good-as-any end to extend.
    position: [RIGHT_CABINET_X, 0, 2.1],
    rotationY: Math.PI / 2,
    assetReady: true,
    totalPages: 1,
  },
  // Back/window wall: ПРОСТЫЕ ВЕЩЕСТВА / Хим. посуда / ЛАБ. ОБОРУДОВАНИЕ —
  // lab-equipment and glassware swapped slots (player request), so the
  // middle slot vacated by oxides is now glassware's, and lab-equipment
  // moved to the corner end. rotationY: 0 is this asset's own unrotated
  // default facing (-Z, verified against the existing ±90° side-wall
  // cabinets — see computeInspectionTarget's `forward` vector), which
  // points into the room from this wall. Plain 1.4m-rhythm X positions off
  // `BACK_CABINET_Z`, same three slots this wall has always had.
  {
    id: "cabinet-simple",
    label: "Простые вещества",
    accentColor: "#E0A030",
    zone: "reagent-cabinet",
    position: [0.3, 0, BACK_CABINET_Z],
    rotationY: 0,
    assetReady: true,
    totalPages: 1,
  },
  // Middle slot, vacated by oxides — no `CABINET_REAGENT_IDS` entry, an
  // empty shelf like every other cabinet until content is defined for it.
  {
    id: "cabinet-lab-equipment",
    label: "Лаб. оборудование",
    accentColor: "#5C8F6B",
    zone: "equipment-cabinet",
    // Swapped with cabinet-glassware (player request) — now the wall's
    // far/corner slot, nearest the fume-hood/ppe-cabinet corner.
    position: [-2.5, 0, BACK_CABINET_Z],
    rotationY: 0,
    assetReady: true,
    totalPages: 1,
  },
  {
    id: "cabinet-glassware",
    // Shortened per spec ("Хим. посуда", not the earlier full
    // "Химическая посуда") — same shared ReagentCabinet.glb, uppercased on
    // the physical plate like every other category (renders "ХИМ. ПОСУДА").
    label: "Хим. посуда",
    accentColor: "#a78bfa",
    zone: "equipment-cabinet",
    // Swapped with cabinet-lab-equipment (player request) — now the middle
    // slot, vacated by oxides.
    position: [-1.1, 0, BACK_CABINET_Z],
    rotationY: 0,
    assetReady: true,
    totalPages: 1,
  },
];

/**
 * World yaw for a held tray whose authored long axis is local X. Reusing the
 * cabinet's yaw keeps that axis parallel to the cabinet's front edge on both
 * the back wall and the right wall.
 */
export function getCabinetParallelTrayYaw(
  cabinetId: HotspotTargetId | null | undefined,
  fallbackYaw = 0,
): number {
  return CABINETS.find((cabinet) => cabinet.id === cabinetId)?.rotationY ?? fallbackYaw;
}

/**
 * Fixed left/right walkthrough order for the "step to the next cabinet
 * without returning to the room" arrows — the reagent/glassware/equipment
 * cabinets only (fume-hood/ppe-cabinet/table aren't part of this chain,
 * they only ever get the room-return control). Order follows the physical
 * wall walk: right wall from the entrance end (bases) to the window end
 * (oxides, appended after acids — see the `CABINETS` block doc for why the
 * four reagent-family cabinets now share this wall), then the back wall
 * from its window-side corner (simple) to its left end (lab-equipment,
 * nearest the fume-hood/ppe-cabinet corner, after swapping places with
 * glassware) — the two ends of this walk (bases, lab-equipment) are the two
 * ends of the arrow chain by construction.
 */
export const CABINET_CHAIN_ORDER: readonly HotspotTargetId[] = [
  "cabinet-bases",
  "cabinet-salts",
  "cabinet-acids",
  "cabinet-oxides",
  "cabinet-simple",
  "cabinet-glassware",
  "cabinet-lab-equipment",
];

/**
 * Neighbors of `id` within `CABINET_CHAIN_ORDER`, or both `null` if `id`
 * isn't part of the chain (fume-hood/ppe-cabinet/table) or sits at either
 * end (bases has no `prevId`, glassware has no `nextId`) — callers render an
 * arrow only when its side is non-null, rather than rendering a
 * disabled/greyed-out arrow at the chain ends.
 */
export function getChainNeighbors(id: HotspotTargetId): {
  readonly prevId: HotspotTargetId | null;
  readonly nextId: HotspotTargetId | null;
} {
  const index = CABINET_CHAIN_ORDER.indexOf(id);
  if (index === -1) return { prevId: null, nextId: null };
  return {
    prevId: index > 0 ? CABINET_CHAIN_ORDER[index - 1] : null,
    nextId: index < CABINET_CHAIN_ORDER.length - 1 ? CABINET_CHAIN_ORDER[index + 1] : null,
  };
}

export interface EquipmentDef {
  readonly id: "fume-hood" | "ppe-cabinet";
  readonly label: string;
  readonly zone: CameraView;
  readonly position: Position3;
  readonly rotationY: number;
  /** Which loader component renders this slot (`FumeHood.tsx` / `PPECabinet.tsx`) — there's one of each, not a shared reusable body like the reagent cabinets. */
  readonly model: "fume-hood" | "ppe";
  /** Real asset height (m), floor to top — used to frame the inspection camera; see `computeEquipmentInspectionTarget`. */
  readonly height: number;
  /** Real asset depth (m), front to back — used to place the inspection camera clear of the front face. */
  readonly depth: number;
}

/**
 * The fume hood and its adjacent PPE storage cabinet — both on the left
 * wall (see `FumeHood.tsx`/`PPECabinet.tsx` for the flush-to-wall math),
 * immediately next to each other with a 0.2m gap. Both assets share this
 * family's own unrotated default facing (local +Z, unlike the reagent
 * cabinets' local -Z — see each component's own DEFAULT_POSITION comment),
 * so rotationY = +π/2 turns that to world +X here, matching the left
 * wall's existing cabinet convention.
 */
export const EQUIPMENT: readonly EquipmentDef[] = [
  {
    id: "fume-hood",
    label: "Вытяжной шкаф",
    zone: "equipment-cabinet",
    position: [-3.97, 0, 0.5],
    rotationY: Math.PI / 2,
    model: "fume-hood",
    height: 2.2,
    depth: 0.85,
  },
  {
    id: "ppe-cabinet",
    label: "СИЗ",
    zone: "safety-zone",
    position: [-4.145, 0, -0.85],
    rotationY: Math.PI / 2,
    model: "ppe",
    height: 2.0,
    depth: 0.5,
  },
];

const degToRad = THREE.MathUtils.degToRad;

/**
 * One fixed camera pose per hotspot, plus the general overview. Yaw 0 faces
 * world −Z; since the entrance is on the −Z wall and the window/radiator on
 * the +Z wall (see the room-dimensions note above), every "look into the
 * room from the entrance" pose here faces +Z (yaw = π), the mirror of the
 * old placeholder-room assumption.
 */
export const CAMERA_TARGETS: Record<SceneTargetId, CameraTarget> = {
  overview: {
    // Pulled back almost to the entrance wall so the table doesn't fill the
    // whole frame.
    position: [0, 1.75, FRONT_WALL_INNER_Z + 0.25],
    yaw: Math.PI,
    pitch: degToRad(-8),
  },
  // Looking down onto the work area (VL-018): the frame's middle on the
  // stand (Z ≈ −0.8), the whole depth of the countertop in view — at −22°
  // from 1.5 m the middle of the frame was past the table's far edge and
  // the near half of the table was out of it.
  table: {
    position: [LAYOUT.table.position[0], 1.55, LAYOUT.table.position[2] - 1.25],
    yaw: Math.PI,
    pitch: degToRad(-38),
  },
  // ~2.3 m standoff to the cabinet centerline: at the 55° vertical FOV used
  // by the Canvas and the cabinet's scaled ~2.2 m height (CABINET_SCALE),
  // that puts the cabinet at roughly 85% of the vertical frame — close
  // enough to read shelf/interior detail without clipping through the
  // doors when open. Computed from `RIGHT_CABINET_X`
  // rather than a hardcoded literal, so it stays correct if the cabinet's
  // own wall position ever changes again. Yaw is exact (±90°) since the
  // camera sits directly opposite the cabinet at matching depth.
  // Right wall now hosts all four reagent-family cabinets, recentered on
  // Z=0 (see the CABINETS block doc) — same ±90° yaw convention as before.
  "cabinet-bases": { position: [RIGHT_CABINET_X - CABINET_FOCUS_DISTANCE, 1.15, -2.1], yaw: degToRad(90), pitch: 0 },
  "cabinet-salts": { position: [RIGHT_CABINET_X - CABINET_FOCUS_DISTANCE, 1.15, -0.7], yaw: degToRad(90), pitch: 0 },
  "cabinet-acids": { position: [RIGHT_CABINET_X - CABINET_FOCUS_DISTANCE, 1.15, 0.7], yaw: degToRad(90), pitch: 0 },
  "cabinet-oxides": { position: [RIGHT_CABINET_X - CABINET_FOCUS_DISTANCE, 1.15, 2.1], yaw: degToRad(90), pitch: 0 },
  // These three now face -Z from the back wall (rotationY: 0 in CABINETS),
  // so the standoff is along Z, not X, and yaw is π (faces +Z, back toward
  // the cabinet) rather than ±90°.
  "cabinet-simple": { position: [0.3, 1.15, BACK_CABINET_Z - CABINET_FOCUS_DISTANCE], yaw: Math.PI, pitch: 0 },
  "cabinet-lab-equipment": { position: [-1.1, 1.15, BACK_CABINET_Z - CABINET_FOCUS_DISTANCE], yaw: Math.PI, pitch: 0 },
  "cabinet-glassware": { position: [-2.5, 1.15, BACK_CABINET_Z - CABINET_FOCUS_DISTANCE], yaw: Math.PI, pitch: 0 },
  // Left wall, facing +X (see EQUIPMENT) — camera stands further +X (into
  // the room) and faces -X (yaw -90°) to look back at it.
  "fume-hood": { position: [-3.97 + CABINET_FOCUS_DISTANCE, 1.15, 0.5], yaw: degToRad(-90), pitch: 0 },
  "ppe-cabinet": { position: [-4.145 + CABINET_FOCUS_DISTANCE, 1.15, -0.85], yaw: degToRad(-90), pitch: 0 },
};

/** Maximum vertical mouse-look deflection, to keep the visitor from flipping upside down. */
export const MAX_LOOK_PITCH = degToRad(80);

/**
 * Maximum horizontal mouse-look deflection either side of a rest viewpoint's
 * own base heading (`CameraTarget.yaw`) — half of the requested 270° total
 * turning range. Room-phase yaw is otherwise a free-running accumulator with
 * no wrap, so without this a player could spin a full 360° (or more) past
 * the resting direction; capping it keeps the look range wide (270° is most
 * of a full turn) while still guaranteeing the camera can never face back
 * through the viewpoint's own blind rear arc.
 */
export const MAX_LOOK_YAW = degToRad(135);

/**
 * Close cabinet-inspection camera targets — flown to on a single click (see
 * `CameraRig.tsx`), replacing the old plain `CAMERA_TARGETS[cabinetId]`
 * zoom for reagent cabinets. `UPPER_COMPARTMENT_BOTTOM_Z_LOCAL` (0.64) /
 * `_TOP_Z_LOCAL` (1.885) are not eyeballed — verified directly in
 * `ReagentCabinet_MASTER.blend`: `Frame`/`Glass`/`SidePost_Left`/
 * `SidePost_Right` all agree on this Z range in world space, the true
 * vertical extent of the glazed upper compartment (doors, glass, shelves,
 * control panel). `0.64` also matches `UpperLower_Separator`'s own height,
 * confirming it as the real boundary against the closed lower section.
 * (An earlier version of this used `Shelf_01`/`Shelf_03`'s raw local
 * translation instead, which was wrong — it didn't account for their
 * parent `ReagentRack` being itself offset +0.64 from the cabinet root.)
 */
const UPPER_COMPARTMENT_BOTTOM_Z_LOCAL = 0.64;
const UPPER_COMPARTMENT_TOP_Z_LOCAL = 1.885;
/**
 * Extra headroom above the compartment's own top so the cap/top-housing
 * structure reads as visible, not just cropped at the door frame's top
 * edge. Raised from 0.15 to 0.27 this pass — both this and
 * `BOTTOM_MARGIN_LOCAL` went up by the same +0.12, shifting the whole
 * frame upward by that amount (the requested "raise ~0.10-0.15 m") while
 * leaving the frame's total vertical span — and so the solved distance —
 * unchanged.
 */
const TOP_HOUSING_MARGIN_LOCAL = 0.27;
/**
 * Clearance trimmed off the compartment's real bottom, raising the frame
 * and de-emphasizing the empty interior gap below the lowest shelf
 * (`Shelf_01` sits at ~0.966–0.986 world Z, comfortably above this cut —
 * the shelf itself stays fully in frame, only the dead space below it is
 * excluded).
 */
const BOTTOM_MARGIN_LOCAL = 0.27;

/**
 * Narrow inspection FOV — flattens the perspective so the open doors read
 * as narrow framing elements at the edges instead of dominating the shot,
 * per the requested 36–40° range. With the same vertical span as before
 * (raising both margins by the same amount didn't change the span), this
 * solves to ≈1.99 m distance — right in the requested 1.9–2.1 m range —
 * without needing a separate hardcoded distance value (see
 * `computeInspectionTarget`).
 */
export const CABINET_INSPECTION_FOV = 38;

export interface InspectionTarget {
  readonly position: Position3;
  readonly lookAt: Position3;
  readonly fov: number;
}

/**
 * Straight-on, perfectly symmetric front view — no lateral offset on
 * either the camera or the look target. An earlier version of this nudged
 * both sideways to bias the frame toward the ControlPanel's real position;
 * that read as a diagonal/skewed angle rather than a clean front-on shot,
 * which is explicitly what's wanted now. The ControlPanel is still
 * naturally visible off-center in the resulting frame (it really is
 * offset from the cabinet's centerline), just not through a contrived
 * camera angle — horizontal FOV coverage at this distance has generous
 * margin beyond the cabinet's own ~1.2 m width, and the doors are open
 * (swung out of the direct view corridor), so nothing hides it.
 */
/** Manual tuning offset (meters), moves the cabinet inspection camera toward (+) or away from (-) the cabinet along its facing axis. Temporary — cleared once the calibration session ends. */
const INSPECTION_FORWARD_OFFSET = 0.6;

function computeInspectionTarget(cabinet: CabinetDef): InspectionTarget {
  const [cx, , cz] = cabinet.position;

  // Solve camera distance + look-target height together so the vertical
  // frame edges land exactly on [bottom of upper compartment (+ margin),
  // top of upper compartment (+ housing margin)] at the chosen FOV, rather
  // than picking a distance and hoping the framing lands right.
  const bottomTargetY = (UPPER_COMPARTMENT_BOTTOM_Z_LOCAL + BOTTOM_MARGIN_LOCAL) * CABINET_SCALE;
  const topTargetY = (UPPER_COMPARTMENT_TOP_Z_LOCAL + TOP_HOUSING_MARGIN_LOCAL) * CABINET_SCALE;
  const lookAtY = (bottomTargetY + topTargetY) / 2;
  const halfFovRad = degToRad(CABINET_INSPECTION_FOV / 2);
  const distance = (topTargetY - bottomTargetY) / 2 / Math.tan(halfFovRad);

  // General facing vector from rotationY, not just ±X — this asset's own
  // unrotated default (rotationY: 0) faces world -Z (verified against the
  // existing ±90° side-wall cabinets, which face +X/-X respectively; see
  // the back-wall trio in `CABINETS`, added after the wall swap that moved
  // simple/oxides/glassware here from the left wall). A pure X-only
  // faceSign broke for those the moment they stopped being side-wall-only.
  const [fx, fz] = [-Math.sin(cabinet.rotationY), -Math.cos(cabinet.rotationY)];
  const frontFaceX = cx + fx * (CABINET_DEPTH_SCALED / 2);
  const frontFaceZ = cz + fz * (CABINET_DEPTH_SCALED / 2);
  const standoff = distance - INSPECTION_FORWARD_OFFSET;
  const cameraX = frontFaceX + fx * standoff;
  const cameraZ = frontFaceZ + fz * standoff;

  return {
    // Level with the look target (no vertical tilt), straight-on along the
    // cabinet's own forward axis (no lateral skew).
    position: [cameraX, lookAtY, cameraZ],
    lookAt: [cx, lookAtY, cz],
    fov: CABINET_INSPECTION_FOV,
  };
}

/**
 * Vertical margin above/below the unit's real floor-to-top height, as a
 * fraction of that height — same "don't crop the frame edges exactly at
 * the asset" purpose as `TOP_HOUSING_MARGIN_LOCAL`/`BOTTOM_MARGIN_LOCAL`,
 * just simpler (equipment has no shelved "upper compartment" sub-region to
 * frame around — the whole unit is the subject).
 */
const EQUIPMENT_FRAME_MARGIN = 0.12;
/** Wider than `CABINET_INSPECTION_FOV` — these units are taller/narrower than a reagent cabinet, and a narrower FOV would push the camera uncomfortably far back down the wall. */
const EQUIPMENT_INSPECTION_FOV = 45;

/** Same distance-solve as `computeInspectionTarget`, but for `EquipmentDef` — see its own field docs for the height/depth this reads. */
function computeEquipmentInspectionTarget(equipment: EquipmentDef): InspectionTarget {
  const [cx, , cz] = equipment.position;

  const halfSpan = (equipment.height / 2) * (1 + EQUIPMENT_FRAME_MARGIN);
  const lookAtY = equipment.height / 2;
  const halfFovRad = degToRad(EQUIPMENT_INSPECTION_FOV / 2);
  const distance = halfSpan / Math.tan(halfFovRad);

  // This asset family's own unrotated default faces local +Z (opposite of
  // the reagent cabinets' local -Z default — see EQUIPMENT's own comment),
  // so the forward vector's sign is flipped from computeInspectionTarget's.
  const [fx, fz] = [Math.sin(equipment.rotationY), Math.cos(equipment.rotationY)];
  const frontFaceX = cx + fx * (equipment.depth / 2);
  const frontFaceZ = cz + fz * (equipment.depth / 2);
  const standoff = distance - INSPECTION_FORWARD_OFFSET;
  const cameraX = frontFaceX + fx * standoff;
  const cameraZ = frontFaceZ + fz * standoff;

  return {
    position: [cameraX, lookAtY, cameraZ],
    lookAt: [cx, lookAtY, cz],
    fov: EQUIPMENT_INSPECTION_FOV,
  };
}

/** One computed inspection target per ready reagent cabinet, plus one per `EQUIPMENT` entry — see `computeInspectionTarget`/`computeEquipmentInspectionTarget`. */
export const INSPECTION_TARGETS: Readonly<Record<string, InspectionTarget>> = Object.fromEntries([
  ...CABINETS.filter((cabinet) => cabinet.assetReady).map((cabinet) => [cabinet.id, computeInspectionTarget(cabinet)]),
  ...EQUIPMENT.map((equipment) => [equipment.id, computeEquipmentInspectionTarget(equipment)]),
]);

/**
 * How much farther back (in meters, along the same view axis as the final
 * inspection pose) the fume hood's staging pose sits by default. An
 * absolute add-on, not a multiple of the final distance — the final camera
 * already sits close to the room's own furniture-free margin (the
 * workbench occupies the room's center at X 0, only ~1.2 m from the fume
 * hood's final camera spot), so scaling the whole distance up would push
 * the staging pose into it.
 */
export const FUME_STAGING_EXTRA_DISTANCE = 0.45;

/**
 * Default pose for the fume hood's own intermediate "staging" camera stop
 * (see `CameraRig`'s staged approach: room → staging, pause while the panel
 * powers on and the sash rises → final pose) — pulled back
 * `FUME_STAGING_EXTRA_DISTANCE` from `finalTarget` along the same view
 * axis, same look-at and FOV. Only the *default*: `useCameraCalibrationStore`'s
 * "fume-hood-staging" preset lets a dev independently override position/
 * look-at/FOV via the F8 panel, same as every real hotspot's pose.
 */
export function computeFumeHoodStagingTarget(finalTarget: InspectionTarget): InspectionTarget {
  const [px, py, pz] = finalTarget.position;
  const [tx, , tz] = finalTarget.lookAt;
  let dx = px - tx;
  let dz = pz - tz;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  return {
    position: [px + dx * FUME_STAGING_EXTRA_DISTANCE, py, pz + dz * FUME_STAGING_EXTRA_DISTANCE],
    lookAt: [...finalTarget.lookAt],
    fov: finalTarget.fov,
  };
}
