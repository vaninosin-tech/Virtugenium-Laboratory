import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  buildControlPanelTexture,
  DOWN_ZONE_UV,
  UP_ZONE_UV,
  ZONE_UV_X_RANGE,
} from "./buildControlPanelTexture";
import { CABINET_SCALE, type HotspotTargetId } from "./layout";
import { loadControlPanelFonts } from "./loadControlPanelFonts";
import { remapPlanarUV } from "./remapPlanarUV";
import { useCabinetPageStore } from "./useCabinetPageStore";
import { useSceneInteractionStore } from "./useSceneInteractionStore";

/**
 * Coordinated open/close animation for one `ReagentCabinetInstance`, driving
 * the cabinet's own existing nodes — verified against
 * `ReagentCabinet_MASTER.blend` before writing this (not guessed):
 *
 * - `Door_Left` / `Door_Right`: each door's own local origin already sits
 *   exactly on its real hinge line (confirmed by the `Hinges`/`Hinges.001`
 *   child meshes and each door's position relative to its side post) — no
 *   pivot-hierarchy fix was needed. Rotating each node's own Y axis swings
 *   it around that real hinge.
 * - `ChangeShutter` + `Shutter_BottomBar`: the shutter is not one mesh —
 *   `Shutter_BottomBar` is a separate node sitting exactly at the panel's
 *   bottom edge (an end-cap/trim piece), on the same `ShutterSystem`
 *   parent. Both move by the same delta so the assembly stays rigid.
 *   `Shutter_Guide_Left/Right`, `Shutter_Housing`, `Shutter_Motor_Left`,
 *   `Shutter_Roller` are the fixed rail/mechanism and are never moved.
 * - Concealment: the shutter panel (~1.21 m tall) is a rigid mesh that
 *   can't roll up, and is close to the cabinet's own 2.0 m height, so
 *   sliding it clear of the glass by pure translation alone necessarily
 *   pushed its top visibly above the cabinet — the bug this pass fixes.
 *   The fix is a `THREE.Plane` local-clipping boundary (see
 *   `SHUTTER_CLIP_PLANE` below), not a smaller translation: clipping
 *   doesn't reduce how far the rigid mesh has to travel to fully clear the
 *   boundary (if anything the fully-correct travel is slightly *more* than
 *   the old value, since the old 1.0 never actually got the panel's own
 *   bottom edge past the housing — see `SHUTTER_TRAVEL_LOCAL`), but it
 *   means that whatever part of the mesh is above the boundary at any
 *   point during the motion is *invisible* instead of visibly floating
 *   above the cabinet, which is what actually made it look broken.
 * - `Page_Display` (inside `ControlPanel`) uses `MAT_ControlPanel_Display`
 *   — a near-black-by-default screen material, confirmed via the glb's own
 *   material data, ready to receive an emissive "powered on" look.
 */

/**
 * Total open/close duration — was 1200ms (itself slowed from an original
 * 900ms so the shutter read as a controlled mechanical glide rather than a
 * snap), cut by 35% (×0.65) per a later request to make cabinet interaction
 * feel snappier. The phase fractions below are unaffected — they're
 * fractions of this total, so scaling it alone speeds up the whole
 * doors→panel→shutter choreography proportionally without changing its
 * relative pacing. Exported so `CameraRig`'s chain-switch flow can wait out
 * a cabinet's full close animation before flying to the next one, instead
 * of guessing a duration that could drift out of sync with this file's own
 * choreography.
 */
export const TOTAL_DURATION_MS = 780;

