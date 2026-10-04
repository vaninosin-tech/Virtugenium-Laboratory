import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { CameraView } from "../../../entities/laboratory";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import {
  CABINETS,
  CAMERA_TARGETS,
  clampToTableWorldXZ,
  EQUIPMENT,
  INSPECTION_TARGETS,
  MAX_LOOK_PITCH,
  MAX_LOOK_YAW,
  type HotspotTargetId,
} from "../lib/layout";
import { useCabinetOpenStore } from "../lib/useCabinetOpenStore";
import { TOTAL_DURATION_MS as CABINET_DOOR_CLOSE_DURATION_MS } from "../lib/useCabinetDoorAnimation";
import {
  getEffectiveInspectionTarget,
  getEffectiveTableTarget,
  MAX_FOV,
  MIN_FOV,
  useCameraCalibrationStore,
} from "../lib/useCameraCalibrationStore";
import { useDevMenuStore, type DevMenuCategory } from "../lib/useDevMenuStore";
import { useFumeHoodControlsStore } from "../lib/useFumeHoodControlsStore";
import { useFurniturePositionStore, type FurnitureId } from "../lib/useFurniturePositionStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { escapeTakenByHand } from "../lib/useHandStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { TUBE_FOCUS, useTubeCloseUpStore } from "../lib/useTubeCloseUpStore";
import { useHotspotObjectsStore } from "../lib/useHotspotObjectsStore";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useReagentPickablesStore, type ReagentPickableId } from "../lib/useReagentPickablesStore";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useStopperHolderStore } from "../lib/useStopperHolderStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { useWorkbenchReagentAreaStore } from "../lib/useWorkbenchReagentAreaStore";
import { useWorkbenchReagentDragStore } from "../lib/useWorkbenchReagentDragStore";
import { isInsideTrayReturnZone } from "../lib/trayReturnZone";

const POSITION_DAMPING = 0.28;

/** Fallback lean-in along the view ray, for when no tube focus is published. */
const HEAT_DOLLY_DISTANCE = 0.32;
const HEAT_DOLLY_DAMPING = 6;
/**
 * Camera-to-tube distance in the close-up. The tube is 15 cm tall; at the
 * inspection FOV this fills most of the screen height — bubbles, copper and
 * gas are centimetres and millimetres across and read as specks any further
 * out — with the flame below and a few centimetres of gas above the mouth.
 */
const TUBE_CLOSE_UP_DISTANCE = 0.26;
const YAW_SENSITIVITY = 0.0028;
const PITCH_SENSITIVITY = 0.0022;
/**
 * The table has no Pointer Lock to drive a normal FPS-style look (it's
 * released on arrival — see the `exitPointerLock` effect below — so the
 * player keeps a real, visible cursor for tabletop interaction), so it
 * gets its own separate orbit instead: hold the RIGHT mouse button and drag
 * (see `handlePointerDown`/`handleMouseMove`'s `tableOrbitDragging` branch).
 * Left-button dragging (dev-menu furniture/reagent-area repositioning) is
 * unaffected — this only ever reads button 2.
 *
 * Pitch can't roam the full ±80° `MAX_LOOK_PITCH` cone every other
 * viewpoint gets, though — `tableDragRef`'s horizontal drag plane
 * (dev-menu jar/prop repositioning) stays stable only because the table's
 * base pitch (-22°, see `CAMERA_TARGETS.table`) keeps the view ray well
 * clear of level; the SAME near-parallel-ray blowup already documented for
 * `furnitureDragRef` (a ~70px drag flinging a cabinet 80+ meters) would hit
 * the table's own reagent drags if pitch swung toward 0°. This keeps pitch
 * within a fixed ±15° of that base (-37° to -7°) — enough to look around
 * the tray/rack without ever nearing the unstable angle. Yaw has no such
 * risk (the drag plane's vertical component depends only on pitch), so it
 * gets the full base ± `MAX_LOOK_YAW` cone, same as every other hotspot.
 */
const TABLE_PITCH_LOOK_RANGE = THREE.MathUtils.degToRad(15);
/** The crosshair never moves off screen center — a plain constant, not a per-frame allocation. */
const SCREEN_CENTER_NDC = new THREE.Vector2(0, 0);

/** Which dev-menu tab a reagent pick target opens — see `useReagentPickablesStore`. */
const REAGENT_PICK_CATEGORY: Record<ReagentPickableId, DevMenuCategory> = {
  "held-tray": "tray",
  "workbench-stopper-holder": "stopper",
  "workbench-reagent-area": "reagent-area",
  "inspection-bottle": "buttons",
};

/** Reagent pickables that are also drag-to-reposition targets on the table — see `tableDragRef`'s doc. */
const DRAGGABLE_REAGENT_IDS = new Set<ReagentPickableId>(["workbench-stopper-holder", "workbench-reagent-area"]);

type DraggableReagentId = "workbench-stopper-holder" | "workbench-reagent-area";

/** Current WORLD position of a draggable reagent prop — table position plus its own store's table-relative offset (same convention `TRAY_POSITION` uses). */
function getReagentDragWorldPosition(id: DraggableReagentId): THREE.Vector3 {
  const tablePosition = useFurniturePositionStore.getState().getOverride("table").position;
  if (id === "workbench-stopper-holder") {
    const c = useStopperHolderStore.getState().holders.workbench;
    return new THREE.Vector3(tablePosition[0] + c.x, tablePosition[1] + c.y, tablePosition[2] + c.z);
  }
  const c = useWorkbenchReagentAreaStore.getState().config;
  return new THREE.Vector3(tablePosition[0] + c.originX, tablePosition[1] + c.originY, tablePosition[2] + c.originZ);
}

/** Writes a new table-relative X/Z back into the prop's own store (Y is never touched by dragging — see `tableDragRef`'s doc). */
function setReagentDragWorldXZ(id: DraggableReagentId, worldX: number, worldZ: number): void {
  const tablePosition = useFurniturePositionStore.getState().getOverride("table").position;
  const localX = worldX - tablePosition[0];
  const localZ = worldZ - tablePosition[2];
  if (id === "workbench-stopper-holder") {
    useStopperHolderStore.getState().setField("workbench", "x", localX);
    useStopperHolderStore.getState().setField("workbench", "z", localZ);
    return;
  }
  useWorkbenchReagentAreaStore.getState().setField("originX", localX);
  useWorkbenchReagentAreaStore.getState().setField("originZ", localZ);
}

/** Writes a new table-relative X/Z for ONE workbench reagent's own drag override (see `useWorkbenchReagentDragStore`'s doc — this only ever touches this one jar, never its neighbors). */
function setWorkbenchReagentWorldXZ(instanceId: string, worldX: number, worldZ: number): void {
  const tablePosition = useFurniturePositionStore.getState().getOverride("table").position;
  useWorkbenchReagentDragStore.getState().setPosition(instanceId, worldX - tablePosition[0], worldZ - tablePosition[2]);
}

/** Clamp a gameplay jar to the live, possibly dev-repositioned countertop — see `clampToTableWorldXZ`'s own doc (shared with the test tube drag in `InspectableTestTubeSlot`). */
function clampWorkbenchDragWorldXZ(worldX: number, worldZ: number): readonly [number, number] {
  const tablePosition = useFurniturePositionStore.getState().getOverride("table").position;
  return clampToTableWorldXZ(worldX, worldZ, tablePosition);
}

/**
 * Every hotspot with a real door/openable front to focus in on click —
 * reagent cabinets with a ready asset (the reserved not-yet-ready slot has
 * no rendered instance, so it can't be focused/opened) plus both
 * `EQUIPMENT` pieces (`FumeHood`, `PPECabinet` — see `useDoorSwingAnimation`
 * in each of their own components).
 */
const OPENABLE_CABINET_IDS = new Set<HotspotTargetId>([
  ...CABINETS.filter((cabinet) => cabinet.assetReady).map((cabinet) => cabinet.id),
  ...EQUIPMENT.map((equipment) => equipment.id),
]);

// Cabinet-interaction camera-flight timings — was 800/750ms, cut by 35%
// (×0.65) per a later request to make cabinet interaction feel snappier.
// Both restored back to those original pre-snappy values per later requests
// to slow the approach/return back down (see each constant's own doc).
/** Also used for a chain-arrow switch's camera tween (`beginSwitchTween`), not just the initial room->cabinet approach (`startFocusing`) — both fly the same way. */
const FOCUS_DURATION_MS = 800;
/**
 * Raised again (750 -> 1000ms) per a request to make the tray's own
 * return-to-table tween just as slow as its pickup appearance
 * (`TRAY_APPEAR_MAX_DURATION_S`, 0.85s) — that tween must finish strictly
 * before this one does (`LabTrayInstance`'s `TRAY_RETURN_MAX_DURATION_S`, so
 * reagents/test-tubes riding the tray don't vanish mid-flight), so this is
 * the actual ceiling on how slow the tray's return can get; 1000ms leaves a
 * comfortable ~150ms margin over the tray's 850ms ceiling.
 */
const RETURN_DURATION_MS = 1000;

/**
 * How close (squared, meters²) the dragged jar's own glide-home has to get
 * to its slot before a pending swap (`pendingSwapRef`) actually fires. The
 * exponential glide (`GRID_REFLOW_TIME_CONSTANT_S` in `Laboratory.tsx`)
 * never reaches exactly zero, so this is a "close enough" cutoff, not a
 * wait-for-arrival one — 3mm reads as fully settled at this scale.
 */
