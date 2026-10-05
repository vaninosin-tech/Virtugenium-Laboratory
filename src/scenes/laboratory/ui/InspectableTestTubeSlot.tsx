import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { clampToTableWorldXZ } from "../lib/layout";
import { fillTestTubeContents, resolveTubeContents, stepCopperGranuleDrop } from "../lib/testTubeContents";
import { prepareTestTube } from "../lib/testTubeMaterials";
import { pushOutsideTrayReturnZone } from "../lib/trayReturnZone";
import {
  TUBE_RING_ATTACH_RADIUS,
  tableRingOffsetXZ,
  useBunsenStandStorageStore,
} from "../lib/useBunsenStandStorageStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { clickWorkbenchRackTube } from "../lib/standTableActions";
import { useStandHintStore } from "../lib/useStandHintStore";
import { useStandMotionStore } from "../lib/useStandMotionStore";
import { useHandStore } from "../lib/useHandStore";
import { overTableTray, WORKBENCH_CARRY } from "../lib/tableTray";
import { tubeToTray } from "../lib/trayCarry";
import { ArrivalFlight } from "./StandMotion";
import { consumePickablePressed, sharedMouseNdc, useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { useTestTubeHoverStore } from "../lib/useTestTubeHoverStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { disableRaycast } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { constrainOnWorktop } from "../lib/worktopBounds";

const MODEL_PATH = "/assets/models/LabTestTube.glb";

/** How far a hovered tube lifts out of its collar вЂ” small, just enough to read as "picked out" without looking like it launched. */
const HOVER_RAISE = 0.012;
/** Damping rate for the raise/settle вЂ” snappier than the rack's own slow travel damping since this is a tiny, frequent hover cue. */
const RAISE_DAMPING = 14;
/** Local scale for an empty hole вЂ” same "shrink instead of unmount" convention `WorkbenchTestTubeDisplayArea` used to use, now owned here per-slot. */
const EMPTY_SLOT_SCALE = 0.0001;
/**
 * Half-width/half-depth of the invisible hover/click hitbox, in the SAME
 * local units as the rack's own hole grid (0.034 between columns, 0.042
 * between rows вЂ” see `useTestTubeStorageStore`'s `TUBE_SLOT_X_OFFSETS`/
 * `TUBE_SLOT_ROW_Z_OFFSETS`). The tube's own glass is much thinner than
 * that, which is exactly why clicking it read as unreliable/unintuitive вЂ”
 * these numbers are picked to noticeably widen the target while still
 * leaving a small gap to the neighboring tube's own hitbox, so adjacent
 * tubes never fight over a hover.
 */
const HITBOX_HALF_WIDTH = 0.014;
const HITBOX_HALF_DEPTH = 0.018;
/** Damping rate for tracking the cursor вЂ” snappy, but not an instant snap (avoids a jarring pop on the very first frame after pick-up). */
const DRAG_DAMPING = 18;
/** How far above its own resting height the tube climbs before heading back over its slot вЂ” clears the rack's side rail/neighboring tubes instead of dragging straight through them on the way back in. */
const RETURN_APPROACH_HEIGHT = 0.05;
/** Damping rate for both return legs вЂ” slower than `DRAG_DAMPING` since this is a settle, not a live cursor-follow. */
const RETURN_DAMPING = 9;
/** "Close enough" to a return waypoint to advance to the next leg / call the return fully finished. */
const RETURN_EPSILON = 0.004;
/** How close (horizontal distance, in the rack's own local units) a held tube needs to be to the rack's origin to count as "near it" for the drop-target highlight вЂ” see `useTestTubeDragStore`'s `isNearHolder` doc for why this is a live distance check instead of a hover event. Comfortably past the hole grid's own half-width (0.119) so the highlight comes on a bit before the tube is literally back at a slot. */
const NEAR_HOLDER_RADIUS = 0.2;
/**
 * Local Y (in the rack's own frame, which is calibrated so Y=0 there IS the
 * true tabletop height) the tube slides at while being dragged loose on the
 * table вЂ” NOT `localPosition[1]` (`TUBE_BASE_Y`, +0.014), which is where it
 * stands INSIDE the rack's raised insert collar. Using the collar height for
 * open-table dragging left the tube visibly floating ~14mm above the bare
 * countertop instead of sitting flush on it.
 */
const TABLE_SURFACE_LOCAL_Y = 0;
/**
 * How far (world X/Z) a held tube can be dragged from the rack's OWN
 * position вЂ” NOT the whole countertop (`clampToTableWorldXZ`'s full
 * `TABLE.width`/`TABLE.depth`, ~2.8Г—1.3m). Sized to just reach the tray's
 * own near edge (~1.12m away, from `TRAY_RETURN_ZONE_POSITION`/`_FOOTPRINT`)
 * with a small margin вЂ” not the earlier, much wider box that reached deep
 * past that edge before `pushOutsideTrayReturnZone` (untouched here) took
 * over. Centered on the rack every frame (`planePoint`), so it moves if the
 * rack's own calibrated spot ever does.
 */
const TUBE_DRAG_HALF_WIDTH = 1.15;
const TUBE_DRAG_HALF_DEPTH = 0.4;
/**
 * Fixed WORLD up вЂ” the drag plane's normal, NOT derived from the rack's own
 * (`parent.getWorldQuaternion()`) rotation like an earlier version did. The
 * rack is normally flat (identity rotation) once at rest, but even a tiny
 * residual tilt there would tip the plane's normal away from true vertical;
 * combined with a shallow camera angle that's exactly the "near-parallel
 * ray" degenerate case `CameraRig` already documents for its OWN table-prop
 * dragging (`TABLE_PITCH_LOOK_RANGE`'s doc) вЂ” where `Ray.intersectPlane` can
 * come back null (or, worse, wildly far away) and the drag reads as frozen.
 * The proven, working jar-drag in `CameraRig` uses plain world-up for
 * exactly this reason; this now matches it instead of reinventing a more
 * fragile version.
 */
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** How close (straight-line world distance) a held tube needs to get to a workbench jar's own registered pick target before it "fills" вЂ” jars are roughly 0.08-0.13m across, so this comfortably counts as "right next to it" without requiring a pixel-precise hover. */
/** The carried 2.2 cm tube, kept off what stands on the table (VL-018). */
const CARRIED_TUBE_RADIUS = 0.012;
const RACK_TAG: ReadonlySet<string> = new Set(["rack"]);

/**
 * One tube standing in the workbench rack's hole grid, rendered as a CHILD
 * of the rack's own animated group (`WorkbenchTestTubeRackInstance` passes
 * these as `LabTestTubeRackInstance`'s `children`) so it travels with the
 * rack through the pick-up/inspect/return flight for free вЂ” no separate
 * position bookkeeping needed.
 *
 * Only raycasts/hovers while `interactive` (the rack is actually being
 * inspected) AND `filled` (a real tube occupies this hole) вЂ” hovering a tiny,
 * far-away slot on the resting bench would be unreliable and would compete
 * with the rack's own pick-up-the-whole-thing click target. Hover raises the
 * tube slightly and lights it with the same Fresnel rim `ReagentHoverRim`
 * uses everywhere else, and reports itself to `useTestTubeHoverStore` so
 * `ReagentInspectionOverlay` can show a contents tooltip above РћРЎРўРђР’РРўР¬.
 *
 * Also reads `useTestTubeDragStore`: while THIS instance is the held one
 * (clicked from `ReagentInspectionOverlay`'s button grid вЂ” a tube has no 3D
 * click handler of its own yet, only the 2D button does), it slides across
 * the SAME horizontal plane as the tabletop, following the cursor, instead
 * of resting in its rack slot вЂ” NOT floating at some fixed distance in front
 * of the camera. Releasing (clicking anywhere, Escape, or picking a
 * different tube) lets it damp straight back into its slot.
 *
 * While held, it also checks its live distance to every jar currently on
 * the workbench (`useWorkbenchReagentDragStore`'s own pick-target registry вЂ”
 * the SAME live `Object3D`s `CameraRig` already raycasts for jar dragging,
 * so this needs no separate position bookkeeping) вЂ” close enough to one and
 * `index` (its slot in `workbenchTestTubes`) gets that jar's `reagentId`
 * written to it (`setWorkbenchTubeContents`), which is what actually shows
 * the contents inside the tube вЂ” see `fillTestTubeContents`.
 */
export function InspectableTestTubeSlot({
  instanceId,
  index,
  localPosition,
  filled,
  interactive,
}: {
  readonly instanceId: string;
  /** This tube's index into `useTestTubeStorageStore`'s `workbenchTestTubes` вЂ” see `setWorkbenchTubeContents`'s doc for why the array order doubles as the slot mapping. */
  readonly index: number;
  readonly localPosition: Readonly<[number, number, number]>;
  readonly filled: boolean;
  readonly interactive: boolean;
}) {
  const { scene } = useGLTF(MODEL_PATH);
  const instance = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => prepareTestTube(instance), [instance]);
  useEffect(() => disableRaycast(instance), [instance]);

  const contents = useTestTubeStorageStore((state) => state.workbenchTestTubes[index]?.contents);
  // Drives `stepCopperGranuleDrop` from the main `useFrame` below once a
  // Cu fill creates a granule stack вЂ” `null` the rest of the time (every
  // other reagent's contents just appear, no per-frame animation needed).
  const copperDropRef = useRef<{ readonly group: THREE.Group; elapsedMs: number } | null>(null);
  useEffect(() => {
    const configs = resolveTubeContents(contents);
    if (configs.length === 0) return;
    const binding = fillTestTubeContents(instance, configs);
    if (binding.granules) copperDropRef.current = { group: binding.granules, elapsedMs: 0 };
    return () => binding.dispose();
  }, [instance, contents]);

  // A box noticeably wider than the actual thin glass (see
  // `HITBOX_HALF_WIDTH`/`HITBOX_HALF_DEPTH`'s doc) вЂ” height/vertical center
  // still taken from the tube's own real bounds so it doesn't extend above
  // or below the visible glass.
  const hoverHitboxGeometry = useMemo(() => {
    const box = new THREE.Box3().setFromObject(instance);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const geometry = new THREE.BoxGeometry(HITBOX_HALF_WIDTH * 2, size.y, HITBOX_HALF_DEPTH * 2);
    geometry.translate(center.x, center.y, center.z);
    return geometry;
  }, [instance]);

  useEffect(() => {
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  const groupRef = useRef<THREE.Group>(null);
  // Attached to the Bunsen stand's ring вЂ” the rack slot itself stops
  // rendering the tube (scale shrinks like an empty hole) while
  // `BunsenStandWorkbenchDisplay` renders the actual attached copy as its
  // own child, so it travels with the stand if it's dragged elsewhere. The
  // rack's `workbenchTestTubes` array/count is untouched вЂ” this is a purely
  // visual reassignment, not a removal (see `attachedTubeSlotIndex`'s doc).
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const isAttachedHere = attachedTubeSlotIndex === index;
  const rackArrival = useStandMotionStore((state) =>
    state.rackArrival?.location === "workbench" && state.rackArrival.index === index ? state.rackArrival : null,
  );
  const visuallyFilled = filled && !isAttachedHere;
  const canHover = interactive && visuallyFilled;
  const tablePosition = useFurniturePositionStore((state) => state.getOverride("table").position);
  // Derived straight from the shared store (the single source of truth for
  // "which tube is hovered") instead of mirroring it into local state вЂ” a
  // tube only ever reads its OWN hovered-ness here, it never needs to hold
  // it.
  const hovered = useTestTubeHoverStore((state) => canHover && state.hoveredInstanceId === instanceId);

  // Dropping out of "canHover" mid-hover (rack closes, or the slot empties)
  // must not leave the shared store вЂ” and so the overlay tooltip вЂ” pointed
  // at an instance that can no longer be hovered.
  useEffect(() => {
    if (canHover) return;
    useTestTubeHoverStore.getState().clearIfHovered(instanceId);
  }, [canHover, instanceId]);

  const { camera } = useThree();
  // Deliberately NOT gated on `canHover`/`interactive` вЂ” a tube picked up
  // from the button grid is meant to keep following the cursor well past
  // the point the holder itself has closed and stopped being "inspected"
  // (see `useTestTubeDragStore`'s `pendingPickInstanceId` doc). `filled` is
  // still required: an emptied slot has nothing to hold.
  const isHeld = useTestTubeDragStore((state) => filled && state.heldInstanceId === instanceId);
  useEffect(() => {
    if (filled) return;
    useTestTubeDragStore.getState().releaseIfHeld(instanceId);
  }, [filled, instanceId]);

  // A click while held drops the tube back into its slot вЂ” "clicking on
  // air" was the player's own description вЂ” UNLESS it landed on a jar or
  // the Bunsen stand: jars fill the tube by HOVER proximity alone (see the
  // `useFrame` check below), and clicking one (or the stand) is exactly the
  // kind of thing a player tries instinctively, so treating that click as
  // "drop it" instead of just declining the grab/take (both already blocked
  // elsewhere while a tube is held) read as "clicking a jar returns the tube
  // to the rack" вЂ” not what was asked for.
  //
  // This used to re-derive "did the press land on a jar" here via its own
  // independent raycast (captured on `pointerdown`, before a grab's
  // synchronous snap-back could move the jar out from under a click-time
  // raycast вЂ” see git history). That duplicate raycast measurably drifted
  // from the REAL hit in practice: a press square on a jar's own hitbox
  // still came back empty, dropping the tube anyway. `consumePickablePressed`
  // instead reads a flag the jar's/stand's own `pointerdown` handler sets
  // itself, using the SAME R3F hit-test that already, reliably, decides
  // whether to grab/take that exact object вЂ” see its own doc.
  useEffect(() => {
    if (!isHeld) return;
    const handleClick = () => {
      // This "click empty air, drop the tube" gesture only makes sense while
      // actually resting at the table (its rack is what the tube flies back
      // into) вЂ” nothing walks the player out of the table with a tube still
      // held (`Laboratory.tsx`'s `returnToOverview` doesn't drop it), so
      // without this guard, clicking a reagent jar INSIDE a cabinet (already
      // blocked from being taken, see `ReagentContainerInstance`'s own
      // `heldInstanceId` guard) still fell through to here and dropped the
      // tube back into a rack that wasn't even in view вЂ” read as "clicking
      // the jar returns the tube" even though nothing was actually grabbed.
      if (useSceneInteractionStore.getState().activeTargetId !== "table") {
        consumePickablePressed();
        return;
      }
      if (consumePickablePressed()) return;
      // Close enough to the ring (see the `useFrame` proximity check above)
      // вЂ” clip in instead of dropping back into the rack. Captures this
      // exact world pose (not just the slot index) so `AttachedTube` can fly
      // in from wherever the player actually released it instead of popping
      // straight into the ring вЂ” same "hand off exactly where it visually
      // was" trick `useReagentStorageStore.requestReturn` already uses.
      if (overTrayRef.current) {
        overTrayRef.current = false;
        WORKBENCH_CARRY.overTray = false;
        useTestTubeDragStore.getState().releaseIfHeld(instanceId);
        tubeToTray("workbench", index);
        return;
      }
      if (nearRingRef.current) {
        const group = groupRef.current;
        if (!group) return;
        const worldPos = group.getWorldPosition(new THREE.Vector3());
        useBunsenStandStorageStore.getState().attachTestTube(index, [worldPos.x, worldPos.y, worldPos.z]);
        useStandMotionStore.getState().arriveInClamp([worldPos.x, worldPos.y, worldPos.z]);
        useTestTubeDragStore.getState().releaseIfHeld(instanceId);
        return;
      }
      // In the hand (VL-015) a click on empty air does nothing — a double
      // click puts the tube back (`HandController`) — except right over the
      // rack, where it plainly means «put it back here».
      if (useHandStore.getState().held && !useTestTubeDragStore.getState().isNearHolder) return;
      useTestTubeDragStore.getState().releaseIfHeld(instanceId);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [isHeld, instanceId, index]);

  const dragRaycasterRef = useRef(new THREE.Raycaster());
  const dragPlaneRef = useRef(new THREE.Plane());
  const dragWorldTargetRef = useRef(new THREE.Vector3());
  const dragPlanePointRef = useRef(new THREE.Vector3());
  const fillCheckTubeWorldPosRef = useRef(new THREE.Vector3());
  /** Live "close enough to the ring to clip in" result from the `useFrame` proximity check above вЂ” read by the click handler below, same "proximity arms it, a click commits it" split the jar-fill/jar-click-exception pair already uses. A plain ref (not state): it's read once per click, not something that should trigger a re-render every frame it changes. */
  const nearRingRef = useRef(false);
  /** Live: the carried tube is over the tray on the table (`overTableTray`). */
  const overTrayRef = useRef(false);

  // Two-leg return once released: "approach" travels to directly above the
  // slot at a safe lifted height (clears the rack's own rim/neighbors),
  // THEN "insert" drops straight down into it вЂ” same reasoning as the
  // cabinet's own shelfв†’tray flight (see `LabTestTubeCabinetInstance`'s
  // "insert" phase doc), just triggered by a release instead of a take.
  // Without this, damping X/Y/Z toward the slot all at once cut a straight
  // line back in that could drag the tube visibly through the rack's side
  // wall depending on where it was dropped.
  type ReturnPhase = "idle" | "approach" | "insert";
  const returnPhaseRef = useRef<ReturnPhase>("idle");
  const wasHeldRef = useRef(false);
  // Set only while the CURRENT "approach"/"insert" run is a fresh arrival
  // (a hole going from empty to filled for the first time вЂ” taken from the
  // cabinet, or detached back from the Bunsen stand ring) rather than a
  // released drag вЂ” see the `visuallyFilled` effect below. Drives whether
  // the same two-leg motion ALSO grows scale from `EMPTY_SLOT_SCALE`, since
  // a released drag's tube is already at full scale the whole time.
  const arrivingRef = useRef(false);
  useEffect(() => {
    if (isHeld) {
      wasHeldRef.current = true;
      returnPhaseRef.current = "idle";
    } else if (wasHeldRef.current) {
      wasHeldRef.current = false;
      arrivingRef.current = false;
      // Attached to the ring, not dropped вЂ” `BunsenStandWorkbenchDisplay`
      // renders the actual attached tube; this slot just shrinks to an
      // empty hole (see `visuallyFilled`) instead of flying back in.
      if (!isAttachedHere) returnPhaseRef.current = "approach";
    }
  }, [isHeld, isAttachedHere]);

  // The actual "placing a tube into the rack" animation: the moment this
  // hole goes from empty to filled вЂ” taken from the cabinet and handed off
  // here by `transferTrayToWorkbench`, or detached back from the Bunsen
  // stand ring вЂ” jumps straight into the SAME "insert" leg a released drag
  // ends with (see the `useFrame` "insert" branch), starting it from
  // directly above the slot (`RETURN_APPROACH_HEIGHT` up, matching where
  // that leg always starts from) and growing from `EMPTY_SLOT_SCALE`
  // instead of already being full size. Skips the "approach" leg entirely вЂ”
  // unlike a drag dropped somewhere else on the table, a fresh arrival has
  // no sideways travel to do, it only ever needs to drop straight down and
  // grow into view. Guarded on `returnPhaseRef.current === "idle"` so it can
  // never interrupt an in-flight drag-return (the two triggers can't
  // legitimately fire on the same frame, but this keeps it that way even if
  // store updates ever reorder). Starting already filled on mount (nothing
  // in this store persists across a reload today, but if that changes) must
  // NOT replay the drop вЂ” only an actual emptyв†’filled transition does.
  const wasVisuallyFilledRef = useRef(visuallyFilled);
  useEffect(() => {
    if (visuallyFilled && !wasVisuallyFilledRef.current && returnPhaseRef.current === "idle") {
      const group = groupRef.current;
      if (group) {
        group.position.set(localPosition[0], localPosition[1] + RETURN_APPROACH_HEIGHT, localPosition[2]);
        group.scale.setScalar(EMPTY_SLOT_SCALE);
      }
      arrivingRef.current = true;
      returnPhaseRef.current = "insert";
    }
    wasVisuallyFilledRef.current = visuallyFilled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visuallyFilled]);

  // Mount-time-only sync вЂ” `scale` is fully imperative from here on (see
  // `useFrame` below), so an empty hole must start already shrunk instead of
  // showing one full-size frame before the very first `useFrame` runs.
  useEffect(() => {
    groupRef.current?.scale.setScalar(visuallyFilled ? 1 : EMPTY_SLOT_SCALE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    // Runs unconditionally (not gated on `isHeld`) вЂ” the drop animation is
    // short (well under the time it'd take to carry the tube anywhere) but
    // must still finish even if the player releases it the instant it
    // fills, rather than freezing granules mid-air the moment `isHeld` goes
    // false.
    const copperDrop = copperDropRef.current;
    if (copperDrop) {
      copperDrop.elapsedMs += delta * 1000;
      if (!stepCopperGranuleDrop(copperDrop.group, copperDrop.elapsedMs)) {
        copperDropRef.current = null;
      }
    }

    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;

    if (isHeld) {
      // The bare tabletop plane вЂ” plain world-up normal (see `WORLD_UP`'s
      // doc), passing through the SAME height the tube rests at in its slot
      // (local Y = `TABLE_SURFACE_LOCAL_Y`, i.e. the rack's own origin
      // height вЂ” NOT `localPosition[1]`, which is where the tube stands
      // INSIDE the rack's raised collar and would leave it visibly floating
      // above the actual table surface). NOT a plane facing the camera: the
      // tube slides across the table, it doesn't float in front of the lens.
      const planePoint = parent.localToWorld(dragPlanePointRef.current.set(0, TABLE_SURFACE_LOCAL_Y, 0));
      dragPlaneRef.current.setFromNormalAndCoplanarPoint(WORLD_UP, planePoint);
      dragRaycasterRef.current.setFromCamera(sharedMouseNdc, camera);
      if (dragRaycasterRef.current.ray.intersectPlane(dragPlaneRef.current, dragWorldTargetRef.current)) {
        // Invisible walls, tightest first:
        // 1) a small box around the rack's own position (`planePoint`, at
        //    `TABLE_SURFACE_LOCAL_Y` вЂ” already the rack's world X/Z) вЂ” the
        //    player asked for the range to be much smaller than the whole
        //    countertop.
        // 2) the tray's own footprint (`pushOutsideTrayReturnZone`) вЂ” a
        //    target that lands inside it gets pushed straight back out to
        //    the NEAREST edge instead of being thrown out entirely, so the
        //    tube slides right up against the tray's side and along it
        //    instead of going dead the instant the raw cursor ray crosses
        //    the boundary (freezing there read as a much bigger "blocked"
        //    area than the tray's own actual footprint).
        // 3) `clampToTableWorldXZ` вЂ” the physical table edge, same bounds
        //    every other "drag a prop across the table" mechanic respects,
        //    kept as a last-resort backstop.
        let targetX = THREE.MathUtils.clamp(
          dragWorldTargetRef.current.x,
          planePoint.x - TUBE_DRAG_HALF_WIDTH,
          planePoint.x + TUBE_DRAG_HALF_WIDTH,
        );
        let targetZ = THREE.MathUtils.clamp(
          dragWorldTargetRef.current.z,
          planePoint.z - TUBE_DRAG_HALF_DEPTH,
          planePoint.z + TUBE_DRAG_HALF_DEPTH,
        );
        [targetX, targetZ] = pushOutsideTrayReturnZone(targetX, targetZ);
        [targetX, targetZ] = clampToTableWorldXZ(targetX, targetZ, tablePosition);
        dragWorldTargetRef.current.set(targetX, dragWorldTargetRef.current.y, targetZ);
        // Off everything standing on the table (VL-018) — but not its own
        // rack, which it is carried back into.
        constrainOnWorktop(dragWorldTargetRef.current, CARRIED_TUBE_RADIUS, planePoint, new Set(), RACK_TAG);
        const localTarget = parent.worldToLocal(dragWorldTargetRef.current);
        group.position.x = THREE.MathUtils.damp(group.position.x, localTarget.x, DRAG_DAMPING, delta);
        group.position.y = THREE.MathUtils.damp(group.position.y, localTarget.y, DRAG_DAMPING, delta);
        group.position.z = THREE.MathUtils.damp(group.position.z, localTarget.z, DRAG_DAMPING, delta);
      }
      // Straight-line distance to the rack's own origin, checked fresh every
      // frame regardless of whether the mouse itself is moving вЂ” see
      // `useTestTubeDragStore`'s `isNearHolder` doc for why this replaces a
      // hover event here.
      const distanceToRack = Math.hypot(group.position.x, group.position.z);
      useTestTubeDragStore.getState().setNearHolder(distanceToRack < NEAR_HOLDER_RADIUS);

      const tubeWorldPos = group.getWorldPosition(fillCheckTubeWorldPosRef.current);

      // A tube is no longer filled by carrying it to a jar: the reagent is
      // poured from the bottle into the tube in the clamp (VL-018).

      // Proximity to the Bunsen stand's `TubeRing`, while it's actually on
      // the table вЂ” same live-distance technique as the jar fill check
      // above, not a hover event (the tube is what's moving). Only the
      // NEAREST-frame result matters; the actual attach commit happens in
      // the click handler below (see `nearRingRef`'s doc there), the same
      // "proximity arms it, a click on empty air still commits" split the
      // jar-click exception already uses.
      // Over the tray on the table: a click puts it on the tray (VL-017).
      overTrayRef.current = overTableTray(tubeWorldPos);
      WORKBENCH_CARRY.overTray = overTrayRef.current;

      const bunsenState = useBunsenStandStorageStore.getState();
      if (bunsenState.onWorkbench) {
        const [ringX, ringZ] = tableRingOffsetXZ();
        const ringWorldX = tablePosition[0] + bunsenState.tablePosition.x + ringX;
        const ringWorldZ = tablePosition[2] + bunsenState.tablePosition.z + ringZ;
        // Horizontal (X/Z) distance only вЂ” NOT `Vector3.distanceTo` against
        // the ring's true 3D position. `TubeRing` sits ~0.22m above the
        // table (`TUBE_RING_LOCAL_OFFSET[1]`), but a held tube slides along
        // `TABLE_SURFACE_LOCAL_Y` the whole time it's being dragged (see
        // that constant's doc) вЂ” its Y never leaves table height, so a 3D
        // distance check against the ring could never be satisfied at ANY
        // radius smaller than that 0.22m vertical gap, no matter how
        // precisely X/Z lined up. This checks the thing the player actually
        // controls: is the tube over the table spot directly below the ring.
        const dx = tubeWorldPos.x - ringWorldX;
        const dz = tubeWorldPos.z - ringWorldZ;
        // A plain ref write inside `useFrame` вЂ” see `useInspectionSlosh`'s own
        // precedent for this same false positive on mutable per-frame state.
        nearRingRef.current = Math.hypot(dx, dz) < TUBE_RING_ATTACH_RADIUS;
      } else {
        nearRingRef.current = false;
      }
      // Already full size the whole time it's being dragged вЂ” only an
      // `arrivingRef` run (below) ever needs to grow this from empty.
      group.scale.setScalar(1);
      return;
    }
    nearRingRef.current = false;

    if (returnPhaseRef.current === "approach") {
      // Only a released drag ever reaches this leg вЂ” a fresh arrival (see
      // the `visuallyFilled` effect above) starts directly in "insert"
      // instead, since it has no sideways travel to do. Already full size
      // the whole time it's being dragged (see the `isHeld` branch above),
      // so this leg never touches scale.
      const approachY = localPosition[1] + RETURN_APPROACH_HEIGHT;
      group.position.x = THREE.MathUtils.damp(group.position.x, localPosition[0], RETURN_DAMPING, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, approachY, RETURN_DAMPING, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, localPosition[2], RETURN_DAMPING, delta);
      if (
        Math.abs(group.position.x - localPosition[0]) < RETURN_EPSILON &&
        Math.abs(group.position.y - approachY) < RETURN_EPSILON &&
        Math.abs(group.position.z - localPosition[2]) < RETURN_EPSILON
      ) {
        group.position.set(localPosition[0], approachY, localPosition[2]);
        returnPhaseRef.current = "insert";
      }
      return;
    }

    if (returnPhaseRef.current === "insert") {
      group.position.y = THREE.MathUtils.damp(group.position.y, localPosition[1], RETURN_DAMPING, delta);
      if (arrivingRef.current) {
        group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, 1, RETURN_DAMPING, delta));
      }
      if (Math.abs(group.position.y - localPosition[1]) < RETURN_EPSILON) {
        group.position.set(localPosition[0], localPosition[1], localPosition[2]);
        if (arrivingRef.current) {
          group.scale.setScalar(1);
          arrivingRef.current = false;
        }
        returnPhaseRef.current = "idle";
      }
      return;
    }

    // Resting in the rack (or an empty hole), "idle" вЂ” X/Z stay pinned to
    // the slot, Y adds the small hover raise on top, and scale settles
    // toward its resting size (1 filled, `EMPTY_SLOT_SCALE` empty) вЂ” covers
    // both the ordinary steady state and the quick shrink when a tube gets
    // reassigned to the Bunsen stand ring (no drop-in animation for that
    // one, just a fade down to nothing).
    const targetY = localPosition[1] + (hovered ? HOVER_RAISE : 0);
    group.position.x = localPosition[0];
    group.position.y = THREE.MathUtils.damp(group.position.y, targetY, RAISE_DAMPING, delta);
    group.position.z = localPosition[2];
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, visuallyFilled ? 1 : EMPTY_SLOT_SCALE, RAISE_DAMPING, delta));
  });

  return (
    <group ref={groupRef} position={localPosition}>
      {/* Back from the clamp: seen flying home to its slot. */}
      <ArrivalFlight arrival={rackArrival}>
        <primitive object={instance} />
        <ReagentHoverRim object={instance} active={hovered || isHeld} />
      </ArrivalFlight>
      {/* The ONLY raycast target (the real glass had raycasting disabled
          above) вЂ” noticeably bigger than the tube itself, see
          `HITBOX_HALF_WIDTH`/`HITBOX_HALF_DEPTH`'s doc. */}
      <mesh
        geometry={hoverHitboxGeometry}
        // Same `clickWorkbenchRackTube` the 2D button in `ReagentInspectionOverlay`
        // uses вЂ” clicking the tube directly, right here in the inspecting
        // view, is a second entry point to the exact same pick-up behavior.
        onClick={
          canHover
            ? (event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation();
                const at = groupRef.current?.getWorldPosition(new THREE.Vector3());
                clickWorkbenchRackTube(index, instanceId, at ? [at.x, at.y, at.z] : undefined);
              }
            : undefined
        }
        // While carried, this hitbox sits right at the cursor вЂ” without a
        // pointerdown handler of its own here, R3F's raycast fell through
        // it to whatever was BEHIND it on screen (e.g. the Bunsen stand),
        // which does have its own pointerdown drag handler. Stopping it
        // here is the actual fix for "grabbing the stand while carrying a
        // tube"; `BunsenStandWorkbenchDisplay`'s own `tubeHeld` guard is a
        // second, redundant layer, not the one doing the real work.
        onPointerDown={
          isHeld
            ? (event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
              }
            : undefined
        }
        onPointerOver={
          canHover
            ? (event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                useTestTubeHoverStore.getState().setHovered(instanceId);
                useStandHintStore.getState().show(instanceId, { kind: "rack-tube", location: "workbench", index });
              }
            : undefined
        }
        onPointerOut={
          canHover
            ? (event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                useTestTubeHoverStore.getState().clearIfHovered(instanceId);
                useStandHintStore.getState().hide(instanceId);
              }
            : undefined
        }
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