// Phase fractions of TOTAL_DURATION_MS. Strictly sequential (not the old
// overlapping shutter/doors/panel spans) per the requested choreography:
// doors swing open first (0.00-0.48s), then the panel lights up
// (0.48-0.66s), and only once that's done does the shutter start gliding
// clear (0.66-1.20s). Reversed automatically on close: `progress` is one
// shared timeline scrubbed backward when `isOpen` flips false, so whichever
// phase sits last while opening is the first to move while closing —
// shutter closes first, then the panel goes dark, then the doors swing
// shut — without a separate closing-order implementation.
const DOOR_PROGRESS_START = 0;
const DOOR_PROGRESS_END = 0.4;
const PANEL_PROGRESS_START = 0.4;
const PANEL_PROGRESS_END = 0.55;
const SHUTTER_PROGRESS_START = 0.55;
const SHUTTER_PROGRESS_END = 1.0;

/**
 * Raised from 95° to 118° for the inspection-camera framing pass — at 95°
 * the doors still swung mostly toward the camera and read as huge side
 * planes; at 118° they fold back much closer to the side posts, reading as
 * narrow framing elements instead. Checked in Blender first for collisions
 * (not guessed): at 118° `Frame`/`Frame.001` stay within
 * `SidePost_Left`/`SidePost_Right`'s own X footprint (no swing past the
 * post toward the wall) and their forward (Y) protrusion is comparable to
 * — not worse than — the old 95° angle, so there's no new wall or
 * neighboring-cabinet collision risk versus the previous angle.
 */
const DOOR_OPEN_ANGLE = THREE.MathUtils.degToRad(118);

/**
 * All measured directly in `ReagentCabinet_MASTER.blend` (cabinet-root
 * local space, unscaled — the outer `<group scale={CABINET_SCALE}>` in
 * `ReagentCabinetInstance` applies scale above this whole hierarchy, so
 * everything here stays in the asset's own native units):
 *
 * - Shutter closed: bottom edge at Y=0.66, top edge at Y=1.87 (world bbox,
 *   verified via `Frame`/`Glass`/`ChangeShutter` bounds).
 * - `Shutter_Housing`: Y 1.825–1.885 (verified world bbox) — the visible
 *   trim strip the shutter should appear to feed into.
 *
 * `SHUTTER_CLIP_LOCAL_Y` sits 5mm above the shutter's own closed top
 * (1.875), inside the housing's own Y range — clipping starts only once
 * geometry has actually reached the housing, and guarantees zero clipping
 * of the panel at rest (closed state renders identically to before this
 * pass).
 *
 * `SHUTTER_TRAVEL_LOCAL` is set so the panel's *bottom* edge clears the
 * clip boundary with a 30mm margin at full travel (0.66 + travel ≥
 * 1.875 + 0.03), guaranteeing the entire rigid mesh is on the clipped side
 * once fully open — this is why it's 1.25, not smaller than the old 1.0:
 * the old value undershot the real boundary, which is the actual bug.
 */
const SHUTTER_CLIP_LOCAL_Y = 1.875;
const SHUTTER_TRAVEL_LOCAL = 1.25;

const PANEL_EMISSIVE_OFF = 0;
const PANEL_EMISSIVE_ON = 0.6;
const PANEL_EMISSIVE_COLOR = new THREE.Color("#5fd7ff");

/**
 * Isolated placeholder — there's no real cabinet-temperature system in the
 * project yet (confirmed: nothing named "temperature" anywhere in `src/`).
 * Kept as this one constant specifically so a future real source only has
 * to replace this line, not touch the drawing/redraw plumbing below.
 */
const PLACEHOLDER_TEMPERATURE_C = 22.0;

/**
 * Clipping planes are evaluated in world space, and this one is identical
 * for every cabinet instance regardless of position: all four sit at
 * world Y=0 (floor) with the same `CABINET_SCALE`, and the plane is a pure
 * Y-height cut, so cabinet X/Z position and the ±90° `rotationY` (a
 * rotation *around* Y) never move it. One shared `THREE.Plane` is safe to
 * reference from every cabinet's own cloned `MAT_Shutter` instance.
 *
 * Normal (0,-1,0) with this constant keeps geometry where
 * `-y + SHUTTER_CLIP_LOCAL_Y*CABINET_SCALE > 0`, i.e. `y < clip world Y` —
 * below the boundary stays visible, at/above it is clipped away.
 */
