import { useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useLightingStore } from "../lib/useLightingStore";
import { createWallLightingMaterial } from "../lib/wallLightingMaterial";

const MODEL_PATH = "/assets/models/LabRoom.glb";

/**
 * `TECH_Room_Floor` exports with no `baseColorFactor` and no texture at all
 * (confirmed by reading the glTF JSON directly) — per the glTF 2.0 spec an
 * absent `baseColorFactor` defaults to opaque white, so the floor was
 * genuinely importing as white, not just reading as white under bad
 * lighting. This is a real missing-value bug in the exported material, not
 * a redesign: reusing the project's own documented "dark hard surface"
 * tone (`#687377`, the furniture-skill's work-surface graphite spec) here
 * at runtime, rather than touching the glb or going back to Blender.
 */
const FLOOR_MATERIAL_NAME = "TECH_Room_Floor";
const FLOOR_FALLBACK_COLOR = "#687377";

/**
 * `TECH_TGrid` (the suspended-ceiling T-grid rails) has a completely valid
 * `baseColorFactor` (0.72, 0.73, 0.74 — a normal light gray, not missing or
 * broken) but also `metallicFactor: 0.25`. This scene has no environment
 * map/IBL anywhere (there's no `<Environment>`/HDRI in the app at all), and
 * under physically-based shading a partially-metallic surface loses most of
 * its diffuse response (energy conservation trades diffuse for
 * specular-only reflection) while getting no specular fill back from a
 * nonexistent environment to reflect — the net result reads as near-black
 * regardless of how light the base color actually is. That's the real,
 * verifiable cause of the "black cage" grid, not a missing import value or
 * an exposure/intensity problem. Correcting metalness to a painted-steel
 * profile (an Armstrong grid rail is coated steel, not bare metal) and
 * nudging the color into the requested light-gray range fixes the actual
 * cause rather than compensating with more light.
 */
const TGRID_MATERIAL_NAME = "TECH_TGrid";
const TGRID_COLOR = "#DFE3E1";
const TGRID_METALNESS = 0.05;

/** Already close to the requested target; nudged precisely onto it rather than left at a near-miss. */
const CEILING_TILE_MATERIAL_NAME = "TECH_CeilingTile";
const CEILING_TILE_COLOR = "#F0F1EE";

/**
 * The approved production laboratory room — walls, floor, ceiling, door,
 * window, sill, radiator + niche, suspended 600x600 ceiling grid, six LED
 * panels, and the two ceiling point lights — loaded directly from the
 * exported Blender asset rather than rebuilt from primitives. Room QA
 * (architecture + lighting) is already signed off; this component's only
 * job is faithfully displaying that asset.
 *
 * `KHR_lights_punctual` lights baked into the glTF (`CeilingLight_A`,
 * `CeilingLight_B`, the directional sun) come through automatically via
 * `GLTFLoader`'s light extension support — `LightingRuntime` finds them by
 * name afterwards to drive on/off state, so nothing here needs to place or
 * configure lights itself.
 */
export function LabRoom() {
  const { scene, materials } = useGLTF(MODEL_PATH);

  useEffect(() => {
    // The GLB housing is a closed box: its underside (Y=3.075) covers
    // the diffuser (Y=3.078). Expose the luminous face below the housing.
    const originals = new Map<THREE.Object3D, number>();
    scene.traverse(object => {
      if (!/^LED_Panel_\d+_Diffuser$/.test(object.name)) return;
      originals.set(object, object.position.y);
      object.position.y -= 0.006;
    });
    return () => originals.forEach((y, object) => { object.position.y = y; });
  }, [scene]);

  useEffect(() => {
    const replacements = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const next = source.map(material => {
        if (!(material instanceof THREE.MeshStandardMaterial) ||
          !["TECH_Room_Wall", "MAT_Wall_Lower"].includes(material.name)) return material;
        if (!replacements.has(material)) replacements.set(material, createWallLightingMaterial(material));
        return replacements.get(material)!;
      });
      if (next.some((material, i) => material !== source[i])) {
        originals.set(object, object.material);
        object.material = Array.isArray(object.material) ? next : next[0];
      }
    });
    return () => {
      originals.forEach((material, mesh) => { mesh.material = material; });
      replacements.forEach(material => material.dispose());
    };
  }, [scene]);

  useEffect(() => {
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const floorMaterial = materials[FLOOR_MATERIAL_NAME] as THREE.MeshStandardMaterial | undefined;
    if (floorMaterial && !floorMaterial.map) {
      floorMaterial.color.set(FLOOR_FALLBACK_COLOR);
    }

    const tgridMaterial = materials[TGRID_MATERIAL_NAME] as THREE.MeshStandardMaterial | undefined;
    if (tgridMaterial) {
      tgridMaterial.color.set(TGRID_COLOR);
      Object.assign(tgridMaterial, { metalness: TGRID_METALNESS });
    }

    const ceilingTileMaterial = materials[CEILING_TILE_MATERIAL_NAME] as THREE.MeshStandardMaterial | undefined;
    if (ceilingTileMaterial) {
      ceilingTileMaterial.color.set(CEILING_TILE_COLOR);
    }
  }, [scene, materials]);

  const handleSwitch = (event: ThreeEvent<MouseEvent>) => {
    if (event.object.name === "LightSwitch_Rocker_A") {
      event.stopPropagation();
      useLightingStore.getState().toggleGroupA();
    } else if (event.object.name === "LightSwitch_Rocker_B") {
      event.stopPropagation();
      useLightingStore.getState().toggleGroupB();
    }
  };
  return <primitive object={scene} onClick={handleSwitch} />;
}

useGLTF.preload(MODEL_PATH);
