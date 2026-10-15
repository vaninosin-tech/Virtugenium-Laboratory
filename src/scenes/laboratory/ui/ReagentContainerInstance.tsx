import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { createTextTexture } from "../lib/createTextTexture";
import { remapPlanarUV } from "../lib/remapPlanarUV";
import { installReagentMaterials } from "../lib/reagentMaterials";
import { useReagentMaterials } from "../lib/useReagentMaterials";
import { useInspectionSlosh } from "../lib/useInspectionSlosh";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { getCabinetParallelTrayYaw, type HotspotTargetId, type Position3 } from "../lib/layout";
import { useNavButtonCalibrationStore } from "../lib/useNavButtonCalibrationStore";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useReagentPickablesStore } from "../lib/useReagentPickablesStore";
import { nextFreeTraySlot, useReagentStorageStore } from "../lib/useReagentStorageStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { traySlotLocalPosition } from "../lib/useTrayReagentAreaStore";
import type { ContainerType, ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useNormalHoverOutline } from "./NormalHoverOutline";

/** Exported for `ReagentStaticDisplay` (non-interactive tray/workbench copies of taken reagents) — same asset, same construction, just no click/hover/animation plumbing. */
export const MODEL_PATH = "/assets/models/ReagentContainers.glb";

/** containerType -> master root node name in `ReagentContainers.glb` (verified against the glb's own node list). */
export const CONTAINER_ROOT_NAME: Record<ContainerType, string> = {
  clear250: "ReagentBottle_Clear_250ml",
  amber250: "ReagentBottle_Amber_250ml",
  wide120: "ReagentJar_WideMouth_120ml",
};

export const LABEL_CANVAS_WIDTH = 512;
export const LABEL_CANVAS_HEIGHT = 256;
export const LABEL_TEXT_COLOR = "#14181c";
export const LABEL_BACKGROUND_COLOR = "#ffffff";

/**
 * Inspection stage position/scale used to come from a hardcoded
 * distance/vertical-offset/per-containerType-scale table computed fresh
 * from camera distance on every click. That meant the framing could drift
 * whenever the click happened from a slightly different camera pose, and
 * gave no way to lock in one calibrated look. Now the stage transform is
 * read live from `useNavButtonCalibrationStore`'s `inspectionBottle` (F9
 * panel, camera-relative X/Y/Z + a single scale shared by every container
 * type) at click time — see `handleClick` below.
 */
/** Small vertical clearance used for the safe pick-up/return path (STEP A / final STEP) — just enough to lift the container's actual bounding-box bottom off the shelf/front lip before moving it horizontally. Intentionally tiny: the requirement is minimum clearance, not a launch into the air. */
const PICKUP_LIFT = 0.02;
/**
 * Exponential-damping rate for BOTH directions of the stage move — the
 * outbound (shelf → stage) and the return (stage → shelf) now use the exact
 * same damping toward the exact same two endpoints, so the return is
 * literally the outbound path run in reverse, not a separately-authored
 * animation. Since the outbound path already clears the shelf cleanly (it
 * moves away from a flat resting surface toward open space in front of the
 * camera), its time-reversal is equally shelf-safe — no separate staged
 * lift/align/settle sequence is needed. Reaches ~95% of the way to its
 * target in about 0.5s.
 */
const MOVE_DAMPING = 6;

/**
 * TAKE (shelf → held tray) duration, seconds — a deterministic tween, NOT
 * exponential damping: damping toward the tray's live camera-relative
 * target, then snapping to it once "close enough", is what produced the
 * reported shrink-then-snap (the snap always corrected some non-zero
 * residual error, and the residual was largest for scale since it damped
 * toward the wrong value). A fixed-duration lerp/slerp between two
 * transforms captured ONCE at take-start, always landing exactly on the end
 * transform at t=1, has no residual to correct and thus nothing to snap.
 */
const TAKE_DURATION_S = 0.36;
/** How high over its tray slot a bottle's flight arcs (tray-local metres): above the 0.31 m stand. */
const TRAY_ARC_HEIGHT = 0.36;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** A point on the quadratic arc `from` → (towards `via`) → `to` at `t` — into `out`. */
function trayArcPoint(out: THREE.Vector3, from: THREE.Vector3, via: THREE.Vector3, to: THREE.Vector3, t: number): THREE.Vector3 {
  const u = 1 - t;
  return out
    .copy(from)
    .multiplyScalar(u * u)
    .addScaledVector(via, 2 * u * t)
    .addScaledVector(to, t * t);
}
/**
 * Final vertical-drop leg of a tray→shelf return ("returnFromTrayLower") —
 * shorter than `TAKE_DURATION_S` since it only covers the small
 * `PICKUP_LIFT` clearance, not the whole cross-room flight, but still an
 * eased tween (not damping) for the same reason as `TAKE_DURATION_S`'s own
 * doc: matching curves on both legs of the return means the velocity
 * doesn't visibly change character at the handoff between them.
 */
const TAKE_LOWER_DURATION_S = 0.3;
/** "Close enough to home" threshold for snapping to the exact original transform and reporting the return as finished — small enough to be imperceptible. */
const RETURN_POSITION_EPSILON = 0.01;

const DRAG_YAW_SENSITIVITY = 0.008;
const DRAG_PITCH_SENSITIVITY = 0.006;
const PITCH_LIMIT = THREE.MathUtils.degToRad(20);

