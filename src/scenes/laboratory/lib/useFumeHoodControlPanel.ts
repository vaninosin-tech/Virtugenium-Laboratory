import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  buildFumeHoodControlPanelTexture,
  FAN_ZONE_UV,
  LIGHT_ZONE_UV,
  ZONE_UV_X_RANGE,
} from "./buildFumeHoodControlPanelTexture";
import type { HotspotTargetId } from "./layout";
import { loadControlPanelFonts } from "./loadControlPanelFonts";
import { remapPlanarUV } from "./remapPlanarUV";
import { useFumeHoodControlsStore } from "./useFumeHoodControlsStore";
import { useSceneInteractionStore } from "./useSceneInteractionStore";

/**
 * Constant, not animated — unlike the reagent cabinets' screen (which fades
 * in as the cabinet doors/shutter open), the fume hood has no open/close
 * cycle to synchronize with. A modern HMI panel reads as always-powered.
 */
const PANEL_EMISSIVE_INTENSITY = 0.55;
/**
 * Neutral white, not a single accent tint — this panel draws two different
 * accent hues itself (cyan for the fan, warm amber for the light), so the
 * emissive tint must not bias either one the way the reagent cabinet's
 * single-accent `PANEL_EMISSIVE_COLOR` intentionally does for its screen.
 */
const PANEL_EMISSIVE_COLOR = new THREE.Color("#ffffff");

/** A full turn every 6s while the fan is ON — the in-game equivalent of the approved design mockup's spinning-fan CSS animation. */
const FAN_ROTATION_SPEED = (2 * Math.PI) / 6;
/** Throttles how often the spinning fan rebuilds/re-uploads its canvas texture — redrawing every render frame for a slow spin is wasted GPU work; ~20 draws/sec still reads as smooth continuous motion. */
const FAN_REDRAW_INTERVAL_S = 1 / 20;

/** The mesh name pointer handlers in `FumeHood.tsx` check `event.object.name` against. */
export const FUME_HOOD_SCREEN_MESH_NAME = "Page_Display";

type TouchZone = "fan" | "light" | null;

/** Resolves a raycast-hit UV coordinate on `Page_Display` to a virtual touch zone, using the same thresholds the screen was actually drawn with. */
function resolveTouchZone(uv: THREE.Vector2): TouchZone {
  if (uv.x < ZONE_UV_X_RANGE.min || uv.x > ZONE_UV_X_RANGE.max) return null;
  if (uv.y >= FAN_ZONE_UV.min && uv.y <= FAN_ZONE_UV.max) return "fan";
  if (uv.y >= LIGHT_ZONE_UV.min && uv.y <= LIGHT_ZONE_UV.max) return "light";
  return null;
}

interface ScreenDrawState {
  fanOn: boolean;
  fanHover: boolean;
  fanPressed: boolean;
  fanRotation: number;
  lightOn: boolean;
  lightHover: boolean;
  lightPressed: boolean;
  fontsReady: boolean;
}