const SWAP_SETTLE_EPSILON_SQ = 0.003 * 0.003;
/** Safety ceiling so a pending swap can't get stuck forever if the glide's distance somehow never dips under the epsilon above (e.g. a dropped frame or two) — comfortably past the glide's own practical settle time. */
const SWAP_SETTLE_MAX_WAIT_MS = 900;

/**
 * Fume-hood-only staged approach: room → staging pose (its own independently
 * calibratable pose — F8 panel, preset "fume-hood-staging" — defaulting to a
 * wide, frontal view of the whole sash) → pause while the panel powers on
 * and the sash animates → final calibrated pose. Reverse on exit. Every
 * other cabinet still uses the single-tween `startFocusing`/`startReturning`
 * path above unchanged.
 *
 * All five stage durations below were 800/700/700/800/700ms, cut by 35%
 * (×0.65, same as the cabinet timings above) for the same snappier-feel
 * request. `FUME_SASH_DURATION_MS` must stay equal to `FumeHood.tsx`'s own
 * `SASH_TRANSITION_DURATION_MS` — this is the camera's *hold* time while the
 * sash physically slides, not an independent pacing choice, so it was
 * scaled by the exact same factor and kept in sync (both now 520ms) rather
 * than rounded independently.
 */
const FUME_HOOD_ID: HotspotTargetId = "fume-hood";
const FUME_APPROACH_DURATION_MS = 520;
/**
 * Hold time at the staging pose while the control panel plays its scripted
 * power-on/power-off: light then fan going in (each held on its own so the
 * player actually registers the change before the next thing happens),
 * sash then fan then light in the exact reverse order coming out. Camera
 * stays exactly at the staging pose throughout (see the
 * `advanceFumeHoodStage` camera-tween guard below, which only moves the
 * camera during `approach-in`/`final-in`/`approach-out`/`final-out`).
 */
const FUME_LIGHT_TOGGLE_DURATION_MS = 455;
const FUME_FAN_TOGGLE_DURATION_MS = 455;
const FUME_SASH_DURATION_MS = 520;
const FUME_FINAL_DURATION_MS = 455;

type FumeHoodStage =
  | "approach-in"
  | "light-on"
  | "fan-on"
  | "sash-in"
  | "final-in"
  | "approach-out"
  | "sash-out"
  | "fan-off"
  | "light-off"
  | "final-out";

function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - (-2 * t + 2) ** 5 / 2;
}

/** Inverse of the `sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)` direction formula used throughout this file — recovers the yaw/pitch that produced a given (unit) direction vector. */
function yawPitchFromDirection(direction: THREE.Vector3): { yaw: number; pitch: number } {
  return {
    yaw: Math.atan2(direction.x, -direction.z),
    pitch: Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)),
  };
}

/** Shortest-path angle lerp: interpolating e.g. from 170° to -170° goes the short way through 180° instead of the long way back around through 0°, which a plain `THREE.MathUtils.lerp` on raw radians would do. */
function lerpAngle(from: number, to: number, t: number): number {
  const delta = THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
  return from + delta * t;
}

interface Hotspot {
  readonly id: HotspotTargetId;
  readonly zone: CameraView;
}

const HOTSPOTS: readonly Hotspot[] = [
  ...CABINETS.map((cabinet) => ({ id: cabinet.id, zone: cabinet.zone })),
  ...EQUIPMENT.map((equipment) => ({ id: equipment.id, zone: equipment.zone })),
  { id: "table" as const, zone: "workbench" as const },
];

/** `CAMERA_TARGETS[id]`, substituting the dev calibration override for "table" when one has been saved. */
function resolveCameraTarget(id: keyof typeof CAMERA_TARGETS) {
  return id === "table" ? getEffectiveTableTarget() : CAMERA_TARGETS[id];
}

/**
 * Real mouse-look: click the canvas to engage the browser Pointer Lock, then
 * moving the mouse (no button held) rotates the view freely — standard FPS
 * convention, not click-and-drag. Camera *position* rests either at a fixed
 * `CAMERA_TARGETS` viewpoint (overview/table — no WASD, no free
 * translation, out of scope per the release boundaries) or, for reagent
 * cabinets, flies through a dedicated timed tween into a close inspection
 * view (see `CabinetPhase` in `useSceneInteractionStore`).
 *
 * One click on a cabinet now does the whole thing — lock camera, fly in,
 * open the cabinet, arrive at inspection view — replacing the old
 * click-to-zoom-then-click-to-open two-step. Mouse-look is disabled for the
 * whole focusing/inspecting/returning sequence so the player can't
 * accidentally orbit away mid-flight. It's also disabled outright while
 * resting at the table (see `handleMouseMove`'s `activeTargetId === "table"`
 * guard) — that viewpoint is a fixed inspection angle for the tabletop
 * interaction happening there, not something to look around from — though
 * the table's own zoom-in position lerp is untouched.
 */