/**
 * Symmetric safe pick-up/return path: "pickupLift" raises the container
 * straight up (X/Z/rotation/scale unchanged) until its actual bounds clear
 * the shelf, then "inspecting" moves+scales it to the calibrated stage —
 * that's STEP A / STEP B. Closing reverses this EXACTLY: "returnMove" moves
 * +shrinks back to the same lifted waypoint above the original slot, then
 * "returnLower" drops straight down onto the shelf. Neither leg ever moves
 * both vertically and toward/away from the shelf at once, so the path can
 * never graze shelf geometry. "takeMove" is the ВЗЯТЬ counterpart to
 * "returnMove": instead of heading back to the shelf, it damps+shrinks
 * toward the same camera-relative held-tray anchor `LabTrayInstance` itself
 * targets while held — once it arrives, this instance registers itself as
 * taken and stops rendering (see the render guard near the bottom).
 */
type Phase =
  | "atRest"
  | "pickupLift"
  | "inspecting"
  | "returnMove"
  | "returnLower"
  | "takeMove"
  | "returnFromTray"
  | "returnFromTrayLower";

/**
 * A single box, sized and centered to `object`'s current bounds, meant to be
 * rendered as an invisible proxy mesh — its MATERIAL `visible={false}`, so it
 * is never drawn (nor written into the outline pass's depth, where a
 * transparent zero-opacity box hid the very object it wraps), while the mesh
 * itself stays visible to raycasting; never the mesh's own `visible`, which
 * R3F pointer events skip — that is
 * the ONLY raycast target for hover/click on a reagent container. A
 * container is several overlapping meshes (glass body, cap, label, contents)
 * each independently raycastable by default; moving the cursor across the
 * object made R3F's "nearest hit" alternate between them frame to frame,
 * firing pointerout+pointerover on the group in rapid succession — invisible
 * on the old, faint hover rim, but read as a visible flicker once hover got
 * bright enough to notice. Exported so both `ReagentContainerInstance` (shelf
 * originals) and `ReagentStaticDisplay` (tray/workbench copies) build the
 * exact same single-hitbox shape from their own `instance` geometry — pair
 * this with disabling raycast on every real mesh in that geometry (see
 * `disableRaycast` below) so the hitbox is truly the only thing that can be
 * "nearest."
 */
export function createHoverHitboxGeometry(object: THREE.Object3D): THREE.BoxGeometry {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/** Turns off raycasting for every mesh under `object` — see `createHoverHitboxGeometry`'s doc for why (a single invisible hitbox replaces them all as the interactive surface, eliminating the multi-mesh hover-flicker). Purely a raycast/event concern; rendering is untouched. */
export function disableRaycast(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.raycast = () => {};
    }
  });
}

/** Finds the first descendant whose name starts with `prefix` — the glb's non-root nodes get Blender's/three's ".001"/".002" duplicate suffixes per container instance (`LabelSurface`, `LabelSurface.001`, `LabelSurface.002`, ...), so an exact-name match would only ever find the first one. */
export function findByPrefix(root: THREE.Object3D, prefix: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name.startsWith(prefix)) found = object;
  });
  return found;
}

/** Clones `geometry` with triangle winding reversed and normals negated — used to give a plane a distinct, front-culled "other side" without `DoubleSide` (see the label material below). */
export function createFlippedGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flipped = geometry.clone();
  const index = flipped.getIndex();
  if (index) {
    const array = index.array.slice();
    for (let i = 0; i + 2 < array.length; i += 3) {
      const tmp = array[i];
      array[i] = array[i + 2];
      array[i + 2] = tmp;
    }
    flipped.setIndex(new THREE.BufferAttribute(array, 1));
  } else {
    const position = flipped.getAttribute("position");
    const uv = flipped.getAttribute("uv");
    const normal = flipped.getAttribute("normal");
    for (let i = 0; i + 2 < position.count; i += 3) {
      swapAttributeTriplet(position, i, i + 2);
      if (uv) swapAttributeTriplet(uv, i, i + 2);
      if (normal) swapAttributeTriplet(normal, i, i + 2);
    }
  }
  const normal = flipped.getAttribute("normal");
  if (normal) {
    for (let i = 0; i < normal.count; i++) {
      normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    }
    normal.needsUpdate = true;
  }
  return flipped;
}

/** Swaps the values of two vertices within a `BufferAttribute` of any item size — used by `createFlippedGeometry`'s non-indexed fallback path. */
function swapAttributeTriplet(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, a: number, b: number): void {
  const size = attribute.itemSize;
  const tmp = new Array(size);
  for (let k = 0; k < size; k++) tmp[k] = attribute.getComponent(a, k);
  for (let k = 0; k < size; k++) attribute.setComponent(a, k, attribute.getComponent(b, k));
  for (let k = 0; k < size; k++) attribute.setComponent(b, k, tmp[k]);
  attribute.needsUpdate = true;
}

/**
 * One reusable loader for all three master container bodies in
 * `ReagentContainers.glb` (`ReagentBottle_Clear_250ml` /
 * `ReagentBottle_Amber_250ml` / `ReagentJar_WideMouth_120ml` — see
 * `CONTAINER_ROOT_NAME`). The glb is loaded once (`useGLTF` caches by URL)
 * and the selected master subtree is deep-cloned per reagent instance, same
 * pattern as `ReagentCabinetInstance` — the source glb scene is never
 * mutated, so many reagent instances (including repeats of the same
 * container body) can coexist safely with independent label/contents
 * materials.
 *
 * Each master root in the source file carries its own studio-layout
 * translation (the three bodies were originally arranged side by side for
 * a reference render) — that offset is zeroed on the clone so this
 * component's own `position` prop is the only placement authority.
 *
 * Also owns the inspection interaction: hover rim, click-to-inspect
 * (animates to a stage in front of the camera via `useReagentInspectionStore`,
 * see the module doc there), and left-drag rotation while inspected. `id`
 * distinguishes this instance from every other one sharing the store;
 * callers that don't need inspection (the dev preview row) can omit it and
 * fall back to the reagent's own id.
 */
