import { useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { Select } from "@react-three/postprocessing";
import * as THREE from "three";

import { createTextTexture } from "../lib/createTextTexture";
import { EQUIPMENT } from "../lib/layout";
import { loadCabinetFonts } from "../lib/loadCabinetFonts";
import { remapPlanarUV } from "../lib/remapPlanarUV";
import { FUME_HOOD_SCREEN_MESH_NAME, useFumeHoodControlPanel } from "../lib/useFumeHoodControlPanel";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { useHotspotObjectsStore } from "../lib/useHotspotObjectsStore";
import { useSashSlideAnimation } from "../lib/useSashSlideAnimation";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { registerWorktopZone } from "../lib/worktopBounds";
import { installFumeHoodLighting } from "../lib/installFumeHoodLighting";
import { useFumeHoodControlsStore } from "../lib/useFumeHoodControlsStore";

const MODEL_PATH = "/assets/models/FumeHood_Modern.glb";

/**
 * Single source of truth for this unit's wall transform — see
 * `layout.ts`'s `EQUIPMENT` for the flush-to-wall derivation (left wall,
 * the slot vacated when simple-substances/oxides/glassware moved to the
 * back wall). `id` lookup rather than a hardcoded index keeps this correct
 * if `EQUIPMENT`'s order ever changes.
 */
const DEF = EQUIPMENT.find((equipment) => equipment.id === "fume-hood")!;

/**
 * Same canvas-texture-on-mesh approach as the reagent cabinets'
 * `CategoryLabelPlate` (see `ReagentCabinetInstance.tsx`) — real geometry,
 * not an `<Html>` overlay, drawn with the same webfont stack so the fume
 * hood's plaque reads consistently with every other physical sign in the
 * room. `FumeHood_Header`/`FumeHood_HeaderAccent` are the plate/trim node
 * names baked in `FumeHood_Modern_MASTER.blend`, vertex-copied from the
 * same donor plate mesh the cabinets use — same packed-UV risk, so this
 * remaps planar UVs the identical way before drawing.
 */
const PLAQUE_NODE_NAME = "FumeHood_Header";
const PLAQUE_LABEL = "ВЫТЯЖНОЙ ШКАФ";
const LABEL_CANVAS_WIDTH = 1024;
const LABEL_CANVAS_HEIGHT = 157;
const LABEL_TEXT_COLOR = "#FFFFFF";
const LABEL_BACKGROUND_COLOR = "#20242a";
const LABEL_FONT_FAMILY = '"Unbounded", "Russo One", "Exo 2", sans-serif';
const LABEL_LETTER_SPACING = "0.04em";

/** How much of the clear sash shows: enough for its edge and reflections to read as glass. */
const SASH_GLASS_OPACITY = 0.12;

/**
 * Lower glass sash — `FumeHood_Sash_Lower` in the source blend, the front
 * layer directly in front of the (fixed) `FumeHood_Sash_Upper`. Its glass
 * and frame are already parented under this one node, so moving it moves
 * both together as one rigid group for free.
 *
 * `SASH_OPEN_OFFSET_Y` is not eyeballed — measured directly in
 * `FumeHood_Modern_MASTER.blend`: the worktop surface sits at Z 0.9, and the
 * authored closed sash's own front frame bottom sits at Z 0.8975. Raising
 * the sash so its bottom edge sits 0.28 m above the worktop (Z 0.9 + 0.28 =
 * 1.18) is a vertical lift of 1.18 - 0.8975 = 0.2825 m — a plain Z distance
 * in Blender, which carries over unchanged as a Y distance after the
 * engine's Z-up → Y-up axis swap (a pure vertical move stays vertical
 * either way).
 */
const SASH_LOWER_NODE_NAME = "FumeHood_Sash_Lower";
const SASH_OPEN_OFFSET_Y = 0.2825;

// Upper sash rides up slightly with the lower one — a small sympathetic
// motion, not an independent open/close state — a flat +0.18 m from its own
// authored closed position, same node-name/find pattern, same trigger, same
// duration/easing.
const SASH_UPPER_NODE_NAME = "FumeHood_Sash_Upper";
const SASH_UPPER_OPEN_OFFSET_Y = 0.18;

// Matches `CameraRig`'s fume-hood staged approach: the camera pauses at its
// staging pose for exactly this long while the sash opens/closes, then
// continues — keeping the glass animation and the camera pause in lockstep.
// Was 800ms; cut by 35% (×0.65) alongside `CameraRig`'s FUME_SASH_DURATION_MS
// for the cabinet/fume-hood interaction speedup — kept numerically equal to
// that constant, not independently re-tuned.
const SASH_TRANSITION_DURATION_MS = 520;

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

function buildPlaqueTexture(fontsReady: boolean): THREE.CanvasTexture {
  return createTextTexture({
    lines: [PLAQUE_LABEL],
    backgroundColor: LABEL_BACKGROUND_COLOR,
    textColor: LABEL_TEXT_COLOR,
    width: LABEL_CANVAS_WIDTH,
    height: LABEL_CANVAS_HEIGHT,
    fontFamily: fontsReady ? LABEL_FONT_FAMILY : undefined,
    letterSpacing: LABEL_LETTER_SPACING,
  });
}

/**
 * Modern laboratory fume hood — approved Blender asset. This unit has no
 * cabinet doors to open on click-to-focus (unlike the reagent cabinets) —
 * its only moving parts are the lower and upper glass sashes, which open
 * and close automatically mid-way through `CameraRig`'s staged fume-hood
 * approach/return sequence (no click target).
 */
export function FumeHood() {
  const { scene } = useGLTF(MODEL_PATH);
  const override = useFurniturePositionStore((state) => state.getOverride(DEF.id));
  const [x, y, z] = override.position;
  const rotationY = override.rotationY ?? DEF.rotationY;

  const isHovered = useSceneInteractionStore((state) => state.hoveredTargetId === DEF.id);
  const sashStageOpen = useSceneInteractionStore((state) => state.sashStageOpen);

  // Same lazy-load-then-rebuild pattern as ReagentCabinetInstance — canvas
  // `fillText` silently falls back to a system font if "Unbounded" isn't
  // loaded yet, with no automatic redraw once it becomes available.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadCabinetFonts().then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const plaque = findByName(clone, PLAQUE_NODE_NAME) as THREE.Mesh | null;
    if (plaque && plaque.material) {
      // Always the opposite flipU from ReagentCabinetInstance's identical
      // call, at both the 180° yaw this hood used to ship at and the 90°
      // yaw it uses now — confirmed empirically at both, so this is an
      // asset-specific constant (this plate's vertex-copied geometry reads
      // its local U axis backwards relative to the donor mesh), not a
      // function of rotationY.
      remapPlanarUV(plaque, false, false);
      plaque.material = new THREE.MeshStandardMaterial({
        map: buildPlaqueTexture(fontsReady),
        roughness: 0.9,
        metalness: 0,
      });
    }

    return clone;
  }, [scene, fontsReady]);

  useEffect(() => {
    const restore: Array<() => void> = [];
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material;
      const materials = Array.isArray(original) ? original : [original];
      const glassCopies: THREE.MeshPhysicalMaterial[] = [];
      const updated = materials.map((material) => {
        if (!(material instanceof THREE.MeshPhysicalMaterial) || material.name !== "FH_Glass_Sash") {
          return material;
        }
        const glass = material.clone();
        // Polished clear sash: no milky layer — and no transmission either.
        // A transmissive material is drawn like an opaque one (it writes
        // depth) and shows what is behind it only through the transmission
        // pass, which leaves out everything transparent: from the hood's own
        // view, the tubes, the bottles' glass and every hover/aim outline
        // behind the raised sash simply vanished. Plain alpha-blended glass
        // instead — the same trade the reagent jars and the spirit lamp make.
        glass.roughness = 0;
        glass.roughnessMap = null;
        glass.transmission = 0;
        glass.transparent = true;
        glass.opacity = SASH_GLASS_OPACITY;
        glass.depthWrite = false;
        glass.color.set("#ffffff");
        glass.specularColor.set("#ffffff");
        glassCopies.push(glass);
        return glass;
      });
      if (!glassCopies.length) return;
      object.material = Array.isArray(original) ? updated : updated[0];
      restore.push(() => {
        object.material = original;
        glassCopies.forEach((material) => material.dispose());
      });
    });
    return () => restore.forEach((dispose) => dispose());
  }, [instance]);

  // Registers the actual rendered hierarchy for `CameraRig`'s crosshair
  // hover raycast — any mesh under `instance` counts as "hovering the fume
  // hood", not just a fixed point near it.
  useEffect(() => {
    useHotspotObjectsStore.getState().register(DEF.id, instance);
    return () => useHotspotObjectsStore.getState().unregister(DEF.id);
  }, [instance]);

  // A held bottle or tube stays over the worktop inside the hood (VL-018) —
  // its rectangle is tuned in F8 → «Границы».
  useEffect(() => registerWorktopZone("fume-hood", instance), [instance]);

  // Driven by `sashStageOpen`, not `cabinetPhase` directly — `CameraRig`
  // sets it mid-transition, once the camera has paused at its staging pose
  // (see the staged approach sequence there), not exactly at focus/return.
  useSashSlideAnimation(instance, SASH_LOWER_NODE_NAME, sashStageOpen, SASH_OPEN_OFFSET_Y, SASH_TRANSITION_DURATION_MS);
  useSashSlideAnimation(
    instance,
    SASH_UPPER_NODE_NAME,
    sashStageOpen,
    SASH_UPPER_OPEN_OFFSET_Y,
    SASH_TRANSITION_DURATION_MS,
  );

  const controlPanelScreen = useFumeHoodControlPanel(instance, DEF.id);
  useEffect(() => {
    const lighting = installFumeHoodLighting(instance);
    if (!lighting) return;
    const sync = () => lighting.setEnabled(useFumeHoodControlsStore.getState().lightOnById[DEF.id] ?? false);
    sync();
    const unsubscribe = useFumeHoodControlsStore.subscribe(sync);
    return () => { unsubscribe(); lighting.dispose(); };
  }, [instance]);

  // Same pattern as `ReagentCabinetInstance`: R3F raycasts the whole cloned
  // hierarchy through this one `<primitive>`, so the screen's own touch-zone
  // interaction only ever fires for hits on `Page_Display` itself.
  const handleScreenPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (event.object.name !== FUME_HOOD_SCREEN_MESH_NAME) {
      controlPanelScreen.handlePointerLeave();
      return;
    }
    event.stopPropagation();
    controlPanelScreen.handlePointerMove(event.uv);
  };

  const handleScreenPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.object.name !== FUME_HOOD_SCREEN_MESH_NAME) return;
    event.stopPropagation();
    controlPanelScreen.handlePointerDown(event.uv);
  };

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      <Select enabled={isHovered}>
        <primitive
          object={instance}
          onPointerMove={handleScreenPointerMove}
          onPointerDown={handleScreenPointerDown}
          onPointerUp={() => controlPanelScreen.handlePointerUp()}
          onPointerLeave={() => controlPanelScreen.handlePointerLeave()}
        />
      </Select>
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