const SHUTTER_CLIP_PLANE = new THREE.Plane(new THREE.Vector3(0, -1, 0), SHUTTER_CLIP_LOCAL_Y * CABINET_SCALE);

/** easeInOutQuint — used for doors/panel; more "settle" at both ends than cubic. */
function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - (-2 * t + 2) ** 5 / 2;
}

/** easeInOutCubic — gentler than quint, requested specifically for the shutter so most of its travel doesn't happen too suddenly. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

type TouchZone = "up" | "down" | null;

/** Resolves a raycast-hit UV coordinate on `Page_Display` to a virtual touch zone, using the same thresholds the screen was actually drawn with. */
function resolveTouchZone(uv: THREE.Vector2): TouchZone {
  if (uv.x < ZONE_UV_X_RANGE.min || uv.x > ZONE_UV_X_RANGE.max) return null;
  if (uv.y >= UP_ZONE_UV.min && uv.y <= UP_ZONE_UV.max) return "up";
  if (uv.y >= DOWN_ZONE_UV.min && uv.y <= DOWN_ZONE_UV.max) return "down";
  return null;
}

interface ScreenDrawState {
  currentPage: number;
  totalPages: number;
  upHover: boolean;
  upPressed: boolean;
  downHover: boolean;
  downPressed: boolean;
  fontsReady: boolean;
}

function sameDrawState(a: ScreenDrawState, b: ScreenDrawState): boolean {
  return (
    a.currentPage === b.currentPage &&
    a.totalPages === b.totalPages &&
    a.upHover === b.upHover &&
    a.upPressed === b.upPressed &&
    a.downHover === b.downHover &&
    a.downPressed === b.downPressed &&
    a.fontsReady === b.fontsReady
  );
}

interface DoorRig {
  doorLeft: THREE.Object3D | null;
  doorRight: THREE.Object3D | null;
  shutter: THREE.Object3D | null;
  shutterClosedPosition: THREE.Vector3;
  shutterBottomBar: THREE.Object3D | null;
  shutterBottomBarClosedPosition: THREE.Vector3;
  panelMaterial: THREE.MeshStandardMaterial | null;
  lastDrawState: ScreenDrawState | null;
}

/** The mesh name `ReagentCabinetInstance`'s pointer handlers check `event.object.name` against — exported so the two files can't drift apart. */
export const CONTROL_PANEL_SCREEN_MESH_NAME = "Page_Display";

export interface ControlPanelScreenHandlers {
  readonly handlePointerMove: (uv: THREE.Vector2 | undefined) => void;
  readonly handlePointerLeave: () => void;
  readonly handlePointerDown: (uv: THREE.Vector2 | undefined) => void;
  readonly handlePointerUp: () => void;
}

/**
 * `progress` starts at 0 (closed) regardless of `isOpen`'s initial value —
 * cabinets always mount closed, matching "contents remain visually behind
 * the closed doors/shutter" until a player opens one.
 *
 * The `Page_Display` and `MAT_Shutter` materials are cloned once per
 * cabinet instance here (rather than mutated in place) — `scene.clone(true)`
 * in `ReagentCabinetInstance` clones the node hierarchy but not materials,
 * so four cabinet clones would otherwise share one material instance each
 * (every cabinet's screen lighting up together, or — less consequentially
 * here, since the plane itself is identical per instance anyway, but still
 * the correct defensive pattern — one shared clipped shutter material).
 * The screen's own canvas UI is the same story: its own `emissiveMap` is a
 * per-instance `CanvasTexture`, and its own `screenState` ref, so opening
 * one cabinet can never show — or let a click affect — another cabinet's
 * page/hover/press state.
 *
 * `Button_Previous`/`Button_Next` (and their icon children) are hidden
 * rather than deleted or renamed — the new canvas UI draws its own ▲/▼
 * touch zones directly on `Page_Display`, replacing their visual role, but
 * nothing in this project currently reads those two nodes at runtime
 * (confirmed), so keeping-but-hiding is the conservative choice: if a
 * future pass ever does need them, the nodes are still there under their
 * original names.
 */
