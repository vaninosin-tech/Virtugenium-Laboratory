import * as THREE from "three";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { deferDispose } from "./deferredDispose";
import { LiquidMaterial } from "./reagentMaterials";
import type { ReactionKind } from "./tubeReactions";
import type { RuntimeQuality } from "./useRuntimeQualityStore";

export const TUBE_VISUALS = {
  copperColor: "#219de8",
  gasColor: "#98401c",
  particleCounts: { LOW: 12, MEDIUM: 28, HIGH: 48, ULTRA: 72 },
  settlingStart: 0.18,
  settlingEnd: 0.94,
};

/** Fixed pools survive progress updates, including seeking backwards in F8. */
export function createTubeReactionVisuals(root: THREE.Object3D, kind: ReactionKind | null) {
  let cavity: THREE.Mesh | undefined;
  let shell: THREE.Mesh | undefined;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.name.startsWith("ContentsVolume")) cavity = object;
    if (object.name.startsWith("Tube_Glass")) shell = object;
  });
  if (!cavity || !shell) return null;
  const volume = cavity;
  volume.geometry.computeBoundingBox();
  const box = volume.geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.min(size.x, size.z) * 0.5;
  root.updateMatrixWorld(true);
  shell.geometry.computeBoundingBox();
  // Read the lip in cavity coordinates so authored node transforms remain valid.
  const lip = volume.worldToLocal(shell.localToWorld(new THREE.Vector3(0, shell.geometry.boundingBox!.max.y, 0)));
  const baseline = volume.material;
  const base = Array.isArray(baseline) ? baseline[0] : baseline;
  const physical = base as THREE.MeshPhysicalMaterial;
  const liquid = kind ? new LiquidMaterial(volume.geometry, {
    color: kind === "permanganate-redox" ? REAGENTS.kmno4.contentsColor : `#${physical.color?.getHexString() ?? "ffffff"}`,
    opacity: physical.opacity,
    reactionColor: kind === "copper-nitric" ? TUBE_VISUALS.copperColor : "#ffffff",
  }) : null;
  if (liquid) {
    liquid.uniforms.uMixingStrength.value = 0;
    liquid.uniforms.uTopHighlight.value = 0.04;
  }
  const group = new THREE.Group();
  group.name = "TubeReactionVisuals";
  group.position.copy(volume.position);
  group.quaternion.copy(volume.quaternion);
  group.scale.copy(volume.scale);
  volume.parent?.add(group);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const white = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.94, emissive: "#ffffff", emissiveIntensity: 0.12 });
  const bubbleMaterial = new THREE.MeshPhysicalMaterial({ color: "#e5f4ff", transparent: true, opacity: 0.48, roughness: 0.08, metalness: 0.12, depthWrite: false });
  const gasMaterial = new THREE.MeshBasicMaterial({ color: TUBE_VISUALS.gasColor, transparent: true, opacity: 0.12, depthWrite: false });
  gasMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vGasNormal; varying vec3 vGasView;\n${shader.vertexShader}`
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGasNormal = normalize(normalMatrix * normal); vGasView = -mvPosition.xyz;");
    shader.fragmentShader = `varying vec3 vGasNormal; varying vec3 vGasView;\n${shader.fragmentShader}`
      .replace("#include <opaque_fragment>", "diffuseColor.a *= pow(abs(dot(normalize(vGasNormal), normalize(vGasView))), 2.0);\n#include <opaque_fragment>");
  };
  const makePool = (material: THREE.Material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, 72);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  };
  const flakes = makePool(white);
  flakes.name = "TubePrecipitate";
  const bubbles = makePool(bubbleMaterial);
  bubbles.name = "TubeNOBubbles";
  const gas = makePool(gasMaterial);
  gas.name = "TubeNO2";
  const splash = makePool(bubbleMaterial);
  splash.name = "TubeSplash";
  // Reuse the cavity silhouette; a squashed copy cannot pierce its walls.
  const bed = new THREE.Mesh(volume.geometry, white);
  bed.name = "TubeSediment";
  bed.visible = false;
  bed.raycast = () => {};
  group.add(bed);
  const dummy = new THREE.Object3D();
  const random = (i: number) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  let disposed = false;
  return {
    update(progress: number, time: number, quality: RuntimeQuality, splashAge: number) {
      const p = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
      const count = TUBE_VISUALS.particleCounts[quality];
      const precipitate = kind === "silver-chloride" || kind === "barium-sulfate";
      const curds = kind === "silver-chloride";
      const onset = THREE.MathUtils.smoothstep(p, 0, 0.08);
      const settled = THREE.MathUtils.smoothstep(p, TUBE_VISUALS.settlingStart, TUBE_VISUALS.settlingEnd);
      volume.material = p > 0 && liquid ? liquid : baseline;
      if (liquid) {
        liquid.uniforms.uTime.value = time;
        liquid.uniforms.uReactionProgress.value = precipitate ? onset : p;
        liquid.uniforms.uCloudiness.value = precipitate ? onset * (1 - settled) : 0;
        liquid.uniforms.uOpacity.value = precipitate ? THREE.MathUtils.lerp(physical.opacity, 0.95, onset * (1 - settled))
          : kind === "permanganate-redox" ? THREE.MathUtils.lerp(0.94, 0.14, p) : THREE.MathUtils.lerp(physical.opacity, 0.8, p);
        liquid.uniforms.uQualityNoise.value = quality === "LOW" ? 0 : 1;
      }
      bed.visible = precipitate && p > 0;
      bed.scale.y = Math.max(0.0001, settled * (curds ? 0.16 : 0.045));
      bed.position.y = box.min.y * (1 - bed.scale.y);
      flakes.visible = precipitate && p > 0;
      flakes.count = count;
      bubbles.visible = kind === "copper-nitric" && p > 0;
      bubbles.count = Math.max(4, Math.floor(count / 3));
      gas.visible = bubbles.visible;
      gas.count = Math.max(4, Math.floor(count / 6));
      gasMaterial.opacity = 0.2 * onset;
      splash.visible = splashAge >= 0 && splashAge < 1;
      splash.count = Math.max(6, Math.floor(count / 2));
      for (let i = 0; i < count; i++) {
        const angle = random(i + 1) * Math.PI * 2;
        const radial = radius * 0.64 * Math.sqrt(random(i + 93));
        const x = center.x + Math.cos(angle) * radial;
        const z = center.z + Math.sin(angle) * radial;
        const grain = radius * (curds ? 0.19 + random(i + 31) * 0.1 : 0.055);
        const floor = box.min.y + size.y * (curds ? 0.05 + random(i + 14) * 0.1 : 0.02);
        place(flakes, i, x, THREE.MathUtils.lerp(box.min.y + size.y * (0.12 + random(i + 71) * 0.78), floor, settled), z, grain * onset, grain * onset * 0.65, grain * onset);
        if (i < bubbles.count) {
          const rise = (time * 0.48 + random(i + 42)) % 1;
          place(bubbles, i, x * 0.7, box.min.y + size.y * (0.12 + rise * 0.87), z * 0.7, radius * (0.07 + rise * 0.06) * onset);
        }
        if (i < gas.count) {
          const rise = (time * 0.35 + i / gas.count) % 1;
          const r = radius * (0.75 + rise * 1.6);
          place(gas, i, lip.x + Math.sin(time + i) * radius * rise, lip.y + r * 1.5 + rise * size.y * 0.9, lip.z, r, r * 1.4, r);
        }
        if (splash.visible && i < splash.count) {
          const age = Math.max(0, splashAge);
          const speed = size.y * (0.8 + random(i + 4));
          place(splash, i, lip.x + Math.cos(angle) * speed * age, lip.y + speed * age * 2 - size.y * 4 * age * age,
            lip.z + Math.sin(angle) * speed * age, radius * 0.16 * (1 - Math.min(age, 1)));
        }
      }
      for (const mesh of [flakes, bubbles, gas, splash]) if (mesh.visible) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      volume.material = baseline;
      group.removeFromParent();
      deferDispose(group, () => {
        geometry.dispose();
        white.dispose(); bubbleMaterial.dispose(); gasMaterial.dispose(); liquid?.dispose();
        for (const mesh of [flakes, bubbles, gas, splash]) mesh.dispose();
      });
    },
  };
}
