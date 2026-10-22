import { useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { Select } from "@react-three/postprocessing";
import * as THREE from "three";

import { createTextTexture } from "../lib/createTextTexture";
import { EQUIPMENT } from "../lib/layout";
import { loadCabinetFonts } from "../lib/loadCabinetFonts";
import { remapPlanarUV } from "../lib/remapPlanarUV";
import { useCabinetOpenStore } from "../lib/useCabinetOpenStore";
import { useDoorSwingAnimation, type DoorSwingSpec } from "../lib/useDoorSwingAnimation";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { useHotspotObjectsStore } from "../lib/useHotspotObjectsStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";

const MODEL_PATH = "/assets/models/PPECabinet.glb";

/**
 * Single source of truth for this unit's wall transform — see
 * `layout.ts`'s `EQUIPMENT` for the flush-to-wall derivation (left wall,
 * next to `FumeHood`, on its far/-Z side).
 */
const DEF = EQUIPMENT.find((equipment) => equipment.id === "ppe-cabinet")!;

/**
 * Same canvas-texture-on-mesh label approach as the reagent cabinets and
 * `FumeHood` (see `ReagentCabinetInstance.tsx` / `FumeHood.tsx`).
 * `PPECabinet_Header`/`PPECabinet_HeaderAccent` are this asset's plate/trim
 * node names.
 */
const PLAQUE_NODE_NAME = "PPECabinet_Header";
const PLAQUE_LABEL = "СИЗ";
const LABEL_CANVAS_WIDTH = 512;
const LABEL_CANVAS_HEIGHT = 128;
const LABEL_TEXT_COLOR = "#FFFFFF";
const LABEL_BACKGROUND_COLOR = "#20242a";
const LABEL_FONT_FAMILY = '"Unbounded", "Russo One", "Exo 2", sans-serif';
const LABEL_LETTER_SPACING = "0.04em";

/** Single door, hinged on its left (`PPECabinet_DoorPivot_Left` in the source blend) — swings outward into the room, not into the cabinet. */
const DOORS: readonly DoorSwingSpec[] = [{ nodeName: "PPECabinet_DoorPivot_Left", openAngleDeg: -110 }];

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

/** PPE (СИЗ) storage cabinet — approved Blender asset. Click-to-focus (crosshair hover raycasts its own registered geometry — see `useHotspotObjectsStore`) opens its door, same interaction as the reagent cabinets. */
export function PPECabinet() {
  const { scene } = useGLTF(MODEL_PATH);
  const override = useFurniturePositionStore((state) => state.getOverride(DEF.id));
  const [x, y, z] = override.position;
  const rotationY = override.rotationY ?? DEF.rotationY;

  const isOpen = useCabinetOpenStore((state) => state.openById[DEF.id] ?? false);
  const isHovered = useSceneInteractionStore((state) => state.hoveredTargetId === DEF.id);

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
      // call — confirmed empirically at both the 180° yaw this cabinet used
      // to ship at and the 90° yaw it uses now (same reasoning as
      // FumeHood.tsx: an asset-specific constant, not a function of
      // rotationY).
      remapPlanarUV(plaque, false, false);
      plaque.material = new THREE.MeshStandardMaterial({
        map: buildPlaqueTexture(fontsReady),
        roughness: 0.9,
        metalness: 0,
      });
    }

    return clone;
  }, [scene, fontsReady]);

  // Registers the actual rendered hierarchy for `CameraRig`'s crosshair
  // hover raycast — any mesh under `instance` counts as "hovering the PPE
  // cabinet", not just a fixed point near it.
  useEffect(() => {
    useHotspotObjectsStore.getState().register(DEF.id, instance);
    return () => useHotspotObjectsStore.getState().unregister(DEF.id);
  }, [instance]);

  useDoorSwingAnimation(instance, isOpen, DOORS);

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      <Select enabled={isHovered}>
        <primitive object={instance} />
      </Select>
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