export function useCabinetDoorAnimation(
  instance: THREE.Object3D,
  isOpen: boolean,
  cabinetId: HotspotTargetId,
  totalPages: number,
): ControlPanelScreenHandlers {
  const rig = useRef<DoorRig | null>(null);
  const progress = useRef(0);
  const currentPage = useCabinetPageStore((state) => state.currentPageById[cabinetId] ?? 1);
  const nextPage = useCabinetPageStore((state) => state.nextPage);
  const previousPage = useCabinetPageStore((state) => state.previousPage);

  // Canvas `fillText` silently falls back to a default font if the
  // requested `@font-face` family isn't loaded yet — there's no automatic
  // re-draw once it becomes available, so `fontsReady` flipping true must
  // trigger a redraw (see the effect below), same pattern as the category
  // label's own font gate.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadControlPanelFonts().then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const doorLeft = findByName(instance, "Door_Left");
    const doorRight = findByName(instance, "Door_Right");
    const shutter = findByName(instance, "ChangeShutter") as THREE.Mesh | null;
    const shutterBottomBar = findByName(instance, "Shutter_BottomBar") as THREE.Mesh | null;
    const display = findByName(instance, "Page_Display") as THREE.Mesh | null;

    // The physical buttons' visual role is fully replaced by the new
    // screen UI's own drawn ▲/▼ zones — hidden, not deleted/renamed, since
    // nothing at runtime currently depends on these two nodes existing
    // (verified), but a future pass might.
    for (const name of ["Button_Previous", "Button_Previous_Icon", "Button_Next", "Button_Next_Icon"]) {
      const node = findByName(instance, name);
      if (node) node.visible = false;
    }

    let panelMaterial: THREE.MeshStandardMaterial | null = null;
    let initialDrawState: ScreenDrawState | null = null;
    if (display && display.material) {
      // Same packed box-UV issue as CategoryLabelPlate (verified — Page_Display
      // shares the identical UV pattern in the glb's accessor data), and
      // the same fix: a clean front-face projection before applying the
      // custom texture. Page_Display's raw geometry is an unscaled unit
      // cube sharing all-equal extents (verified from the glb's own
      // accessor data), so its thin axis only resolves correctly once node
      // scale is factored in. Re-verified after the right-side redesign
      // (new flush, zero-rotation mounting, different proportions): the
      // runtime (THREE.js-space) scale swaps Blender's own Y/Z during
      // export, and `swapUV=true` is still the correct choice — confirmed
      // in-browser with the actual canvas UI (temperature/arrows/counter)
      // rendering upright and correctly oriented, not guessed from the old
      // geometry's reasoning. The same remap (and the same UV convention it
      // produces) is what the interaction hit-test in `resolveTouchZone`
      // relies on for `event.uv` to line up with what was actually drawn.
      remapPlanarUV(display, true, false, true);
      const cloned = (display.material as THREE.MeshStandardMaterial).clone();
      initialDrawState = {
        currentPage,
        totalPages,
        upHover: false,
        upPressed: false,
        downHover: false,
        downPressed: false,
        fontsReady,
      };
      cloned.emissive = PANEL_EMISSIVE_COLOR.clone();
      cloned.emissiveIntensity = PANEL_EMISSIVE_OFF;
      cloned.emissiveMap = buildControlPanelTexture({
        temperatureC: PLACEHOLDER_TEMPERATURE_C,
        ...initialDrawState,
      });
      display.material = cloned;
      panelMaterial = cloned;
    }

    // Both ChangeShutter and Shutter_BottomBar exclusively use MAT_Shutter
    // (confirmed — no other mesh references it), so cloning once per node
    // and applying the shared clip plane to each affects only this
    // cabinet's shutter assembly, never doors/shelves/panel/guides/housing.
    for (const mesh of [shutter, shutterBottomBar]) {
      if (mesh && mesh.material) {
        const cloned = (mesh.material as THREE.MeshStandardMaterial).clone();
        cloned.clippingPlanes = [SHUTTER_CLIP_PLANE];
        mesh.material = cloned;
      }
    }

    rig.current = {
      doorLeft,
      doorRight,
      shutter,
      shutterClosedPosition: shutter ? shutter.position.clone() : new THREE.Vector3(),
      shutterBottomBar,
      shutterBottomBarClosedPosition: shutterBottomBar ? shutterBottomBar.position.clone() : new THREE.Vector3(),
      panelMaterial,
      lastDrawState: initialDrawState,
    };
    progress.current = 0;

    return () => {
      panelMaterial?.emissiveMap?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  /** Rebuilds the screen texture only if the effective drawn state actually changed — the "don't redraw every frame" requirement, applied to every redraw path (page change, hover, press, font-ready), not just the page-count one this replaces. */
  function redrawScreenIfChanged(next: ScreenDrawState) {
    const current = rig.current;
    if (!current?.panelMaterial) return;
    if (current.lastDrawState && sameDrawState(current.lastDrawState, next)) return;

    const oldTexture = current.panelMaterial.emissiveMap;
    const texture = buildControlPanelTexture({ temperatureC: PLACEHOLDER_TEMPERATURE_C, ...next });
    Object.assign(current.panelMaterial, { emissiveMap: texture, needsUpdate: true });
    oldTexture?.dispose();
    current.lastDrawState = next;
  }

  // Page/total/font-driven redraw — deliberately excludes hover/press
  // (those redraw imperatively from the pointer handlers below, not via a
  // React effect, so a hover/press flip feels instant rather than waiting
  // on a render pass).
  useEffect(() => {
    const current = rig.current;
    if (!current?.lastDrawState) return;
    redrawScreenIfChanged({
      ...current.lastDrawState,
      currentPage,
      totalPages,
      fontsReady,
    });
  }, [currentPage, totalPages, fontsReady]);

  // Closing (or losing) the cabinet clears any stuck hover/press highlight
  // so reopening it never starts mid-highlighted.
  useEffect(() => {
    if (isOpen) return;
    const current = rig.current;
    if (!current?.lastDrawState) return;
    redrawScreenIfChanged({ ...current.lastDrawState, upHover: false, upPressed: false, downHover: false, downPressed: false });
  }, [isOpen]);

  /** Only the cabinet actually being inspected right now should respond to pointer events on its screen. */
  function isScreenInteractive(): boolean {
    if (!isOpen) return false;
    const state = useSceneInteractionStore.getState();
    return state.cabinetPhase === "inspecting" && state.focusedCabinetId === cabinetId;
  }

  /**
   * Standard CSS cursor swap, not a second cursor system — only for zones
   * that would actually do something on click (a disabled arrow shouldn't
   * invite a click). `document.body.style.cursor` isn't touched anywhere
   * else in the scene (verified), so this can't fight another controller.
   */
  function updateCursor(zone: TouchZone) {
    const current = rig.current;
    const actionable =
      (zone === "up" && currentPage > 1) || (zone === "down" && currentPage < totalPages);
    document.body.style.cursor = actionable && current ? "pointer" : "";
  }

  function handlePointerMove(uv: THREE.Vector2 | undefined) {
    const current = rig.current;
    if (!current?.lastDrawState) return;
    if (!uv || !isScreenInteractive()) {
      handlePointerLeave();
      return;
    }
    const zone = resolveTouchZone(uv);
    updateCursor(zone);
    redrawScreenIfChanged({
      ...current.lastDrawState,
      upHover: zone === "up",
      downHover: zone === "down",
      // A hover that moves off a zone implicitly releases any press on it —
      // there's no separate mouseup-outside-target event to catch that.
      upPressed: current.lastDrawState.upPressed && zone === "up",
      downPressed: current.lastDrawState.downPressed && zone === "down",
    });
  }

  function handlePointerLeave() {
    const current = rig.current;
    updateCursor(null);
    if (!current?.lastDrawState) return;
    if (!current.lastDrawState.upHover && !current.lastDrawState.downHover) return;
    redrawScreenIfChanged({ ...current.lastDrawState, upHover: false, upPressed: false, downHover: false, downPressed: false });
  }

  function handlePointerDown(uv: THREE.Vector2 | undefined) {
    const current = rig.current;
    if (!current?.lastDrawState || !uv || !isScreenInteractive()) return;
    const zone = resolveTouchZone(uv);
    if (zone === "up" && currentPage > 1) {
      previousPage(cabinetId, totalPages);
      redrawScreenIfChanged({ ...current.lastDrawState, upHover: true, upPressed: true });
    } else if (zone === "down" && currentPage < totalPages) {
      nextPage(cabinetId, totalPages);
      redrawScreenIfChanged({ ...current.lastDrawState, downHover: true, downPressed: true });
    }
  }

  function handlePointerUp() {
    const current = rig.current;
    if (!current?.lastDrawState) return;
    if (!current.lastDrawState.upPressed && !current.lastDrawState.downPressed) return;
    redrawScreenIfChanged({ ...current.lastDrawState, upPressed: false, downPressed: false });
  }

  useFrame((_, delta) => {
    const current = rig.current;
    if (!current) return;

    const rate = 1000 / TOTAL_DURATION_MS;
    const direction = isOpen ? 1 : -1;
    progress.current = THREE.MathUtils.clamp(progress.current + direction * rate * delta, 0, 1);
    const p = progress.current;

    const shutterEase = easeInOutCubic(
      THREE.MathUtils.clamp((p - SHUTTER_PROGRESS_START) / (SHUTTER_PROGRESS_END - SHUTTER_PROGRESS_START), 0, 1),
    );
    const doorEase = easeInOutQuint(
      THREE.MathUtils.clamp((p - DOOR_PROGRESS_START) / (DOOR_PROGRESS_END - DOOR_PROGRESS_START), 0, 1),
    );
    const panelEase = easeInOutQuint(
      THREE.MathUtils.clamp((p - PANEL_PROGRESS_START) / (PANEL_PROGRESS_END - PANEL_PROGRESS_START), 0, 1),
    );

    if (current.shutter) {
      const base = current.shutterClosedPosition;
      current.shutter.position.set(base.x, base.y + shutterEase * SHUTTER_TRAVEL_LOCAL, base.z);
    }
    if (current.shutterBottomBar) {
      const base = current.shutterBottomBarClosedPosition;
      current.shutterBottomBar.position.set(base.x, base.y + shutterEase * SHUTTER_TRAVEL_LOCAL, base.z);
    }
    if (current.doorLeft) {
      current.doorLeft.rotation.set(0, doorEase * DOOR_OPEN_ANGLE, 0);
    }
    if (current.doorRight) {
      current.doorRight.rotation.set(0, -doorEase * DOOR_OPEN_ANGLE, 0);
    }
    if (current.panelMaterial) {
      const targetIntensity = PANEL_EMISSIVE_OFF + panelEase * (PANEL_EMISSIVE_ON - PANEL_EMISSIVE_OFF);
      if (current.panelMaterial.emissiveIntensity !== targetIntensity) {
        current.panelMaterial.emissiveIntensity = targetIntensity;
      }
    }
  });

  return { handlePointerMove, handlePointerLeave, handlePointerDown, handlePointerUp };
}
