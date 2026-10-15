import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Select } from "@react-three/postprocessing";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import { useHotspotObjectsStore } from "../lib/useHotspotObjectsStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { registerWorktopZone } from "../lib/worktopBounds";

const MODEL_PATH = "/assets/models/LaboratoryWorkbench.glb";

/**
 * Laboratory workbench — approved Blender asset, no per-instance state.
 * "table" is already a real hotspot (`HOTSPOTS` in `CameraRig.tsx` drives
 * click-to-view-table zoom), but nothing rendered the hover feedback for
 * it — every other hotspot (cabinets, fume hood, PPE cabinet) wraps its
 * instance in `<Select>` so the postprocessing outline pass lights up on
 * hover; this only adds that same generic outline (`HoverOutline`).
 */
export function WorkbenchInstance({ position }: { readonly position: Position3 }) {
  const { scene } = useGLTF(MODEL_PATH);
  const [x, y, z] = position;
  const isHovered = useSceneInteractionStore((state) => state.hoveredTargetId === "table");

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  // Registers the actual rendered hierarchy for `CameraRig`'s crosshair
  // hover raycast — any mesh under `instance` (tabletop, sink, legs, ...)
  // counts as "hovering the workbench", not just a fixed point near it.
  useEffect(() => {
    useHotspotObjectsStore.getState().register("table", instance);
    return () => useHotspotObjectsStore.getState().unregister("table");
  }, [instance]);

  // A held bottle or tube stays over the countertop (VL-018) — its rectangle is tuned in F8 → «Границы».
  useEffect(() => registerWorktopZone("table", instance), [instance]);

  return (
    <group position={[x, y, z]}>
      <Select enabled={isHovered}>
        <primitive object={instance} />
      </Select>
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
