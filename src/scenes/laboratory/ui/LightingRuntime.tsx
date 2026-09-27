import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { LOG_LIVE_LIGHTS } from "../lib/debugFlags";
import {
  CEILING_LIGHT_ON_INTENSITY,
  DIFFUSER_EMISSIVE_ON,
  ENVIRONMENT_INTENSITY,
  SUN_RUNTIME_INTENSITY,
} from "../lib/lightingConfig";
import { useLightingStore } from "../lib/useLightingStore";

const MODEL_PATH = "/assets/models/LabRoom.glb";

interface LightingRig {
  lightA: THREE.Light | null;
  lightB: THREE.Light | null;
  materialA: THREE.MeshStandardMaterial | undefined;
  materialB: THREE.MeshStandardMaterial | undefined;
}

function findLight(root: THREE.Object3D, name: string): THREE.Light | null {
  let found: THREE.Light | null = null;
  root.traverse((object) => {
    if (!found && object.name === name && (object as THREE.Light).isLight) {
      found = object as THREE.Light;
    }
  });
  return found;
}

/**
 * Runtime equivalent of the two approved Blender light groups, PLUS a
 * one-time override of the imported sun's intensity. Blender's
 * AVERAGE+Generator driver rig (switch custom prop -> light energy / diffuser
 * emission strength) has no glTF equivalent, so this recreates just the
 * on/off *behavior* in game code against the real, approved geometry:
 * `CeilingLight_A` / `CeilingLight_B` (the two `KHR_lights_punctual` point
 * lights baked into `LabRoom.glb` — six LED panels are still lit by only
 * these two lights, not one dynamic light each) and the
 * `TECH_Light_Diffuser_A` / `TECH_Light_Diffuser_B` panel materials.
 *
 * The directional sun (`Light` in the glb) keeps its imported position and
 * rotation — only its intensity is overridden, once, to
 * `SUN_RUNTIME_INTENSITY`. It is NOT part of the A/B switch: it's ambient
 * environment lighting, always on, exactly like `HemisphereLight` in
 * `Laboratory.tsx`. See `lightingConfig.ts` for why none of these three
 * values are read from the glb's own baked intensities.
 *
 * Ceiling-light/diffuser handles live in a ref (populated once per asset
 * load) and are mutated from `useFrame`, matching `CameraRig`'s convention
 * for imperative three.js state — refs are the escape hatch
 * `react-hooks/immutability` expects for values a component intends to
 * mutate outside React's own render/commit cycle; a `useMemo`-derived
 * handle would trip the same rule that flags direct property writes on
 * hook-derived objects.
 *
 * Reads `useLightingStore` (groupA/groupB) for the ceiling lights only;
 * does not add any interaction — wiring the physical switch to these
 * setters is a later gameplay pass.
 */
export function LightingRuntime() {
  const { scene, materials } = useGLTF(MODEL_PATH);
  const rootScene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const rig = useRef<LightingRig | null>(null);

  // Neutral studio IBL (bundled RoomEnvironment, no network fetch) so
  // metallic PBR surfaces (sink, faucet) get plausible soft reflections
  // instead of reading as near-black when not directly under a ceiling light.
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    rootScene.environment = envTexture;
    rootScene.environmentIntensity = ENVIRONMENT_INTENSITY;
    pmrem.dispose();
    return () => {
      envTexture.dispose();
    };
  }, [gl, rootScene]);

  useEffect(() => {
    const lightA = findLight(scene, "CeilingLight_A");
    const lightB = findLight(scene, "CeilingLight_B");
    const materialA = materials["TECH_Light_Diffuser_A"] as THREE.MeshStandardMaterial | undefined;
    const materialB = materials["TECH_Light_Diffuser_B"] as THREE.MeshStandardMaterial | undefined;
    materialA?.emissive.set("#f3f6f9");
    materialB?.emissive.set("#f3f6f9");

    const sun = findLight(scene, "Light");
    if (sun) sun.intensity = SUN_RUNTIME_INTENSITY;

    rig.current = { lightA, lightB, materialA, materialB };

    if (LOG_LIVE_LIGHTS) {
      console.group("[LightingRuntime] live light traversal (root scene)");
      let count = 0;
      rootScene.traverse((object) => {
        if (!(object as THREE.Light).isLight) return;
        count += 1;
        const light = object as THREE.Light;
        const base = {
          name: light.name || "(unnamed)",
          type: light.type,
          intensity: light.intensity,
          position: light.getWorldPosition(new THREE.Vector3()).toArray(),
        };
        if (light instanceof THREE.PointLight) {
          console.log(base.name, { ...base, distance: light.distance, decay: light.decay });
        } else if (light instanceof THREE.DirectionalLight) {
          console.log(base.name, { ...base, quaternion: light.quaternion.toArray() });
        } else {
          console.log(base.name, base);
        }
      });
      console.log("TOTAL live light count:", count);
      console.groupEnd();
    }
  }, [scene, materials, rootScene]);

  useFrame(() => {
    const current = rig.current;
    if (!current) return;

    const { groupA, groupB } = useLightingStore.getState();

    const targetA = groupA ? CEILING_LIGHT_ON_INTENSITY : 0;
    if (current.lightA && current.lightA.intensity !== targetA) current.lightA.intensity = targetA;
    const emissiveA = groupA ? DIFFUSER_EMISSIVE_ON : 0;
    if (current.materialA && current.materialA.emissiveIntensity !== emissiveA) current.materialA.emissiveIntensity = emissiveA;

    const targetB = groupB ? CEILING_LIGHT_ON_INTENSITY : 0;
    if (current.lightB && current.lightB.intensity !== targetB) current.lightB.intensity = targetB;
    const emissiveB = groupB ? DIFFUSER_EMISSIVE_ON : 0;
    if (current.materialB && current.materialB.emissiveIntensity !== emissiveB) current.materialB.emissiveIntensity = emissiveB;
  });

  return null;
}