export function CameraRig({ onResumeMouseLook }: { readonly onResumeMouseLook: () => void }) {
  const { camera: genericCamera, gl } = useThree();
  // Canvas is always constructed with a PerspectiveCamera (see Laboratory.tsx) — cast once so `.fov` is available for the inspection-zoom tween.
  const camera = genericCamera as THREE.PerspectiveCamera;
  const activeTargetId = useSceneInteractionStore((state) => state.activeTargetId);

  const yaw = useRef(CAMERA_TARGETS[activeTargetId].yaw);
  const pitch = useRef(CAMERA_TARGETS[activeTargetId].pitch);
  const hasSnapped = useRef(false);
  const targetPosition = useRef(new THREE.Vector3());

  /**
   * Heating mini-game lean-in. Applied as a pure offset off the SETTLED
   * inspection pose (the `cabinetPhase === "inspecting"` branch otherwise
   * holds the camera perfectly still), so it never competes with the tween
   * system or the room-phase damping — and the stand can sit anywhere,
   * since this dollies along the current view ray instead of flying to a
   * fixed `CAMERA_TARGETS` pose the movable stand could never have.
   */
  const heatBasePosition = useRef<THREE.Vector3 | null>(null);
  const heatForward = useRef(new THREE.Vector3());
  const heatBaseQuaternion = useRef(new THREE.Quaternion());
  const heatDolly = useRef(0);
  /** The table viewpoint's own pose, followed as usual while the camera may be leaning in to the stand (see `tableDolly`). */
  const roomBasePosition = useRef<THREE.Vector3 | null>(null);
  /** 0..1 lean-in from the table viewpoint to the stand's close-up. */
  const tableDolly = useRef(0);
  const closeUpPosition = useRef(new THREE.Vector3());
  const closeUpMatrix = useRef(new THREE.Matrix4());
  const closeUpQuaternion = useRef(new THREE.Quaternion());
  /** Always cast through the screen center (NDC 0,0) — the crosshair never moves, Pointer Lock moves the camera's own look direction instead. */
  const hoverRaycaster = useRef(new THREE.Raycaster());
  /**
   * Dev-menu mouse-drag state, set on a furniture pick in `handlePointerDown`
   * and cleared on `mouseup` — see the drag handling in `handleMouseMove`'s
   * dev-menu branch. Dragging moves the piece across a plane FACING THE
   * CAMERA (normal = camera forward, through the object's own position at
   * grab time) — NOT a horizontal floor/wall-height plane. A horizontal
   * plane is only stable to raycast against when the camera looks down at
   * a real angle; this camera sits roughly at cabinet height and looks
   * nearly level at them, so a ray toward a horizontal plane is nearly
   * parallel to it — a tiny mouse move then sweeps the intersection an
   * enormous, unstable distance (confirmed: a ~70px drag flung a cabinet
   * 80+ meters away). A camera-facing plane is, by construction, never
   * near-parallel to the view ray, so it stays stable at any look angle;
   * `planeOffset` preserves the exact grab point instead of snapping the
   * object's origin to the cursor.
   */
  const furnitureDragRef = useRef<{ id: FurnitureId; planeOffset: THREE.Vector3 } | null>(null);
  /**
   * Same pick-then-drag pattern as `furnitureDragRef`, for every
   * table-relative reagent prop — the two fixed ones (`workbench-stopper-
   * holder`, `workbench-reagent-area`, see `DRAGGABLE_REAGENT_IDS`) AND any
   * individual jar on the workbench (`useWorkbenchReagentDragStore`, a
   * dynamic per-instance set, hence the plain `write` callback here instead
   * of a closed id union like `furnitureDragRef`'s). Drags over a
   * HORIZONTAL plane at the object's own current world Y instead of a
   * camera-facing one: unlike the cabinet-height furniture case, the table
   * viewpoint (`CAMERA_TARGETS.table`) looks down at a real -22° pitch, so a
   * horizontal plane isn't near-parallel to the view ray here and stays
   * stable — and it's the natural constraint for "slide across the
   * tabletop" (X/Z only, Y never drifts), unlike furniture's own free 3D
   * camera-facing drag.
   */
  const tableDragRef = useRef<{
    write: (worldX: number, worldZ: number) => void;
    planeOffset: THREE.Vector3;
    /** Keeps the grabbed screen point locked to the cursor under perspective. */
    pointerNdcOffset?: THREE.Vector2;
    /** Present only for normal gameplay drags that may be dropped into the return zone. */
    returnInstanceId?: string;
    /** Exact pre-drag world position used for an imperative, guaranteed snap-back. */
    originWorldPosition?: THREE.Vector3;
  } | null>(null);
  /** True while the right mouse button is held down at the table — see `TABLE_PITCH_LOOK_RANGE`'s doc for why the table needs its own orbit input instead of the Pointer-Lock look every other viewpoint uses. */
  const tableOrbitDragging = useRef(false);
  /**
   * Set on drop when the player releases a jar onto another one (a swap):
   * the dragged jar first glides back to ITS OWN slot exactly like a normal
   * "dropped elsewhere" release (the ordinary `DraggableWorkbenchReagent`
   * grid-reflow glide plays, not the swap arc), and only once it visibly
   * settles there does the actual trade start — see the `useFrame` handling
   * below. Requested explicitly: starting the semicircular swap arc
   * straight from wherever the mouse let go (the old behavior) skipped that
   * settle and read as the two jars swapping mid-air instead of one
   * actually coming home first.
   */
  const pendingSwapRef = useRef<{
    draggedId: string;
    targetId: string;
    homeX: number;
    homeZ: number;
    waitedMs: number;
  } | null>(null);
  const dragPlane = useRef(new THREE.Plane());
  const dragPoint = useRef(new THREE.Vector3());
  const dragPlaneNormal = useRef(new THREE.Vector3());
  const suppressNextYawPitchReset = useRef(false);
  const scratchDirection = useRef(new THREE.Vector3());
  const scratchLookTarget = useRef(new THREE.Vector3());

  // Cabinet inspection tween state.
  const tweenElapsed = useRef(0);
  const tweenDuration = useRef(FOCUS_DURATION_MS);
  /**
   * Chain-arrow switch, first leg: the current cabinet's doors/panel/shutter
   * must finish closing (`TOTAL_DURATION_MS`, the same choreography
   * `useCabinetDoorAnimation` runs) before the camera starts moving toward
   * the neighbor at all. `null` means no switch is pending; a
   * `HotspotTargetId` means one is, waiting out `switchWaitElapsedMs`.
   */
  const switchWaitNextId = useRef<HotspotTargetId | null>(null);
  const switchWaitElapsedMs = useRef(0);
  /**
   * Chain-arrow switch, third leg: which cabinet's doors to open once the
   * camera tween below actually arrives — set when the second leg
   * (`beginSwitchTween`) starts that tween, consumed where `tweenElapsed`
   * reaches `tweenDuration`. `null` outside of a pending switch.
   */
  const switchArrivalOpenId = useRef<HotspotTargetId | null>(null);
  const tweenFromPosition = useRef(new THREE.Vector3());
  const tweenFromLookAt = useRef(new THREE.Vector3());
  const tweenToPosition = useRef(new THREE.Vector3());
  const tweenToLookAt = useRef(new THREE.Vector3());
  const tweenFromFov = useRef(55);
  const tweenToFov = useRef(55);
  /**
   * Orientation during a tween is interpolated as yaw/pitch angles derived
   * from `tweenFromLookAt`/`tweenToLookAt` (see `yawPitchFromDirection`
   * below), not by lerping those two points directly and calling
   * `camera.lookAt()` on the interpolated point each frame. That old
   * approach caused the "camera flips behind your back" bug on return:
   * lerping two look-AT points independently of the also-lerping camera
   * position can make the effective look-direction vector (interpolated
   * lookAt minus interpolated position) shrink toward zero length or flip
   * sign partway through, whenever the from/to configurations are far apart
   * (exactly the close-up-inspection-back-to-room-view case).
   *
   * A quaternion slerp between the two "upright" (roll-free) orientations
   * was tried next and also rejected: slerp takes the shortest path through
   * the full 3D rotation group, which for two orientations that each have
   * zero roll individually does *not* generally stay at zero roll for the
   * orientations in between — it introduced a visible tilt/wobble mid-tween
   * on ordinary transitions, not just the return case. This camera is an
   * FPS-style rig that only ever yaws and pitches (never rolls) everywhere
   * else in this file, so interpolating yaw and pitch directly as two
   * independent scalars — with proper shortest-path wraparound handling for
   * yaw (see `lerpAngle`) — is both simpler and correct: it can't flip
   * (there's no point-vs-position degeneracy, just two angles), and it
   * can't roll (an orientation built from pure yaw+pitch never has any).
   */
  const preFocusPosition = useRef(new THREE.Vector3());
  const preFocusYaw = useRef(0);
  const preFocusPitch = useRef(0);
  const roomFov = useRef(55);

  // Fume-hood staged-approach state — unused/null for every other cabinet.
  const fumeHoodStage = useRef<FumeHoodStage | null>(null);
  const fumeHoodStagingPosition = useRef(new THREE.Vector3());
  const fumeHoodStagingLookAt = useRef(new THREE.Vector3());
  const fumeHoodStagingFov = useRef(55);
  const fumeHoodFinalPosition = useRef(new THREE.Vector3());
  const fumeHoodFinalLookAt = useRef(new THREE.Vector3());
  const fumeHoodFinalFov = useRef(55);

  /**
   * Points the camera at the yaw/pitch interpolated between the "from" and
   * "to" position+lookAt pairs at fraction `t` — see the ref-block comment
   * above `tweenFromLookAt` for why this replaces both the old point-lerp
   * and the rejected quaternion-slerp approaches. Must be called *after*
   * `camera.position` has already been updated for this frame, since the
   * final look-at point is built from the *current* camera position plus
   * the interpolated direction.
   */
  function applyInterpolatedLook(
    fromPosition: THREE.Vector3,
    fromLookAt: THREE.Vector3,
    toPosition: THREE.Vector3,
    toLookAt: THREE.Vector3,
    t: number,
  ) {
    const fromAngles = yawPitchFromDirection(scratchDirection.current.copy(fromLookAt).sub(fromPosition).normalize());
    const toAngles = yawPitchFromDirection(scratchLookTarget.current.copy(toLookAt).sub(toPosition).normalize());
    const lerpedYaw = lerpAngle(fromAngles.yaw, toAngles.yaw, t);
    const lerpedPitch = THREE.MathUtils.lerp(fromAngles.pitch, toAngles.pitch, t);
    scratchDirection.current.set(
      Math.sin(lerpedYaw) * Math.cos(lerpedPitch),
      Math.sin(lerpedPitch),
      -Math.cos(lerpedYaw) * Math.cos(lerpedPitch),
    );
    scratchLookTarget.current.copy(camera.position).add(scratchDirection.current);
    camera.lookAt(scratchLookTarget.current);
  }

  function startFocusingFumeHood() {
    // Same pre-existing cast the generic path below uses for every other
    // cabinet — `getEffectiveInspectionTarget`'s declared param type is
    // narrower than `HotspotTargetId`, but it already handles fume-hood
    // correctly at runtime (verified in-browser for its F8 calibration and
    // its own click-to-focus, before this staged sequence existed).
    const target = getEffectiveInspectionTarget(FUME_HOOD_ID as Parameters<typeof getEffectiveInspectionTarget>[0]);
    // Its own independently calibratable pose (F8 panel, preset
    // "fume-hood-staging") — no longer derived inline from `target`, so a
    // dev can nudge exactly where the camera holds while the panel powers
    // on and the sash rises without touching the final pose at all.
    const staging = getEffectiveInspectionTarget("fume-hood-staging");

    roomFov.current = camera.fov;
    preFocusPosition.current.copy(camera.position);
    preFocusYaw.current = yaw.current;
    preFocusPitch.current = pitch.current;

    fumeHoodFinalPosition.current.set(...target.position);
    fumeHoodFinalLookAt.current.set(...target.lookAt);
    fumeHoodFinalFov.current = target.fov;

    fumeHoodStagingPosition.current.set(...staging.position);
    fumeHoodStagingLookAt.current.set(...staging.lookAt);
    fumeHoodStagingFov.current = staging.fov;

    tweenFromPosition.current.copy(camera.position);
    const dirX = Math.sin(yaw.current) * Math.cos(pitch.current);
    const dirY = Math.sin(pitch.current);
    const dirZ = -Math.cos(yaw.current) * Math.cos(pitch.current);
    tweenFromLookAt.current.set(camera.position.x + dirX, camera.position.y + dirY, camera.position.z + dirZ);
    tweenFromFov.current = camera.fov;

    tweenToPosition.current.copy(fumeHoodStagingPosition.current);
    tweenToLookAt.current.copy(fumeHoodStagingLookAt.current);
    tweenToFov.current = fumeHoodStagingFov.current;

    tweenElapsed.current = 0;
    tweenDuration.current = FUME_APPROACH_DURATION_MS;
    fumeHoodStage.current = "approach-in";

    // Both start OFF at the staging pose regardless of whatever a previous
    // visit left behind — the scripted power-on (light, then fan, then the
    // sash rises) only reads as an intro if it always starts from off.
    useFumeHoodControlsStore.getState().setLight(FUME_HOOD_ID, false);
    useFumeHoodControlsStore.getState().setFan(FUME_HOOD_ID, false);

    useSceneInteractionStore.getState().beginCabinetFocus(FUME_HOOD_ID);
  }

  function startReturningFumeHood() {
    tweenFromPosition.current.copy(camera.position);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    tweenFromLookAt.current.copy(camera.position).add(forward);
    tweenFromFov.current = camera.fov;

    tweenToPosition.current.copy(fumeHoodStagingPosition.current);
    tweenToLookAt.current.copy(fumeHoodStagingLookAt.current);
    tweenToFov.current = fumeHoodStagingFov.current;

    tweenElapsed.current = 0;
    tweenDuration.current = FUME_FINAL_DURATION_MS;
    fumeHoodStage.current = "approach-out";

    useSceneInteractionStore.getState().setCabinetPhase("returning");
  }

  /** Advances one leg of the fume-hood's multi-stage tween; returns once per frame, never falls through to the generic single-tween path. */
  function advanceFumeHoodStage(delta: number) {
    tweenElapsed.current += delta * 1000;
    const t = THREE.MathUtils.clamp(tweenElapsed.current / tweenDuration.current, 0, 1);
    const eased = easeInOutQuint(t);
    const stage = fumeHoodStage.current;

    // "light-on"/"fan-on"/"sash-in"/"sash-out"/"fan-off"/"light-off" all
    // hold the camera exactly where the previous leg left it — the
    // panel/sash animate on their own clocks (see `useFumeHoodControlPanel`
    // and `FumeHood.tsx`) while the camera simply waits at the staging pose.
    if (stage === "approach-in" || stage === "final-in" || stage === "approach-out" || stage === "final-out") {
      camera.position.lerpVectors(tweenFromPosition.current, tweenToPosition.current, eased);
      applyInterpolatedLook(
        tweenFromPosition.current,
        tweenFromLookAt.current,
        tweenToPosition.current,
        tweenToLookAt.current,
        eased,
      );
      const fov = THREE.MathUtils.lerp(tweenFromFov.current, tweenToFov.current, eased);
      if (camera.fov !== fov) {
        Object.assign(camera, { fov });
        camera.updateProjectionMatrix();
      }
    }

    if (t < 1) return;

    switch (stage) {
      case "approach-in":
        // Staging pose reached — plaque, sash and panel (still all-off) are
        // now in frame. Light first, then the fan, each held long enough to
        // actually register before the next thing happens.
        useFumeHoodControlsStore.getState().setLight(FUME_HOOD_ID, true);
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_LIGHT_TOGGLE_DURATION_MS;
        fumeHoodStage.current = "light-on";
        break;

      case "light-on":
        useFumeHoodControlsStore.getState().setFan(FUME_HOOD_ID, true);
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_FAN_TOGGLE_DURATION_MS;
        fumeHoodStage.current = "fan-on";
        break;

      case "fan-on":
        useSceneInteractionStore.getState().setSashStageOpen(true);
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_SASH_DURATION_MS;
        fumeHoodStage.current = "sash-in";
        break;

      case "sash-in":
        tweenFromPosition.current.copy(fumeHoodStagingPosition.current);
        tweenFromLookAt.current.copy(fumeHoodStagingLookAt.current);
        tweenFromFov.current = fumeHoodStagingFov.current;
        tweenToPosition.current.copy(fumeHoodFinalPosition.current);
        tweenToLookAt.current.copy(fumeHoodFinalLookAt.current);
        tweenToFov.current = fumeHoodFinalFov.current;
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_FINAL_DURATION_MS;
        fumeHoodStage.current = "final-in";
        break;

      case "final-in":
        camera.position.copy(fumeHoodFinalPosition.current);
        camera.lookAt(fumeHoodFinalLookAt.current);
        fumeHoodStage.current = null;
        useSceneInteractionStore.getState().setCabinetPhase("inspecting");
        if (document.pointerLockElement === gl.domElement) {
          document.exitPointerLock();
        }
        break;

      case "approach-out":
        useSceneInteractionStore.getState().setSashStageOpen(false);
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_SASH_DURATION_MS;
        fumeHoodStage.current = "sash-out";
        break;

      case "sash-out":
        // Sash is closed — power down in the exact reverse of the power-on
        // order (fan was turned on last, so it turns off first; light was
        // turned on first, so it turns off last).
        useFumeHoodControlsStore.getState().setFan(FUME_HOOD_ID, false);
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_FAN_TOGGLE_DURATION_MS;
        fumeHoodStage.current = "fan-off";
        break;

      case "fan-off":
        useFumeHoodControlsStore.getState().setLight(FUME_HOOD_ID, false);
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_LIGHT_TOGGLE_DURATION_MS;
        fumeHoodStage.current = "light-off";
        break;

      case "light-off": {
        tweenFromPosition.current.copy(fumeHoodStagingPosition.current);
        tweenFromLookAt.current.copy(fumeHoodStagingLookAt.current);
        tweenFromFov.current = fumeHoodStagingFov.current;
        tweenToPosition.current.copy(preFocusPosition.current);
        const dirX = Math.sin(preFocusYaw.current) * Math.cos(preFocusPitch.current);
        const dirY = Math.sin(preFocusPitch.current);
        const dirZ = -Math.cos(preFocusYaw.current) * Math.cos(preFocusPitch.current);
        tweenToLookAt.current.set(
          preFocusPosition.current.x + dirX,
          preFocusPosition.current.y + dirY,
          preFocusPosition.current.z + dirZ,
        );
        tweenToFov.current = roomFov.current;
        tweenElapsed.current = 0;
        tweenDuration.current = FUME_APPROACH_DURATION_MS;
        fumeHoodStage.current = "final-out";
        break;
      }

      case "final-out":
        camera.position.copy(tweenToPosition.current);
        camera.lookAt(tweenToLookAt.current);
        yaw.current = preFocusYaw.current;
        pitch.current = preFocusPitch.current;
        if (camera.fov !== roomFov.current) {
          Object.assign(camera, { fov: roomFov.current });
          camera.updateProjectionMatrix();
        }
        fumeHoodStage.current = null;
        suppressNextYawPitchReset.current = true;
        useSceneInteractionStore.getState().finishCabinetReturn();
        break;
    }
  }

  function startFocusing(cabinetId: HotspotTargetId) {
    if (!INSPECTION_TARGETS[cabinetId]) return;
    if (cabinetId === FUME_HOOD_ID) {
      startFocusingFumeHood();
      return;
    }
    const target = getEffectiveInspectionTarget(cabinetId as Exclude<HotspotTargetId, "table">);

    roomFov.current = camera.fov;
    preFocusPosition.current.copy(camera.position);
    preFocusYaw.current = yaw.current;
    preFocusPitch.current = pitch.current;

    tweenFromPosition.current.copy(camera.position);
    const dirX = Math.sin(yaw.current) * Math.cos(pitch.current);
    const dirY = Math.sin(pitch.current);
    const dirZ = -Math.cos(yaw.current) * Math.cos(pitch.current);
    tweenFromLookAt.current.set(camera.position.x + dirX, camera.position.y + dirY, camera.position.z + dirZ);
    tweenFromFov.current = camera.fov;

    tweenToPosition.current.set(...target.position);
    tweenToLookAt.current.set(...target.lookAt);
    tweenToFov.current = target.fov;

    tweenElapsed.current = 0;
    tweenDuration.current = FOCUS_DURATION_MS;

    useCabinetOpenStore.getState().setOpen(cabinetId, true);
    useSceneInteractionStore.getState().beginCabinetFocus(cabinetId);
  }

  /**
   * Chain-arrow navigation: flies directly from the currently inspected
   * cabinet to a chain neighbor (see `getChainNeighbors`), without detouring
   * through the room. Deliberately does not touch `preFocusPosition`/
   * `preFocusYaw`/`preFocusPitch`/`roomFov` — those still hold the room pose
   * from the original `startFocusing` call, so "return" after any number of
   * chain hops still flies back to that original room view, not to the
   * previously visited cabinet.
   *
   * Three strict stages, each waiting for the previous to actually finish:
   * (1) the current cabinet's doors close; only once that choreography ends
   * does (2) the camera fly to the neighbor (see `switchWaitNextId`,
   * `beginSwitchTween`); only once THAT tween arrives does (3) the
   * neighbor's own doors open (see `switchArrivalOpenId`, consumed where
   * `tweenElapsed` reaches `tweenDuration`). Nothing here overlaps — a
   * simultaneous version (camera+open-door starting the instant the close
   * began) was tried and reverted per an explicit request for this strict
   * close → fly → open order instead.
   */
  function startSwitchingCabinet(nextId: HotspotTargetId) {
    if (!INSPECTION_TARGETS[nextId]) return;
    const currentId = useSceneInteractionStore.getState().focusedCabinetId;
    if (currentId) useCabinetOpenStore.getState().setOpen(currentId, false);
    switchWaitNextId.current = nextId;
    switchWaitElapsedMs.current = 0;
  }

  /** Second leg of a chain-arrow switch — the camera tween, started once `startSwitchingCabinet`'s door-close wait (`switchWaitNextId`) has elapsed. Does NOT open the neighbor's doors yet — see `switchArrivalOpenId`. */
  function beginSwitchTween(nextId: HotspotTargetId) {
    const target = getEffectiveInspectionTarget(nextId as Exclude<HotspotTargetId, "table">);

    tweenFromPosition.current.copy(camera.position);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    tweenFromLookAt.current.copy(camera.position).add(forward);
    tweenFromFov.current = camera.fov;

    tweenToPosition.current.set(...target.position);
    tweenToLookAt.current.set(...target.lookAt);
    tweenToFov.current = target.fov;

    tweenElapsed.current = 0;
    tweenDuration.current = FOCUS_DURATION_MS;

    switchArrivalOpenId.current = nextId;
    useSceneInteractionStore.getState().beginCabinetFocus(nextId);
  }

  function startReturning() {
    const focusedId = useSceneInteractionStore.getState().focusedCabinetId;
    if (focusedId === FUME_HOOD_ID) {
      startReturningFumeHood();
      return;
    }
    if (focusedId) useCabinetOpenStore.getState().setOpen(focusedId, false);

    // The workbench hand-off is immediate: by the first frame of the return
    // flight, every taken item is already in its final table container. This
    // also avoids mounting a batch only after the door-close timer expires.
    useReagentStorageStore.getState().transferTrayToWorkbench();
    useTestTubeStorageStore.getState().transferTrayToWorkbench();
    useBunsenStandStorageStore.getState().transferToWorkbench();
    useBurnerStore.getState().transferToWorkbench();

    tweenFromPosition.current.copy(camera.position);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    tweenFromLookAt.current.copy(camera.position).add(forward);
    tweenFromFov.current = camera.fov;

    tweenToPosition.current.copy(preFocusPosition.current);
    const dirX = Math.sin(preFocusYaw.current) * Math.cos(preFocusPitch.current);
    const dirY = Math.sin(preFocusPitch.current);
    const dirZ = -Math.cos(preFocusYaw.current) * Math.cos(preFocusPitch.current);
    tweenToLookAt.current.set(
      preFocusPosition.current.x + dirX,
      preFocusPosition.current.y + dirY,
      preFocusPosition.current.z + dirZ,
    );
    tweenToFov.current = roomFov.current;

    tweenElapsed.current = 0;
    tweenDuration.current = RETURN_DURATION_MS;

    useSceneInteractionStore.getState().setCabinetPhase("returning");
  }

  // Whenever the resting viewpoint changes in room phase (overview <-> table),
  // start the look direction fresh from that viewpoint's base heading.
  // Guarded against firing during/after a cabinet focus — that path manages
  // yaw/pitch itself (see startFocusing/startReturning + the suppress flag).
  useEffect(() => {
    if (suppressNextYawPitchReset.current) {
      suppressNextYawPitchReset.current = false;
      return;
    }
    if (useSceneInteractionStore.getState().cabinetPhase !== "room") return;
    const target = resolveCameraTarget(activeTargetId);
    yaw.current = target.yaw;
    pitch.current = target.pitch;
  }, [activeTargetId]);

  // Arriving at the table releases Pointer Lock, same as a cabinet reaching
  // "inspecting" — the workbench view has no free-look of its own (see
  // `handleMouseMove`'s guard below) and needs a real, visible cursor for
  // whatever tabletop UI/interaction lives there, not a hidden FPS-style one.
  useEffect(() => {
    if (activeTargetId !== "table") return;
    if (document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }
  }, [activeTargetId, gl]);

  useEffect(() => {
    const element = gl.domElement;

    const startWorkbenchReagentDrag = (
      instanceId: string,
      clientX: number,
      clientY: number,
    ) => {
      const sceneState = useSceneInteractionStore.getState();
      // A returned jar can already be visible and reachable from the room
      // view before the player explicitly focuses the table. Permit the
      // interaction anywhere in room phase while the cursor is free; a
      // pointer-locked crosshair click must never start a tabletop drag.
      if (sceneState.cabinetPhase !== "room" || document.pointerLockElement === element) return;

      const object = useWorkbenchReagentDragStore.getState().objectsById[instanceId];
      if (!object) return;

      const rect = element.getBoundingClientRect();
      const pointerNdc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const currentVec = object.getWorldPosition(new THREE.Vector3());
      const liftedCurrentVec = currentVec.clone().add(new THREE.Vector3(0, 0.04, 0));
      const liftedNdc = liftedCurrentVec.clone().project(camera);
      const pointerNdcOffset = new THREE.Vector2(
        liftedNdc.x - pointerNdc.x,
        liftedNdc.y - pointerNdc.y,
      );

      dragPlane.current.setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 1, 0),
        liftedCurrentVec,
      );
      hoverRaycaster.current.setFromCamera(pointerNdc, camera);
      if (!hoverRaycaster.current.ray.intersectPlane(dragPlane.current, dragPoint.current)) return;

      tableDragRef.current = {
        write: (worldX, worldZ) => {
          const parent = object.parent;
          if (!parent) {
            object.position.x = worldX;
            object.position.z = worldZ;
          } else {
            const localTarget = new THREE.Vector3(worldX, liftedCurrentVec.y, worldZ);
            parent.worldToLocal(localTarget);
            object.position.x = localTarget.x;
            object.position.z = localTarget.z;
          }
          object.updateMatrixWorld(true);
        },
        planeOffset: new THREE.Vector3(),
        pointerNdcOffset,
        returnInstanceId: instanceId,
        originWorldPosition: currentVec.clone(),
      };
      useWorkbenchReagentDragStore.getState().beginDrag(instanceId);
      element.style.cursor = "grabbing";
    };

    // The jar's own R3F hitbox identifies the exact instance under the
    // pointer. This avoids a second camera raycast disagreeing with the
    // interactive surface the player actually clicked.
    const unsubscribeGrab = useWorkbenchReagentDragStore.subscribe((state, previous) => {
      const request = state.grabRequest;
      if (!request || request === previous.grabRequest) return;
      startWorkbenchReagentDrag(request.instanceId, request.clientX, request.clientY);
      state.clearGrabRequest();
    });

    const handlePointerDown = (event: MouseEvent) => {
      // Right-drag orbit at the table — checked before even the dev-menu
      // branch below, so a right-click always starts an orbit rather than
      // being mistaken for a furniture/reagent pick (that branch never
      // itself checks `event.button`). See `TABLE_PITCH_LOOK_RANGE`'s doc.
      if (
        event.button === 2 &&
        useSceneInteractionStore.getState().activeTargetId === "table" &&
        useSceneInteractionStore.getState().cabinetPhase === "room"
      ) {
        tableOrbitDragging.current = true;
        event.preventDefault();
        return;
      }
      // `pointerdown` on the jar's own hitbox has already initialized the
      // gameplay drag synchronously through `grabRequest`. Do not let the
      // later compatibility `mousedown` event replace it with a dev-menu
      // calibration drag when F8 happens to be open.
      if (event.button === 0 && tableDragRef.current?.returnInstanceId) {
        event.preventDefault();
        return;
      }
      if (useDevMenuStore.getState().isOpen) {
        // Dev-menu click-to-select: raycast from the actual mouse position
        // (not the gameplay crosshair's screen-center ray) against the two
        // small curated pick-target registries — furniture
        // (`useHotspotObjectsStore`, reused as-is from crosshair hover) and
        // reagent-related objects (`useReagentPickablesStore`). Room/walls
        // are never registered in either, so clicking them is a no-op —
        // matching "не трогай комнату". Always returns without touching
        // Pointer Lock or normal hotspot navigation while the menu is open.
        const rect = element.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        hoverRaycaster.current.setFromCamera(ndc, camera);

        let closestDistance = Infinity;
        let closestFurnitureId: HotspotTargetId | null = null;
        let closestReagentId: ReagentPickableId | null = null;
        let closestWorkbenchReagentInstanceId: string | null = null;

        for (const [id, object] of Object.entries(useHotspotObjectsStore.getState().objectsById)) {
          const hits = hoverRaycaster.current.intersectObject(object, true);
          if (hits.length > 0 && hits[0].distance < closestDistance) {
            closestDistance = hits[0].distance;
            closestFurnitureId = id as HotspotTargetId;
            closestReagentId = null;
            closestWorkbenchReagentInstanceId = null;
          }
        }
        for (const [id, object] of Object.entries(useReagentPickablesStore.getState().objectsById)) {
          const hits = hoverRaycaster.current.intersectObject(object, true);
          if (hits.length > 0 && hits[0].distance < closestDistance) {
            closestDistance = hits[0].distance;
            closestReagentId = id as ReagentPickableId;
            closestFurnitureId = null;
            closestWorkbenchReagentInstanceId = null;
          }
        }
        // Individual jars sitting on the workbench (see
        // `useWorkbenchReagentDragStore`'s doc) — a dynamic per-instance
        // pool, separate from the two fixed reagent pickables above.
        for (const [instanceId, pickTarget] of Object.entries(useWorkbenchReagentDragStore.getState().pickTargetsById)) {
          const hits = hoverRaycaster.current.intersectObject(pickTarget, false);
          if (hits.length > 0 && hits[0].distance < closestDistance) {
            closestDistance = hits[0].distance;
            closestWorkbenchReagentInstanceId = instanceId;
            closestReagentId = null;
            closestFurnitureId = null;
          }
        }

        if (closestFurnitureId) {
          useDevMenuStore.getState().selectFurniture(closestFurnitureId);
          // Start a drag right away — a plain click (no movement before
          // mouseup) just ends it with zero delta, so this doesn't fight
          // click-to-select; it's what lets the SAME mousedown both select
          // and immediately start moving the piece. Plane faces the camera
          // (see `furnitureDragRef`'s doc for why, not a horizontal one) and
          // passes through the object's CURRENT position, so the very first
          // dragged frame has zero jump.
          const current = useFurniturePositionStore.getState().getOverride(closestFurnitureId).position;
          const currentVec = new THREE.Vector3(...current);
          camera.getWorldDirection(dragPlaneNormal.current);
          dragPlane.current.setFromNormalAndCoplanarPoint(dragPlaneNormal.current, currentVec);
          if (hoverRaycaster.current.ray.intersectPlane(dragPlane.current, dragPoint.current)) {
            furnitureDragRef.current = {
              id: closestFurnitureId,
              planeOffset: currentVec.sub(dragPoint.current),
            };
          }
        } else if (closestReagentId) {
          useDevMenuStore.getState().setCategory(REAGENT_PICK_CATEGORY[closestReagentId]);
          // Same "select AND start a drag on the same mousedown" convention
          // as furniture (see its own comment above) — only for the two ids
          // that actually live on the table (`DRAGGABLE_REAGENT_IDS`); the
          // held tray and an inspected bottle aren't table props and keep
          // their existing select-only behavior. Horizontal plane at the
          // object's OWN current Y (not a camera-facing one) — see
          // `tableDragRef`'s doc for why that's stable and correct here.
          if (DRAGGABLE_REAGENT_IDS.has(closestReagentId)) {
            const draggableId = closestReagentId as DraggableReagentId;
            const currentVec = getReagentDragWorldPosition(draggableId);
            dragPlane.current.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), currentVec);
            if (hoverRaycaster.current.ray.intersectPlane(dragPlane.current, dragPoint.current)) {
              tableDragRef.current = {
                write: (worldX, worldZ) => setReagentDragWorldXZ(draggableId, worldX, worldZ),
                planeOffset: currentVec.clone().sub(dragPoint.current),
              };
            }
          }
        } else if (closestWorkbenchReagentInstanceId) {
          const instanceId = closestWorkbenchReagentInstanceId;
          useDevMenuStore.getState().setCategory("reagent-area");
          const object = useWorkbenchReagentDragStore.getState().objectsById[instanceId];
          const currentVec = new THREE.Vector3();
          object?.getWorldPosition(currentVec);
          dragPlane.current.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), currentVec);
          if (hoverRaycaster.current.ray.intersectPlane(dragPlane.current, dragPoint.current)) {
            tableDragRef.current = {
              write: (worldX, worldZ) => setWorkbenchReagentWorldXZ(instanceId, worldX, worldZ),
              planeOffset: currentVec.clone().sub(dragPoint.current),
            };
          }
        }
        return;
      }
      const state = useSceneInteractionStore.getState();
      // Outside "room" phase the player has a free cursor for real UI
      // interaction (the cabinet inspection screen's own R3F pointer
      // events, handled separately) — re-locking on any click here would
      // immediately hide/recapture that cursor the instant they clicked a
      // touch zone, so this whole handler (including the lock-request
      // itself) is room-phase only.
      if (state.cabinetPhase !== "room") return;
      // The table view keeps the player in "room" phase (unlike cabinets,
      // it has no focusing/inspecting/returning sequence of its own) but
      // still wants the same free, real cursor a cabinet's inspection
      // screen gets — the pointer-lock effect below already releases the
      // lock on arrival, so a click here must not immediately recapture it.
      if (state.activeTargetId === "table") return;

      if (document.pointerLockElement !== element) {
        element.requestPointerLock();
        return;
      }

      if (state.activeTargetId !== "overview") return;

      const hoveredId = state.hoveredTargetId;
      if (!hoveredId) return;

      const hotspot = HOTSPOTS.find((candidate) => candidate.id === hoveredId);
      if (!hotspot) return;

      if (OPENABLE_CABINET_IDS.has(hoveredId)) {
        startFocusing(hoveredId);
        return;
      }

      const hotspotTarget = resolveCameraTarget(hotspot.id);
      yaw.current = hotspotTarget.yaw;
      pitch.current = hotspotTarget.pitch;
      useLaboratoryStore.getState().setCameraView(hotspot.zone);
      useSceneInteractionStore.getState().setActiveTarget(hotspot.id);
    };

    let pendingTableDragPointer: { clientX: number; clientY: number } | null = null;
    let tableDragFrame: number | null = null;

    const updateTableDrag = (clientX: number, clientY: number) => {
      const activeTableDrag = tableDragRef.current;
      if (!activeTableDrag) return;
      const rect = element.getBoundingClientRect();
      const pointerNdc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const dragNdc = pointerNdc.clone();
      if (activeTableDrag.pointerNdcOffset) {
        dragNdc.add(activeTableDrag.pointerNdcOffset);
      }
      hoverRaycaster.current.setFromCamera(dragNdc, camera);
      if (!hoverRaycaster.current.ray.intersectPlane(dragPlane.current, dragPoint.current)) return;
      let worldX = dragPoint.current.x + activeTableDrag.planeOffset.x;
      let worldZ = dragPoint.current.z + activeTableDrag.planeOffset.z;
      if (activeTableDrag.returnInstanceId) {
        [worldX, worldZ] = clampWorkbenchDragWorldXZ(worldX, worldZ);
      }
      activeTableDrag.write(worldX, worldZ);
      if (!activeTableDrag.returnInstanceId) return;

      const dragStore = useWorkbenchReagentDragStore.getState();
      const isOverReturnZone = isInsideTrayReturnZone(worldX, worldZ);
      dragStore.setOverReturnZone(isOverReturnZone);

      // Pick a second workbench jar under the real cursor (not the
      // screen-offset drag ray). Only the dedicated hitboxes are tested;
      // visual bottle hierarchies are never traversed here.
      let swapTargetInstanceId: string | null = null;
      if (!isOverReturnZone) {
        hoverRaycaster.current.setFromCamera(pointerNdc, camera);
        let closestDistance = Infinity;
        for (const [instanceId, pickTarget] of Object.entries(dragStore.pickTargetsById)) {
          if (instanceId === activeTableDrag.returnInstanceId) continue;
          const hit = hoverRaycaster.current.intersectObject(pickTarget, false)[0];
          if (hit && hit.distance < closestDistance) {
            closestDistance = hit.distance;
            swapTargetInstanceId = instanceId;
          }
        }
      }
      dragStore.setSwapTarget(swapTargetInstanceId);
    };

    const scheduleTableDrag = (clientX: number, clientY: number) => {
      pendingTableDragPointer = { clientX, clientY };
      if (tableDragFrame !== null) return;
      // High-polling-rate mice can dispatch hundreds of events between two
      // renders. Coalesce them so transforms, zone checks and swap raycasts
      // run at most once per animation frame, using the newest coordinates.
      tableDragFrame = requestAnimationFrame(() => {
        tableDragFrame = null;
        const pointer = pendingTableDragPointer;
        pendingTableDragPointer = null;
        if (pointer) updateTableDrag(pointer.clientX, pointer.clientY);
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (tableOrbitDragging.current) {
        // No Pointer Lock at the table (see the `exitPointerLock` effect
        // above), but a plain `mousemove` still reports `movementX/Y` as a
        // relative delta since the last event, same as the pointer-locked
        // look below — so this reuses the same sensitivity constants and
        // per-target cone math, just clamped to `TABLE_PITCH_LOOK_RANGE`
        // instead of the full `MAX_LOOK_PITCH` (see that constant's doc).
        const target = resolveCameraTarget("table");
        yaw.current = THREE.MathUtils.clamp(
          yaw.current + event.movementX * YAW_SENSITIVITY,
          target.yaw - MAX_LOOK_YAW,
          target.yaw + MAX_LOOK_YAW,
        );
        pitch.current = THREE.MathUtils.clamp(
          pitch.current - event.movementY * PITCH_SENSITIVITY,
          target.pitch - TABLE_PITCH_LOOK_RANGE,
          target.pitch + TABLE_PITCH_LOOK_RANGE,
        );
        return;
      }
      // Table-prop drags use an absolute cursor ray and a horizontal plane
      // in both gameplay and dev calibration. Gameplay additionally tracks
      // whether the jar center has entered the tray-aligned return volume.
      if (tableDragRef.current) {
        scheduleTableDrag(event.clientX, event.clientY);
        return;
      }
      if (useDevMenuStore.getState().isOpen) {
        // Dev-menu furniture drag — real cursor, no Pointer Lock (see the
        // guard above this whole branch), so unlike the FPS look-around
        // below this reads absolute mouse position each move, not
        // `movementX/Y` deltas. No-op unless `handlePointerDown` actually
        // started a drag (a plain click-to-select with no movement never
        // touches this).
        const drag = furnitureDragRef.current;
        if (!drag) return;
        const rect = element.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        hoverRaycaster.current.setFromCamera(ndc, camera);
        if (!hoverRaycaster.current.ray.intersectPlane(dragPlane.current, dragPoint.current)) return;
        useFurniturePositionStore.getState().setPosition(drag.id, [
          dragPoint.current.x + drag.planeOffset.x,
          dragPoint.current.y + drag.planeOffset.y,
          dragPoint.current.z + drag.planeOffset.z,
        ]);
        return;
      }
      if (document.pointerLockElement !== element) return;
      const state = useSceneInteractionStore.getState();
      if (state.cabinetPhase !== "room") return;
      // The workbench view is a fixed inspection angle for whatever
      // tabletop interaction is happening there, not a hotspot to look
      // around from — mouse-look is disabled entirely while it's active,
      // unlike every other room-phase viewpoint (overview, cabinets), which
      // still allow free look within their own 270° cone. (The table gets
      // its own separate, right-drag-based orbit instead — see
      // `handleTableOrbitMove`/`TABLE_PITCH_LOOK_RANGE` — since it never
      // holds Pointer Lock in the first place; see the `exitPointerLock`
      // effect above.)
      if (state.activeTargetId === "table") return;

      // Clamped to the current resting viewpoint's own base heading, not a
      // fixed world direction — each `CAMERA_TARGETS` entry (overview,
      // table, every hotspot) has its own `yaw`, and the 270° turning cone
      // follows whichever one is active.
      const baseYaw = resolveCameraTarget(state.activeTargetId).yaw;
      yaw.current = THREE.MathUtils.clamp(
        yaw.current + event.movementX * YAW_SENSITIVITY,
        baseYaw - MAX_LOOK_YAW,
        baseYaw + MAX_LOOK_YAW,
      );
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - event.movementY * PITCH_SENSITIVITY,
        -MAX_LOOK_PITCH,
        MAX_LOOK_PITCH,
      );
    };

    const handleLockChange = () => {
      const locked = document.pointerLockElement === element;
      useSceneInteractionStore.getState().setPointerLocked(locked);
      if (!locked) {
        useSceneInteractionStore.getState().setHoveredTarget(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc with something in the hand puts it back, nothing more (VL-015).
      if (escapeTakenByHand()) return;
      // The tablet owns all input while it covers the scene. Escape must not
      // return/lock the cabinet behind an open tablet.
      if (useLaboratoryStore.getState().tabletOpen) return;
      // A reagent being inspected owns Escape exclusively (it's equivalent
      // to clicking ОСТАВИТЬ — see `ReagentInspectionOverlay`) — without this
      // guard, the SAME keypress would also fly the camera back out of the
      // whole cabinet, when the player only meant to put the bottle down.
      if (useReagentInspectionStore.getState().inspectedId) return;
      const state = useSceneInteractionStore.getState();
      if (state.cabinetPhase === "focusing" || state.cabinetPhase === "inspecting") {
        event.preventDefault();
        // Escape is itself a user activation, so reclaim Pointer Lock while
        // the browser still allows it. The return flight can then finish with
        // mouse-look already active instead of requiring a follow-up click.
        onResumeMouseLook();
        startReturning();
      }
    };

    // On `document`, not `element` — the drag should still end cleanly even
    // if the mouse leaves the canvas (or the button is released over the
    // dev-menu panel itself) before releasing.
    const handlePointerUp = () => {
      if (tableDragFrame !== null) {
        cancelAnimationFrame(tableDragFrame);
        tableDragFrame = null;
      }
      const finalPointer = pendingTableDragPointer;
      pendingTableDragPointer = null;
      if (finalPointer) updateTableDrag(finalPointer.clientX, finalPointer.clientY);

      const tableDrag = tableDragRef.current;
      if (tableDrag?.returnInstanceId) {
        const dragState = useWorkbenchReagentDragStore.getState();
        if (dragState.isOverReturnZone) {
          dragState.reset(tableDrag.returnInstanceId);
          useReagentStorageStore.getState().returnWorkbenchReagent(tableDrag.returnInstanceId);
        } else if (dragState.swapTargetInstanceId) {
          // The trade itself waits — see `pendingSwapRef`'s doc and the
          // `useFrame` handling below. For now the dragged jar just glides
          // home exactly like a normal "dropped elsewhere" release (the
          // `else` branch below): no `write()` snap, so `Laboratory.tsx`'s
          // ordinary grid-reflow glide carries it there visibly, since this
          // reagent's own slot hasn't changed yet (the store swap is still
          // pending on that glide settling).
          const draggedId = tableDrag.returnInstanceId;
          const targetId = dragState.swapTargetInstanceId;
          const origin = tableDrag.originWorldPosition;
          if (origin) {
            const tablePosition = useFurniturePositionStore.getState().getOverride("table").position;
            pendingSwapRef.current = {
              draggedId,
              targetId,
              homeX: origin.x - tablePosition[0],
              homeZ: origin.z - tablePosition[2],
              waitedMs: 0,
            };
          }
          dragState.reset(draggedId);
        } else {
          const origin = tableDrag.originWorldPosition;
          if (origin) tableDrag.write(origin.x, origin.z);
          // A workbench drag is a choice, not free placement: releasing
          // anywhere except the tray return zone snaps the jar back to its
          // own computed slot and clears the temporary persisted override.
          dragState.reset(tableDrag.returnInstanceId);
        }
        dragState.endDrag();
        element.style.cursor = "";
      }
      furnitureDragRef.current = null;
      tableDragRef.current = null;
      tableOrbitDragging.current = false;
    };

    // Without this, releasing the right button at the table would pop the
    // browser's own context menu on top of the canvas.
    const handleContextMenu = (event: MouseEvent) => {
      if (useSceneInteractionStore.getState().activeTargetId === "table") {
        event.preventDefault();
      }
    };

    element.addEventListener("mousedown", handlePointerDown);
    element.addEventListener("mousemove", handleMouseMove);
    element.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mouseup", handlePointerUp);
    document.addEventListener("pointerlockchange", handleLockChange);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      element.removeEventListener("mousedown", handlePointerDown);
      element.removeEventListener("mousemove", handleMouseMove);
      element.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mouseup", handlePointerUp);
      document.removeEventListener("pointerlockchange", handleLockChange);
      document.removeEventListener("keydown", handleKeyDown);
      if (tableDragFrame !== null) cancelAnimationFrame(tableDragFrame);
      tableDragFrame = null;
      pendingTableDragPointer = null;
      unsubscribeGrab();
      useWorkbenchReagentDragStore.getState().endDrag();
      useWorkbenchReagentDragStore.getState().clearGrabRequest();
      element.style.cursor = "";
      if (document.pointerLockElement === element) {
        document.exitPointerLock();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useFrame((_, delta) => {
    const calibration = useCameraCalibrationStore.getState();
    if (calibration.isOpen) {
      // Dev calibration preview: drive the camera directly from the panel's live draft,
      // bypassing the normal room/focus/return flow entirely while the panel is open.
      const pose = calibration.drafts[calibration.presetId];
      camera.position.set(...pose.position);
      camera.lookAt(...pose.target);
      // Clamped only here, at the point the FOV actually reaches the
      // three.js camera — the panel's own field shows exactly what was
      // typed, even transiently outside [MIN_FOV, MAX_FOV].
      const clampedFov = THREE.MathUtils.clamp(pose.fov, MIN_FOV, MAX_FOV);
      if (camera.fov !== clampedFov) {
        Object.assign(camera, { fov: clampedFov });
        camera.updateProjectionMatrix();
      }
      return;
    }

    // A jar dropped onto another one first glides home to its own slot
    // (started in `handlePointerUp`, see `pendingSwapRef`'s doc); once it's
    // actually there — or after `SWAP_SETTLE_MAX_WAIT_MS` regardless — kick
    // off the real trade for both jars.
    const pendingSwap = pendingSwapRef.current;
    if (pendingSwap) {
      const dragState = useWorkbenchReagentDragStore.getState();
      const draggedObject = dragState.objectsById[pendingSwap.draggedId];
      const targetObject = dragState.objectsById[pendingSwap.targetId];
      pendingSwap.waitedMs += delta * 1000;
      if (!draggedObject || !targetObject) {
        // One of the two left the table entirely while waiting (e.g. sent
        // back to the shelf some other way) — nothing left to swap.
        pendingSwapRef.current = null;
      } else {
        const tablePosition = useFurniturePositionStore.getState().getOverride("table").position;
        const dx = draggedObject.position.x - (tablePosition[0] + pendingSwap.homeX);
        const dz = draggedObject.position.z - (tablePosition[2] + pendingSwap.homeZ);
        const settled = dx * dx + dz * dz <= SWAP_SETTLE_EPSILON_SQ;
        if (settled || pendingSwap.waitedMs >= SWAP_SETTLE_MAX_WAIT_MS) {
          pendingSwapRef.current = null;
          const targetWorld = targetObject.getWorldPosition(new THREE.Vector3());
          const swapX = targetWorld.x - tablePosition[0];
          const swapZ = targetWorld.z - tablePosition[2];
          dragState.beginSwap([
            {
              instanceId: pendingSwap.draggedId,
              spec: {
                fromX: pendingSwap.homeX,
                fromZ: pendingSwap.homeZ,
                toX: swapX,
                toZ: swapZ,
                reverseSpin: false,
              },
            },
            {
              instanceId: pendingSwap.targetId,
              spec: {
                fromX: swapX,
                fromZ: swapZ,
                toX: pendingSwap.homeX,
                toZ: pendingSwap.homeZ,
                reverseSpin: true,
              },
            },
          ]);
          dragState.reset(pendingSwap.targetId);
          useReagentStorageStore.getState().swapWorkbenchReagents(pendingSwap.draggedId, pendingSwap.targetId);
        }
      }
    }

    const state = useSceneInteractionStore.getState();

    if (state.returnRequested && state.trayReturnReady && (state.cabinetPhase === "focusing" || state.cabinetPhase === "inspecting")) {
      // A return preempts a pending chain-switch wait (doors already told to
      // close either way — `startReturning` closes the focused cabinet on
      // its own).
      switchWaitNextId.current = null;
      switchArrivalOpenId.current = null;
      state.clearReturnRequest();
      startReturning();
    }

    // Only from the room — a focus request while already flying or settled
    // somewhere would fight the tween that owns the camera right now.
    if (state.focusRequestedId && state.cabinetPhase === "room") {
      const requestedId = state.focusRequestedId;
      state.clearFocusRequest();
      if (requestedId === FUME_HOOD_ID) {
        startFocusingFumeHood();
      } else if (requestedId !== "table") {
        startFocusing(requestedId);
      }
      return;
    }

    if (state.switchRequestedId && state.cabinetPhase === "inspecting") {
      const nextId = state.switchRequestedId;
      state.clearSwitchRequest();
      if (switchWaitNextId.current && switchWaitNextId.current !== nextId) {
        // Redirected to a different neighbor before its own close-wait even
        // finished — nothing was opened for it yet, so there's nothing to
        // close back down here (contrast `switchArrivalOpenId` below, which
        // DID already open something).
        switchWaitNextId.current = null;
      }
      if (switchArrivalOpenId.current && switchArrivalOpenId.current !== nextId) {
        // Redirected mid-flight, after the previous target's doors had
        // already opened on arrival — close that abandoned target back down.
        useCabinetOpenStore.getState().setOpen(switchArrivalOpenId.current, false);
        switchArrivalOpenId.current = null;
      }
      startSwitchingCabinet(nextId);
    }

    // First leg of a chain switch: wait out the current cabinet's own
    // door-close choreography before moving the camera — see
    // `startSwitchingCabinet`'s doc.
    if (switchWaitNextId.current !== null) {
      switchWaitElapsedMs.current += delta * 1000;
      if (switchWaitElapsedMs.current >= CABINET_DOOR_CLOSE_DURATION_MS) {
        const nextId = switchWaitNextId.current;
        switchWaitNextId.current = null;
        beginSwitchTween(nextId);
      }
    }

    if (state.cabinetPhase === "focusing" || state.cabinetPhase === "returning") {
      if (fumeHoodStage.current) {
        advanceFumeHoodStage(delta);
        return;
      }

      tweenElapsed.current += delta * 1000;
      const t = THREE.MathUtils.clamp(tweenElapsed.current / tweenDuration.current, 0, 1);
      const eased = easeInOutQuint(t);

      camera.position.lerpVectors(tweenFromPosition.current, tweenToPosition.current, eased);
      applyInterpolatedLook(
        tweenFromPosition.current,
        tweenFromLookAt.current,
        tweenToPosition.current,
        tweenToLookAt.current,
        eased,
      );

      const fov = THREE.MathUtils.lerp(tweenFromFov.current, tweenToFov.current, eased);
      if (camera.fov !== fov) {
        Object.assign(camera, { fov });
        camera.updateProjectionMatrix();
      }

      if (t >= 1) {
        if (state.cabinetPhase === "focusing") {
          // Third leg of a chain switch (see `startSwitchingCabinet`'s doc):
          // the neighbor's doors open only now, on arrival — a no-op for a
          // fresh `startFocusing` from the room, which already opened its
          // door itself and never sets this.
          if (switchArrivalOpenId.current) {
            useCabinetOpenStore.getState().setOpen(switchArrivalOpenId.current, true);
            switchArrivalOpenId.current = null;
          }
          state.setCabinetPhase("inspecting");
          // The cabinet inspection screen is a real touch-style UI (R3F
          // pointer events + raycast UV, not the crosshair/pointer-lock
          // convention room-phase uses) — it needs an actual free-moving
          // cursor to hover/click, which Pointer Lock's frozen
          // clientX/clientY would make impossible.
          if (document.pointerLockElement === gl.domElement) {
            document.exitPointerLock();
          }
        } else {
          camera.position.copy(tweenToPosition.current);
          camera.lookAt(tweenToLookAt.current);
          yaw.current = preFocusYaw.current;
          pitch.current = preFocusPitch.current;
          if (camera.fov !== roomFov.current) {
            Object.assign(camera, { fov: roomFov.current });
            camera.updateProjectionMatrix();
          }
          suppressNextYawPitchReset.current = true;
          state.finishCabinetReturn();
        }
      }
      return;
    }

    if (state.cabinetPhase === "inspecting") {
      // Settled — hold position/orientation exactly, apart from the tube
      // close-up (heating, or the player looking at the tube), which blends
      // off this held pose and back onto it.
      const closeUp = useHeatingStore.getState().active || useTubeCloseUpStore.getState().viewing;
      if (closeUp && !heatBasePosition.current) {
        heatBasePosition.current = camera.position.clone();
        heatBaseQuaternion.current.copy(camera.quaternion);
        camera.getWorldDirection(heatForward.current);
      }
      if (heatBasePosition.current) {
        heatDolly.current = THREE.MathUtils.damp(heatDolly.current, closeUp ? 1 : 0, HEAT_DOLLY_DAMPING, delta);
        const base = heatBasePosition.current;
        if (TUBE_FOCUS.valid) {
          // Approach the tube along the line it is seen on, and turn to
          // face it — the stand is off-centre in the hood, so a straight
          // dolly along the view ray would leave it at the screen's edge.
          closeUpPosition.current
            .subVectors(base, TUBE_FOCUS.point)
            .normalize()
            .multiplyScalar(TUBE_CLOSE_UP_DISTANCE)
            .add(TUBE_FOCUS.point);
          closeUpMatrix.current.lookAt(closeUpPosition.current, TUBE_FOCUS.point, camera.up);
          closeUpQuaternion.current.setFromRotationMatrix(closeUpMatrix.current);
          camera.position.lerpVectors(base, closeUpPosition.current, heatDolly.current);
          camera.quaternion.slerpQuaternions(heatBaseQuaternion.current, closeUpQuaternion.current, heatDolly.current);
        } else {
          camera.position.copy(base).addScaledVector(heatForward.current, HEAT_DOLLY_DISTANCE * heatDolly.current);
        }
        if (!closeUp && heatDolly.current < 0.001) {
          camera.position.copy(base);
          camera.quaternion.copy(heatBaseQuaternion.current);
          heatBasePosition.current = null;
          heatDolly.current = 0;
        }
      }
      return;
    }

    // Left the inspection pose entirely (Esc, back button, chain switch) —
    // the lean-in has no base to return to any more, so drop the mini-game
    // rather than leaving the crank owning controls off-screen.
    if (heatBasePosition.current) {
      heatBasePosition.current = null;
      heatDolly.current = 0;
      if (useHeatingStore.getState().active) useHeatingStore.getState().exit();
    }
    // The stand on the table has the same close-up as the one in the hood:
    // only leaving the table ends it.
    const atTable = activeTargetId === "table";
    if (!atTable) {
      if (useTubeCloseUpStore.getState().viewing) useTubeCloseUpStore.getState().setViewing(false);
      if (useHeatingStore.getState().active) useHeatingStore.getState().exit();
    }

    // cabinetPhase === "room": normal free-look at a fixed CAMERA_TARGETS viewpoint.
    const target = resolveCameraTarget(activeTargetId);
    const [targetX, targetY, targetZ] = target.position;

    // Follow the viewpoint on a base pose of its own, so a lean-in to the
    // stand never feeds back into it.
    const base = (roomBasePosition.current ??= camera.position.clone());
    // Not leaning in: the base IS the camera (flights elsewhere move it).
    if (tableDolly.current <= 0.001) base.copy(camera.position);
    if (!hasSnapped.current) {
      base.set(targetX, targetY, targetZ);
      hasSnapped.current = true;
    } else {
      const positionLerp = 1 - Math.exp(-delta / POSITION_DAMPING);
      targetPosition.current.set(targetX, targetY, targetZ);
      base.lerp(targetPosition.current, positionLerp);
    }
    camera.position.copy(base);

    const directionX = Math.sin(yaw.current) * Math.cos(pitch.current);
    const directionY = Math.sin(pitch.current);
    const directionZ = -Math.cos(yaw.current) * Math.cos(pitch.current);

    camera.lookAt(
      camera.position.x + directionX,
      camera.position.y + directionY,
      camera.position.z + directionZ,
    );

    const standCloseUp =
      atTable && (useHeatingStore.getState().active || useTubeCloseUpStore.getState().viewing);
    tableDolly.current = THREE.MathUtils.damp(tableDolly.current, standCloseUp ? 1 : 0, HEAT_DOLLY_DAMPING, delta);
    if (tableDolly.current > 0.001 && TUBE_FOCUS.valid) {
      closeUpPosition.current
        .subVectors(base, TUBE_FOCUS.point)
        .normalize()
        .multiplyScalar(TUBE_CLOSE_UP_DISTANCE)
        .add(TUBE_FOCUS.point);
      closeUpMatrix.current.lookAt(closeUpPosition.current, TUBE_FOCUS.point, camera.up);
      closeUpQuaternion.current.setFromRotationMatrix(closeUpMatrix.current);
      camera.position.lerpVectors(base, closeUpPosition.current, tableDolly.current);
      camera.quaternion.slerp(closeUpQuaternion.current, tableDolly.current);
    }

    if (activeTargetId === "overview" && state.isPointerLocked) {
      // Real geometry raycast, not a distance-to-anchor-point heuristic —
      // any part of a hotspot's actual mesh under the (always-centered)
      // crosshair counts, not just a small radius around one fixed point.
      // Only ever tests the handful of objects each interactive component
      // registers on mount (`useHotspotObjectsStore`), never the room/walls,
      // so this stays cheap regardless of overall scene complexity.
      hoverRaycaster.current.setFromCamera(SCREEN_CENTER_NDC, camera);
      const objectsById = useHotspotObjectsStore.getState().objectsById;

      let closestId: HotspotTargetId | null = null;
      let closestDistance = Infinity;
      for (const [id, object] of Object.entries(objectsById)) {
        const hits = hoverRaycaster.current.intersectObject(object, true);
        if (hits.length > 0 && hits[0].distance < closestDistance) {
          closestDistance = hits[0].distance;
          closestId = id as HotspotTargetId;
        }
      }

      if (state.hoveredTargetId !== closestId) {
        state.setHoveredTarget(closestId);
      }
    }
  });

  return null;
}