export function ReagentContainerInstance({
  reagent,
  position = [0, 0, 0],
  rotationY = 0,
  id,
  cabinetId,
}: {
  readonly reagent: ReagentContainerConfig;
  readonly position?: Position3;
  readonly rotationY?: number;
  readonly id?: string;
  /** Which cabinet's shelf this instance belongs to — enables session-local "taken" tracking (see `useReagentStorageStore`). Omitted by non-cabinet callers (e.g. the dev preview row), which then never hide/take. */
  readonly cabinetId?: HotspotTargetId;
}) {
  const instanceId = id ?? reagent.id;
  const { scene } = useGLTF(MODEL_PATH);
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const inspectedId = useReagentInspectionStore((state) => state.inspectedId);
  const isClosing = useReagentInspectionStore((state) => state.isClosing);
  const isTaking = useReagentInspectionStore((state) => state.isTaking);
  const isInspected = inspectedId === instanceId;
  const anyInspected = inspectedId !== null;
  // A test tube carried from the workbench occupies the player's one free
  // hand — without this, leaving the table with a tube still held (the
  // "return to overview" button/Escape don't drop it, see `Laboratory.tsx`'s
  // `returnToOverview`) let the player walk into any cabinet and take a
  // reagent jar right on top of it, which read as "grabbing the jar drops
  // nothing, I still have both". Same rule the workbench-level jar/rack/stand
  // interactions already enforce (`useTestTubeDragStore.heldInstanceId`) —
  // see `Laboratory.tsx`'s `DraggableWorkbenchReagent` guard for the
  // workbench-jar counterpart of this same check.
  const tubeHeld = useTestTubeDragStore((state) => state.heldInstanceId !== null);

  // Dev-menu click-to-select: only the bottle actually being inspected is a
  // sensible pick target (there's no fixed "bottle stage" object otherwise —
  // it's whichever instance the player picked up), so registration tracks
  // `isInspected` instead of running once on mount.
  useEffect(() => {
    if (!isInspected) return;
    const instance = groupRef.current;
    if (!instance) return;
    useReagentPickablesStore.getState().register("inspection-bottle", instance);
    return () => useReagentPickablesStore.getState().unregister("inspection-bottle");
  }, [isInspected]);

  // Session-local shelf depletion: once this instance's own take animation
  // lands on the tray (see the "takeMove" useFrame branch below), it's
  // registered here and stops rendering — until `cabinetId`'s session is
  // reset (fresh cabinet focus, see `ReagentCabinetInstance`), at which
  // point this Set reference changes and the shelf original reappears.
  const takenSet = useReagentStorageStore((state) => (cabinetId ? state.takenByCabinet[cabinetId] : undefined));
  const takenThisSession = takenSet?.has(instanceId) ?? false;

  const instance = useMemo(() => {
    const rootName = CONTAINER_ROOT_NAME[reagent.containerType];
    const master = scene.getObjectByName(rootName);
    if (!master) {
      // Fails loudly rather than silently rendering nothing — a missing
      // root name means the glb and this mapping have drifted apart.
      throw new Error(`ReagentContainerInstance: root node "${rootName}" not found in ${MODEL_PATH}`);
    }

    const clone = master.clone(true);
    const labelResources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] } = {
      geometries: [], materials: [], textures: [],
    };
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    // Physical white label mesh already ships in the glb; only the runtime
    // text drawn onto it changes per reagent. The glb's own UVs don't give
    // a clean front-facing projection, so this needs the same
    // `remapPlanarUV` correction `CategoryLabelPlate` uses.
    // `clone(true)` copies geometry BY REFERENCE (only materials/transform
    // are per-instance) — every instance of the same containerType shares
    // one `LabelSurface` BufferGeometry, including with the original loaded
    // scene, so writing a remapped UV attribute onto it directly would
    // mutate that shared/original geometry. Clone it first so each
    // instance's remap is fully independent.
    // flipU=false (not true): verified in-browser against the rebuilt
    // ReagentContainers_MASTER asset — its LabelSurface winding reads
    // mirrored with flipU=true (correct for the old asset, wrong for this
    // one's differently-wound label-strip geometry).
    const label = findByPrefix(clone, "LabelSurface") as THREE.Mesh | null;
    if (label) {
      label.geometry = label.geometry.clone();
      labelResources.geometries.push(label.geometry);
      remapPlanarUV(label, false, false);
      const texture = createTextTexture({
        lines: [reagent.labelText],
        backgroundColor: LABEL_BACKGROUND_COLOR,
        textColor: LABEL_TEXT_COLOR,
        width: LABEL_CANVAS_WIDTH,
        height: LABEL_CANVAS_HEIGHT,
      });
      // FrontSide (not DoubleSide): DoubleSide rendered the same text texture
      // on the back face too, so the reagent formula showed through
      // mirrored when viewed from behind during 360° inspection. Text now
      // only ever renders on the geometry's front winding; a separate blank
      // white mesh with reversed winding (added below) covers the back so
      // the physical label still reads as present from every angle.
      // Diffuse-only paper follows scene lighting without glossy highlights.
      label.material = new THREE.MeshLambertMaterial({ map: texture, color: "#ffffff", emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 0.22, side: THREE.FrontSide });
      labelResources.textures.push(texture);
      labelResources.materials.push(label.material);
      label.receiveShadow = true;

      // Coincident child mesh with flipped winding/normals: its triangles
      // are only front-facing where `label`'s are back-facing, so exactly
      // one of the two ever renders for a given view direction — no
      // z-fighting. Parented directly under `label` with an identity local
      // transform so it inherits the exact same world transform.
      const backMaterial = new THREE.MeshLambertMaterial({
        color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.22,
        side: THREE.FrontSide,
      });
      const backMesh = new THREE.Mesh(createFlippedGeometry(label.geometry), backMaterial);
      labelResources.geometries.push(backMesh.geometry);
      labelResources.materials.push(backMaterial);
      backMesh.name = "LabelSurfaceBack";
      backMesh.receiveShadow = true;
      label.add(backMesh);
    }

    // Contents: color/opacity/fill level are runtime-only, on a per-instance
    // cloned material — the shared `ContentsVolume` mesh geometry itself is
    // never replaced or mutated on the source scene.
    installReagentMaterials(clone, reagent);

    // The three master container bodies were laid out side-by-side in the
    // source file, and that studio-layout offset is baked into the CHILD
    // meshes' own local transforms (not just the root's, which is already
    // zeroed above) — verified against the glb's own node data: e.g.
    // clear250's visible geometry sits ~0.11m off in local X, wide120's
    // ~-0.13m off, while amber250 happens to already be centered. Left
    // uncorrected, every consumer's `position` prop would place the wrong
    // point (this stale studio-layout origin, not the bottle's own visual
    // center) at its intended slot — recentering here, once, generically,
    // means no caller (cabinet shelves, the dev preview row) needs to know
    // about or compensate for per-containerType quirks. It also means
    // dragging the inspected reagent rotates around its true visual center,
    // not an off-axis studio origin.
    const bbox = new THREE.Box3().setFromObject(clone);
    const bboxCenter = bbox.getCenter(new THREE.Vector3());
    clone.position.x -= bboxCenter.x;
    clone.position.z -= bboxCenter.z;

    // See `createHoverHitboxGeometry`'s doc — the invisible hitbox mesh
    // rendered below is the only thing hover/click should ever hit.
    disableRaycast(clone);
    clone.userData.disposeLabel = () => {
      labelResources.geometries.forEach(resource => resource.dispose());
      labelResources.materials.forEach(resource => resource.dispose());
      labelResources.textures.forEach(resource => resource.dispose());
    };

    return clone;
  }, [scene, reagent]);

  useReagentMaterials(instance);
  const updateSlosh = useInspectionSlosh(instance, instanceId);

  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);

  useEffect(() => {
    // GLTF geometry is borrowed; disposing the whole hierarchy invalidates
    // every other copy's GPU buffers (also during StrictMode effect replay).
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, instance.userData.disposeLabel);
  }, [instance]);

  useEffect(() => {
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  // Drag-to-rotate while inspected: plain refs (not state) so a mousemove
  // doesn't trigger a re-render — useFrame reads them directly every frame.
  // Reset whenever inspection (re)opens so re-opening the same reagent
  // doesn't remember a stale rotation from the last time it was inspected.
  // Yaw is unclamped — a full 360° turn around the vertical axis — while
  // pitch stays clamped so the container can't be tipped upside down.
  const dragYawRef = useRef(0);
  const dragPitchRef = useRef(0);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (isInspected) {
      dragYawRef.current = 0;
      dragPitchRef.current = 0;
    }
  }, [isInspected]);

  useEffect(() => {
    if (!isInspected) return;
    const handleMouseMove = (event: MouseEvent) => {
      if (useReagentInspectionStore.getState().isShaking) {
        draggingRef.current = false;
        return;
      }
      if (!draggingRef.current) return;
      const dx = event.clientX - lastPointerRef.current.x;
      const dy = event.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      dragYawRef.current += dx * DRAG_YAW_SENSITIVITY;
      dragPitchRef.current = THREE.MathUtils.clamp(
        dragPitchRef.current + dy * DRAG_PITCH_SENSITIVITY,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      draggingRef.current = false;
    };
  }, [isInspected]);

  // The world-space stage transform (set once per open, see the store's own
  // doc) has to be converted into THIS group's PARENT-local space before it
  // can be assigned to `group.position`/`group.quaternion` — the group lives
  // nested inside the cabinet's own positioned/rotated/scaled group, same as
  // its shelf `position` prop already is. Computed once when inspection
  // opens for this instance, not every frame.
  const localStageRef = useRef({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
  const stageScaleRef = useRef(1);
  useEffect(() => {
    if (!isInspected) return;
    const group = groupRef.current;
    if (!group?.parent) return;
    const { stagePosition, stageQuaternion, stageScale } = useReagentInspectionStore.getState();
    const worldPos = new THREE.Vector3(...stagePosition);
    const worldQuat = new THREE.Quaternion(...stageQuaternion);
    localStageRef.current.position.copy(group.parent.worldToLocal(worldPos));
    const parentWorldQuat = new THREE.Quaternion();
    group.parent.getWorldQuaternion(parentWorldQuat);
    localStageRef.current.quaternion.copy(parentWorldQuat.invert().multiply(worldQuat));
    stageScaleRef.current = stageScale;
  }, [isInspected]);

  const homePosition = useMemo(() => new THREE.Vector3(...position), [position]);
  const homeQuaternion = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    [rotationY],
  );

  // `phaseRef` is a plain ref (not state) so it can flip inside useFrame
  // without an extra render; `wasInspectedRef` lets the effect below tell
  // "just opened" apart from "was open, now closing".
  const phaseRef = useRef<Phase>("atRest");
  const wasInspectedRef = useRef(false);
  // Deterministic TAKE tween state — start/end captured ONCE (in the effect
  // below) the instant "takeMove"/"returnFromTray" starts, never recomputed
  // mid-flight. Position/orientation lerp from `takeStart*` to `takeEnd*`;
  // scale lerps from `flightStartScaleRef` to `flightEndScaleRef` (declared
  // further below) across the same eased `t`.
  const takeElapsedRef = useRef(0);
  const takeStartPosRef = useRef(new THREE.Vector3());
  const takeStartQuatRef = useRef(new THREE.Quaternion());
  const takeEndPosRef = useRef(new THREE.Vector3());
  /**
   * The arc's control point for the tray leg — high over the tray slot, so a
   * bottle drops into its slot from above and never cuts through the stand
   * standing on the tray's other half (VL-016). See `trayArcPoint`.
   */
  const takeArcRef = useRef(new THREE.Vector3());
  const takeEndQuatRef = useRef(new THREE.Quaternion());
  const flightWorldPositionRef = useRef(new THREE.Vector3());
  const flightWorldQuaternionRef = useRef(new THREE.Quaternion());
  const flightParentWorldQuaternionRef = useRef(new THREE.Quaternion());
  const inspectionDragEulerRef = useRef(new THREE.Euler());
  const inspectionDragQuaternionRef = useRef(new THREE.Quaternion());
  const inspectionTargetQuaternionRef = useRef(new THREE.Quaternion());
  // LOCAL scale (already parent-scale-compensated) at the start/end of the
  // CURRENT flight leg — lerped every frame in "takeMove"/"returnFromTray",
  // per the user's explicit call to make the shrink/grow visible during the
  // flight instead of a one-time snap (superseding the earlier "scale must
  // never change mid-flight" rule).
  const flightStartScaleRef = useRef(1);
  const flightEndScaleRef = useRef(1);
  /** Stable `TRAY_SLOTS` index assigned at takeMove-start (see `nextFreeTraySlot`'s doc) — carried through to the `takeReagent` call at flight-end so the stored item keeps this exact slot for as long as it rides the tray. */
  const takeSlotIndexRef = useRef(0);
  useEffect(() => {
    if (isInspected && !isClosing && !isTaking) {
      phaseRef.current = "pickupLift";
      wasInspectedRef.current = true;
    } else if (isInspected && isClosing && wasInspectedRef.current) {
      phaseRef.current = "returnMove";
      wasInspectedRef.current = false;
    } else if (isInspected && isTaking && wasInspectedRef.current) {
      const group = groupRef.current;
      const parent = group?.parent;
      if (group && parent) {
        // Start: wherever it currently is (mid-inspection stage) — captured
        // as a WORLD transform so the tween below is parent-agnostic.
        group.getWorldPosition(takeStartPosRef.current);
        group.getWorldQuaternion(takeStartQuatRef.current);

        // Scale animates DURING the flight (visible shrink from the
        // inspection-stage size down to the tray's dev-tunable
        // `heldTray.reagentScale`, F8 → "Поднос в руках", now 1 — true size,
        // was 0.4) — the player asked for the shrink itself to be
        // perceptible, not an instant snap. `group` is still parented under
        // the cabinet at this instant, so the END local scale has to
        // account for the cabinet's own world scale to land on the correct
        // WORLD size — dropping this compensation made the jar land at the
        // wrong size and then visibly jump once `ReagentStaticDisplay`'s own
        // (still-compensated) `worldScale` took over. The START is whatever
        // local scale it already has (the inspection stage's ×2).
        const parentWorldScale = new THREE.Vector3();
        parent.getWorldScale(parentWorldScale);
        flightStartScaleRef.current = group.scale.x;
        flightEndScaleRef.current =
          useNavButtonCalibrationStore.getState().heldTray.reagentScale / parentWorldScale.x;

        // End: the exact final held-tray-slot WORLD pose, computed once
        // from the CURRENT camera/tray calibration — the tray is assumed
        // already settled in its held pose by the time the player presses
        // ВЗЯТЬ (it starts tracking the camera the instant the cabinet
        // becomes "inspecting", well before the player finishes looking at
        // a bottle and clicks it), so this is not a stale/moving target.
        const heldTray = useNavButtonCalibrationStore.getState().heldTray;
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const trayAnchorWorld = camera.position
          .clone()
          .addScaledVector(cameraRight, heldTray.x)
          .addScaledVector(cameraUp, heldTray.y)
          .addScaledVector(cameraForward, heldTray.z);
        // Match `LabTrayInstance` exactly: start at the cabinet's yaw, then
        // apply the user's local Rot X/Y/Z offset. The item flight must use
        // this same endpoint or it visibly twists/jumps when the static copy
        // takes over.
        const trayWorldQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          getCabinetParallelTrayYaw(cabinetId),
        ).multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(heldTray.rotX, heldTray.rotY, heldTray.rotZ, "YXZ"),
          ),
        );
        // Exact slot in the SAME modeled rack already on the tray
        // (see `computeTrayReagentPosition`'s doc) — a stable slot id, not
        // this jar's position in the tray array, so returning some OTHER
        // jar later never moves this one (see `nextFreeTraySlot`'s doc).
        const currentTrayItems = useReagentStorageStore.getState().trayItems;
        const slotIndex = nextFreeTraySlot(currentTrayItems);
        takeSlotIndexRef.current = Math.max(0, slotIndex);
        const slotLocal = traySlotLocalPosition(takeSlotIndexRef.current);
        const slotOffsetWorld = new THREE.Vector3(...slotLocal)
          .multiplyScalar(heldTray.scale)
          .applyQuaternion(trayWorldQuat);
        takeEndPosRef.current.copy(trayAnchorWorld).add(slotOffsetWorld);
        // Down into the slot from above (tray scale: it is held small, by the camera).
        takeArcRef.current.copy(takeEndPosRef.current).addScaledVector(WORLD_UP, TRAY_ARC_HEIGHT * heldTray.scale);
        takeEndQuatRef.current.copy(trayWorldQuat);
        takeElapsedRef.current = 0;
      }
      phaseRef.current = "takeMove";
      wasInspectedRef.current = false;
    }
    // `camera` (position/quaternion) is intentionally read but not a
    // dependency — it's a stable object from `useThree()`, and this effect
    // must fire exactly on the isInspected/isClosing/isTaking transition,
    // not on every camera move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInspected, isClosing, isTaking]);

  // Reverse flight: a click on the TRAY copy of THIS instance (see
  // `ReagentStaticDisplay`'s `onReturn`) captured its exact world pose and
  // asked to send it back — `takenThisSession` just went false (the store
  // action that set this also removed it from `takenByCabinet`, in the same
  // update), so this shelf original is about to render again. Snap its
  // transform to that captured pose FIRST (before this effect's own render
  // commits), so the very first visible frame is exactly where the tray
  // copy just vanished from — zero pop — then fly it back to the shelf
  // reusing the SAME tween machinery as the outbound take (deterministic
  // lerp/slerp, now also a lerped scale) via the existing lifted-waypoint +
  // "returnLower"-style final drop, so it can never clip through the shelf
  // on the way in either.
  const returnRequest = useReagentStorageStore((state) => state.returnRequest);
  useEffect(() => {
    if (returnRequest?.instanceId !== instanceId) return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (group && parent) {
      const worldPos = new THREE.Vector3(...returnRequest.worldPos);
      const worldQuat = new THREE.Quaternion(...returnRequest.worldQuat);
      const parentWorldQuat = new THREE.Quaternion();
      parent.getWorldQuaternion(parentWorldQuat);

      // Snap immediately to this WORLD pose (converted to local for the
      // group itself) so the very first visible frame is exactly where the
      // tray copy just vanished from — zero pop.
      group.position.copy(parent.worldToLocal(worldPos.clone()));
      group.quaternion.copy(parentWorldQuat.clone().invert().multiply(worldQuat));
      const parentWorldScale = new THREE.Vector3();
      parent.getWorldScale(parentWorldScale);
      // START scale for this leg is the tray size it arrives with; snapped
      // immediately (same as position/quaternion above) so the first frame
      // matches exactly where the tray copy just vanished from. END scale
      // (home, local 1) is reached by lerping across the flight below —
      // visible growth back to full size, per the same "make the scale
      // change perceptible" call as the outbound take.
      flightStartScaleRef.current = returnRequest.worldScale / parentWorldScale.x;
      flightEndScaleRef.current = 1;
      group.scale.setScalar(flightStartScaleRef.current);

      // The flight tween itself (below, in useFrame) works entirely in
      // WORLD space, same as the outbound "takeMove" — takeStartPosRef/
      // takeStartQuatRef must be the actual captured WORLD pose (NOT
      // `group.position`/`group.quaternion`, which are now LOCAL — using
      // those here was the bug that made the whole flight aim at the wrong
      // point and only snap to the correct shelf slot at the very last
      // frame, reading as "no animation, it just appears"). The END is the
      // shelf's home LOCAL transform converted to WORLD via this same
      // parent, since the shelf itself doesn't move.
      takeStartPosRef.current.copy(worldPos);
      takeStartQuatRef.current.copy(worldQuat);
      // Straight up out of the tray slot first, over whatever stands beside it.
      takeArcRef.current
        .copy(worldPos)
        .addScaledVector(WORLD_UP, TRAY_ARC_HEIGHT * useNavButtonCalibrationStore.getState().heldTray.scale);
      const liftedY = homePosition.y + PICKUP_LIFT;
      const localLiftedPos = new THREE.Vector3(homePosition.x, liftedY, homePosition.z);
      takeEndPosRef.current.copy(parent.localToWorld(localLiftedPos));
      takeEndQuatRef.current.copy(parentWorldQuat).multiply(homeQuaternion);
      takeElapsedRef.current = 0;
      phaseRef.current = "returnFromTray";
    }
    useReagentStorageStore.getState().clearReturnRequest();
  }, [returnRequest, instanceId, homePosition, homeQuaternion]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const phase = phaseRef.current;

    if (phase === "atRest") {
      group.position.x = THREE.MathUtils.damp(group.position.x, homePosition.x, MOVE_DAMPING, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, homePosition.y, MOVE_DAMPING, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, homePosition.z, MOVE_DAMPING, delta);
      group.quaternion.slerp(homeQuaternion, 1 - Math.exp(-MOVE_DAMPING * delta));
      group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, 1, MOVE_DAMPING, delta));
      return;
    }

    const liftedY = homePosition.y + PICKUP_LIFT;

    // STEP A: raise straight up only — X/Z/rotation/scale stay at the home
    // shelf transform, so this leg can never sweep sideways through
    // neighboring shelf geometry.
    if (phase === "pickupLift") {
      group.position.x = THREE.MathUtils.damp(group.position.x, homePosition.x, MOVE_DAMPING, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, liftedY, MOVE_DAMPING, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, homePosition.z, MOVE_DAMPING, delta);
      group.quaternion.slerp(homeQuaternion, 1 - Math.exp(-MOVE_DAMPING * delta));
      group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, 1, MOVE_DAMPING, delta));
      if (Math.abs(group.position.y - liftedY) < RETURN_POSITION_EPSILON) {
        group.position.y = liftedY;
        phaseRef.current = "inspecting";
      }
      return;
    }

    // Reverse of STEP A: lower straight down from the lifted waypoint onto
    // the exact original shelf transform, then snap and report done.
    if (phase === "returnLower") {
      group.position.y = THREE.MathUtils.damp(group.position.y, homePosition.y, MOVE_DAMPING, delta);
      if (Math.abs(group.position.y - homePosition.y) < RETURN_POSITION_EPSILON) {
        group.position.copy(homePosition);
        group.quaternion.copy(homeQuaternion);
        group.scale.setScalar(1);
        phaseRef.current = "atRest";
        useReagentInspectionStore.getState().finishClose();
      }
      return;
    }

    // Reverse of STEP B ("inspecting"'s move+scale-to-stage): move+shrink
    // back to the same lifted waypoint above the original slot, then hand
    // off to "returnLower". Rotation and scale converge on the home values
    // here so "returnLower" only ever has to touch Y.
    if (phase === "returnMove") {
      group.position.x = THREE.MathUtils.damp(group.position.x, homePosition.x, MOVE_DAMPING, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, liftedY, MOVE_DAMPING, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, homePosition.z, MOVE_DAMPING, delta);
      group.quaternion.slerp(homeQuaternion, 1 - Math.exp(-MOVE_DAMPING * delta));
      group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, 1, MOVE_DAMPING, delta));
      if (
        Math.abs(group.position.y - liftedY) < RETURN_POSITION_EPSILON &&
        Math.abs(group.position.x - homePosition.x) < RETURN_POSITION_EPSILON &&
        Math.abs(group.position.z - homePosition.z) < RETURN_POSITION_EPSILON
      ) {
        group.position.set(homePosition.x, liftedY, homePosition.z);
        group.quaternion.copy(homeQuaternion);
        group.scale.setScalar(1);
        phaseRef.current = "returnLower";
      }
      return;
    }

    // ВЗЯТЬ counterpart to "inspecting": a deterministic lerp/slerp from the
    // WORLD start/end transforms captured once in the effect above (see
    // `takeStart*`/`takeEnd*`) — not damping. Damping toward a target and
    // then snapping once "close enough" always corrects a non-zero residual
    // at an arbitrary moment, which is what read as a shrink-then-snap; a
    // fixed-duration tween mathematically lands exactly on the end
    // transform at t=1, so there is nothing left to correct. Scale now
    // lerps LOCALLY from `flightStartScaleRef` to `flightEndScaleRef`
    // (both captured once, in local space, at take-start) across the same
    // eased `t` as position/rotation — a visible shrink during the flight,
    // per the user's explicit request.
    if (phase === "takeMove") {
      const parent = group.parent;
      takeElapsedRef.current += delta;
      const t = THREE.MathUtils.clamp(takeElapsedRef.current / TAKE_DURATION_S, 0, 1);
      const ease = t * t * (3 - 2 * t);

      const worldPos = trayArcPoint(
        flightWorldPositionRef.current,
        takeStartPosRef.current,
        takeArcRef.current,
        takeEndPosRef.current,
        ease,
      );
      const worldQuat = flightWorldQuaternionRef.current
        .copy(takeStartQuatRef.current)
        .slerp(takeEndQuatRef.current, ease);

      group.position.copy(parent ? parent.worldToLocal(worldPos) : worldPos);
      if (parent) {
        const parentWorldQuat = flightParentWorldQuaternionRef.current;
        parent.getWorldQuaternion(parentWorldQuat);
        group.quaternion.copy(parentWorldQuat.invert().multiply(worldQuat));
      } else {
        group.quaternion.copy(worldQuat);
      }
      group.scale.setScalar(THREE.MathUtils.lerp(flightStartScaleRef.current, flightEndScaleRef.current, ease));

      if (t >= 1) {
        phaseRef.current = "atRest";
        if (cabinetId) {
          useReagentStorageStore.getState().takeReagent(cabinetId, {
            instanceId,
            reagentId: reagent.id,
            containerType: reagent.containerType,
            cabinetId,
            slotIndex: takeSlotIndexRef.current,
          });
        }
        useReagentInspectionStore.getState().finishTake();
      }
      return;
    }

    // ВЗЯТЬ's mirror image: a click on the tray copy (see `ReagentStaticDisplay`'s
    // `onReturn`) sent it back. Same deterministic lerp/slerp as "takeMove",
    // and now the same visible scale lerp too (tray size → local 1, see the
    // return-request effect above), landing on the SAME lifted waypoint
    // "pickupLift"/"returnMove" already use, then handing off to
    // "returnFromTrayLower" for the final vertical drop — so this can never
    // clip through the shelf on the way in either.
    if (phase === "returnFromTray") {
      const parent = group.parent;
      takeElapsedRef.current += delta;
      const t = THREE.MathUtils.clamp(takeElapsedRef.current / TAKE_DURATION_S, 0, 1);
      const ease = t * t * (3 - 2 * t);

      const worldPos = trayArcPoint(
        flightWorldPositionRef.current,
        takeStartPosRef.current,
        takeArcRef.current,
        takeEndPosRef.current,
        ease,
      );
      const worldQuat = flightWorldQuaternionRef.current
        .copy(takeStartQuatRef.current)
        .slerp(takeEndQuatRef.current, ease);

      group.position.copy(parent ? parent.worldToLocal(worldPos) : worldPos);
      if (parent) {
        const parentWorldQuat = flightParentWorldQuaternionRef.current;
        parent.getWorldQuaternion(parentWorldQuat);
        group.quaternion.copy(parentWorldQuat.invert().multiply(worldQuat));
      } else {
        group.quaternion.copy(worldQuat);
      }
      group.scale.setScalar(THREE.MathUtils.lerp(flightStartScaleRef.current, flightEndScaleRef.current, ease));

      if (t >= 1) {
        // Reuse the SAME elapsed-time ref for the next leg's own eased
        // tween — "returnFromTray" is done with it, and this avoids one
        // more ref just for a second, mutually-exclusive phase.
        takeElapsedRef.current = 0;
        phaseRef.current = "returnFromTrayLower";
      }
      return;
    }

    // Final leg of the return-from-tray flight: reverse of "pickupLift",
    // straight down onto the shelf — an eased tween (not damping, see
    // `TAKE_LOWER_DURATION_S`'s doc) from wherever "returnFromTray" landed
    // (`liftedY`) to the exact home Y, then snap to the exact home
    // transform. Deliberately NOT `finishClose()` (that's the
    // inspection-close flow's own bookkeeping, not applicable here) — the
    // store side of a tray return was already fully applied (item removed
    // from `trayItems` and `takenByCabinet`) back when the click happened.
    if (phase === "returnFromTrayLower") {
      takeElapsedRef.current += delta;
      const t = THREE.MathUtils.clamp(takeElapsedRef.current / TAKE_LOWER_DURATION_S, 0, 1);
      const ease = t * t * (3 - 2 * t);
      group.position.y = THREE.MathUtils.lerp(liftedY, homePosition.y, ease);
      if (t >= 1) {
        group.position.copy(homePosition);
        group.quaternion.copy(homeQuaternion);
        group.scale.setScalar(1);
        phaseRef.current = "atRest";
      }
      return;
    }

    // phase === "inspecting"
    const dragQuat = inspectionDragQuaternionRef.current.setFromEuler(
      inspectionDragEulerRef.current.set(dragPitchRef.current, dragYawRef.current, 0, "YXZ"),
    );
    const targetQuat = inspectionTargetQuaternionRef.current
      .copy(localStageRef.current.quaternion)
      .multiply(dragQuat);
    const targetPos = localStageRef.current.position;
    const ready = group.position.distanceTo(targetPos) < 0.005 &&
      group.quaternion.angleTo(targetQuat) < 0.005 &&
      Math.abs(group.scale.x - stageScaleRef.current) < 0.005;
    if (updateSlosh(group, camera, delta, ready)) {
      draggingRef.current = false;
      return;
    }
    group.position.x = THREE.MathUtils.damp(group.position.x, targetPos.x, MOVE_DAMPING, delta);
    group.position.y = THREE.MathUtils.damp(group.position.y, targetPos.y, MOVE_DAMPING, delta);
    group.position.z = THREE.MathUtils.damp(group.position.z, targetPos.z, MOVE_DAMPING, delta);
    group.quaternion.slerp(targetQuat, 1 - Math.exp(-MOVE_DAMPING * delta));
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, stageScaleRef.current, MOVE_DAMPING, delta));
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (anyInspected) return; // only one reagent inspected at a time
    if (useTestTubeDragStore.getState().heldInstanceId !== null) return;
    const group = groupRef.current;
    if (!group) return;
    // Camera-relative, dev-calibrated stage offset (F9 panel, "INSPECTION
    // BOTTLE POSITION") instead of a fixed forward distance + per-type
    // scale table — X/Y are along the camera's own right/up axes, Z is the
    // forward distance, so one calibrated value reproduces the exact same
    // framing for every reagent/cabinet instead of being recomputed from
    // wherever the click's camera pose happens to be.
    const bottle = useNavButtonCalibrationStore.getState().inspectionBottle;
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const stagePos = camera.position
      .clone()
      .addScaledVector(cameraRight, bottle.x)
      .addScaledVector(cameraUp, bottle.y)
      .addScaledVector(cameraForward, bottle.z);
    // Deriving a "face the camera" orientation from `camera.quaternion` (an
    // earlier version did `camera.quaternion * rotateY(180°)`) put the
    // label ~90° off to the side instead — verified visually (the label
    // only entered view at the edge of a full ±75° drag). The shelf's own
    // `rotationY: Math.PI` placement ALREADY faces the container's label
    // toward the room/inspecting camera (every uninspected neighbor reads
    // fine), and the inspecting camera by construction always looks AT that
    // same cabinet from that same "outward" side — so the simplest correct
    // answer is to just keep the container's current WORLD orientation
    // as-is when it lifts off the shelf, not re-derive a new one.
    const stageQuat = new THREE.Quaternion();
    group.getWorldQuaternion(stageQuat);
    const stageScale = bottle.scale;
    useReagentInspectionStore
      .getState()
      .open(
        instanceId,
        [stagePos.x, stagePos.y, stagePos.z],
        [stageQuat.x, stageQuat.y, stageQuat.z, stageQuat.w],
        stageScale,
      );
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!isInspected || useReagentInspectionStore.getState().isShaking) return;
    event.stopPropagation();
    draggingRef.current = true;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
  };

  // A fresh `[0, rotationY, 0]` array literal every render would make R3F
  // re-apply `group.rotation` on every re-render this component gets (e.g.
  // the `hovered` state toggling) — fighting the imperative quaternion
  // damping in `useFrame` above. Memoized so it's only re-applied if
  // `rotationY` itself actually changes.
  const homeRotationArray = useMemo(() => [0, rotationY, 0] as const, [rotationY]);

  // Taken during THIS cabinet session — stop rendering the shelf original
  // entirely (its static tray/workbench copy is a separate component). All
  // hooks above still ran unconditionally; only the JSX output is
  // conditional, which is the correct place for this per React's rules.
  // `ReagentCabinetInstance` resets `cabinetId`'s taken-set on fresh focus,
  // which flips this back to false and this group mounts fresh again (React
  // recreates the underlying Three.js object with `position`/`rotation`
  // straight from props), so the shelf shows original stock with no manual
  // transform reset needed here.
  // Hover: the silhouette outline round the bottle (`NormalHoverOutline`) — its glass, and its cap while on it.
  useNormalHoverOutline({ root: instance, active: hovered && !anyInspected, container: true });

  if (takenThisSession) return null;

  return (
    <group
      ref={groupRef}
      // Found by `InspectionDepthOfField` to draw this bottle sharp over the blurred lab while inspected.
      userData={{ inspectionId: instanceId }}
      position={position}
      rotation={homeRotationArray}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerOver={(event) => {
        event.stopPropagation();
        if (!anyInspected && !tubeHeld) setHovered(true);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(false);
      }}
    >
      {/* Hover: the silhouette outline (`NormalHoverOutline`, above). */}
      <primitive object={instance} />
      {/* The ONLY raycast target for this group (see `createHoverHitboxGeometry`'s
          doc) — `instance`'s own meshes had raycasting disabled above. Never
          drawn (its material's `visible`), but the mesh itself stays visible:
          R3F skips non-visible objects for pointer events entirely. */}
      <mesh geometry={hoverHitboxGeometry}>
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