function sameDrawState(a: ScreenDrawState, b: ScreenDrawState): boolean {
  return (
    a.fanOn === b.fanOn &&
    a.fanHover === b.fanHover &&
    a.fanPressed === b.fanPressed &&
    a.fanRotation === b.fanRotation &&
    a.lightOn === b.lightOn &&
    a.lightHover === b.lightHover &&
    a.lightPressed === b.lightPressed &&
    a.fontsReady === b.fontsReady
  );
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

interface PanelRig {
  panelMaterial: THREE.MeshStandardMaterial | null;
  lastDrawState: ScreenDrawState | null;
}

export interface FumeHoodControlPanelHandlers {
  readonly handlePointerMove: (uv: THREE.Vector2 | undefined) => void;
  readonly handlePointerLeave: () => void;
  readonly handlePointerDown: (uv: THREE.Vector2 | undefined) => void;
  readonly handlePointerUp: () => void;
}

/**
 * Wires the fume hood's `Page_Display` mesh — the same donor plate
 * mesh/UVs as the reagent cabinets' screen (identical scale confirmed from
 * the glb's own node data) — to a decorative two-button touch panel: СВЕТ
 * (light) on top, ВЫТЯЖКА (extraction fan) below. Toggling either button
 * flips its own drawn ON/OFF state in `useFumeHoodControlsStore`; neither
 * has any simulated effect elsewhere in the scene, though `CameraRig`'s
 * staged fume-hood approach also drives both during its scripted
 * power-on intro (see `setFan`/`setLight` there).
 */
export function useFumeHoodControlPanel(
  instance: THREE.Object3D,
  fumeHoodId: HotspotTargetId,
): FumeHoodControlPanelHandlers {
  const rig = useRef<PanelRig | null>(null);
  const fanOn = useFumeHoodControlsStore((state) => state.fanOnById[fumeHoodId] ?? false);
  const lightOn = useFumeHoodControlsStore((state) => state.lightOnById[fumeHoodId] ?? false);
  const toggleFan = useFumeHoodControlsStore((state) => state.toggleFan);
  const toggleLight = useFumeHoodControlsStore((state) => state.toggleLight);

  // Same lazy-load-then-rebuild race as the reagent cabinets' screen — canvas
  // `fillText` silently falls back to a system font if the webfont isn't
  // loaded yet, with no automatic redraw once it becomes available.
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
    const display = findByName(instance, FUME_HOOD_SCREEN_MESH_NAME) as THREE.Mesh | null;

    let panelMaterial: THREE.MeshStandardMaterial | null = null;
    let initialDrawState: ScreenDrawState | null = null;
    if (display && display.material) {
      // With the reagent cabinets' own flipU=true, the fume hood's screen
      // text rendered mirrored (reported after the first in-game check) —
      // this asset reads its local U axis backwards relative to that donor
      // mesh, the same asset-specific quirk `FumeHood_Header`'s plaque
      // already has (see `FumeHood.tsx`), so this call flips the opposite way.
      remapPlanarUV(display, false, false, true);
      const cloned = (display.material as THREE.MeshStandardMaterial).clone();
      initialDrawState = {
        fanOn,
        fanHover: false,
        fanPressed: false,
        fanRotation: 0,
        lightOn,
        lightHover: false,
        lightPressed: false,
        fontsReady,
      };
      cloned.emissive = PANEL_EMISSIVE_COLOR.clone();
      cloned.emissiveIntensity = PANEL_EMISSIVE_INTENSITY;
      cloned.emissiveMap = buildFumeHoodControlPanelTexture(initialDrawState);
      display.material = cloned;
      panelMaterial = cloned;
    }

    rig.current = { panelMaterial, lastDrawState: initialDrawState };

    return () => {
      panelMaterial?.emissiveMap?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  /** Rebuilds the screen texture only if the effective drawn state actually changed. */
  function redrawIfChanged(next: ScreenDrawState) {
    const current = rig.current;
    if (!current?.panelMaterial) return;
    // Pointer/animation callbacks may carry an older draw state. Read the
    // same current power state as the light instead of repainting stale ON/OFF.
    const controls = useFumeHoodControlsStore.getState();
    next = { ...next,
      lightOn: controls.lightOnById[fumeHoodId] ?? false,
      fanOn: controls.fanOnById[fumeHoodId] ?? false,
    };
    if (current.lastDrawState && sameDrawState(current.lastDrawState, next)) return;

    const oldTexture = current.panelMaterial.emissiveMap;
    const texture = buildFumeHoodControlPanelTexture(next);
    Object.assign(current.panelMaterial, { emissiveMap: texture, needsUpdate: true });
    oldTexture?.dispose();
    current.lastDrawState = next;
  }

  // Toggle/font-driven redraw — deliberately excludes hover/press (those
  // redraw imperatively from the pointer handlers below, so a hover/press
  // flip feels instant rather than waiting on a render pass).
  useEffect(() => {
    const current = rig.current;
    if (!current?.lastDrawState) return;
    const sync = () => {
      if (rig.current?.lastDrawState) redrawIfChanged({ ...rig.current.lastDrawState, fontsReady });
    };
    sync();
    return useFumeHoodControlsStore.subscribe(sync);
  }, [instance, fontsReady]);

  // Spins the fan icon continuously while ON, matching the approved design
  // mockup's animation — throttled to `FAN_REDRAW_INTERVAL_S` since each
  // tick rebuilds and re-uploads the whole screen canvas, unlike the
  // reagent cabinet's door/shutter tween (which only moves existing meshes).
  const fanRotationAccumulator = useRef(0);
  const fanRedrawAccumulator = useRef(0);
  useFrame((_, delta) => {
    const current = rig.current;
    if (!current?.lastDrawState?.fanOn) return;
    // Wrapped modulo a full turn — keeps the accumulator bounded across a
    // long play session instead of growing to a value where float
    // precision would start to matter.
    fanRotationAccumulator.current = (fanRotationAccumulator.current + delta * FAN_ROTATION_SPEED) % (2 * Math.PI);
    fanRedrawAccumulator.current += delta;
    if (fanRedrawAccumulator.current < FAN_REDRAW_INTERVAL_S) return;
    fanRedrawAccumulator.current = 0;
    redrawIfChanged({ ...current.lastDrawState, fanRotation: fanRotationAccumulator.current });
  });

  /** Only while the player has actually approached and is inspecting this fume hood should its screen respond to pointer events. */
  function isScreenInteractive(): boolean {
    const state = useSceneInteractionStore.getState();
    return state.cabinetPhase === "inspecting" && state.focusedCabinetId === fumeHoodId;
  }

  function updateCursor(zone: TouchZone) {
    document.body.style.cursor = zone && isScreenInteractive() ? "pointer" : "";
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
    redrawIfChanged({
      ...current.lastDrawState,
      fanHover: zone === "fan",
      lightHover: zone === "light",
      // A hover that moves off a zone implicitly releases any press on it —
      // there's no separate mouseup-outside-target event to catch that.
      fanPressed: current.lastDrawState.fanPressed && zone === "fan",
      lightPressed: current.lastDrawState.lightPressed && zone === "light",
    });
  }

  function handlePointerLeave() {
    const current = rig.current;
    updateCursor(null);
    if (!current?.lastDrawState) return;
    if (!current.lastDrawState.fanHover && !current.lastDrawState.lightHover) return;
    redrawIfChanged({ ...current.lastDrawState, fanHover: false, fanPressed: false, lightHover: false, lightPressed: false });
  }

  function handlePointerDown(uv: THREE.Vector2 | undefined) {
    const current = rig.current;
    if (!current?.lastDrawState || !uv || !isScreenInteractive()) return;
    const zone = resolveTouchZone(uv);
    if (zone === "fan") {
      toggleFan(fumeHoodId);
      redrawIfChanged({ ...current.lastDrawState, fanHover: true, fanPressed: true });
    } else if (zone === "light") {
      toggleLight(fumeHoodId);
      redrawIfChanged({ ...current.lastDrawState, lightHover: true, lightPressed: true });
    }
  }

  function handlePointerUp() {
    const current = rig.current;
    if (!current?.lastDrawState) return;
    if (!current.lastDrawState.fanPressed && !current.lastDrawState.lightPressed) return;
    redrawIfChanged({ ...current.lastDrawState, fanPressed: false, lightPressed: false });
  }

  return { handlePointerMove, handlePointerLeave, handlePointerDown, handlePointerUp };
}
