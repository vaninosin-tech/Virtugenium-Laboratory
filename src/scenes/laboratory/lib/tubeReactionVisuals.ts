import * as THREE from "three";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { deferDispose } from "./deferredDispose";
import { LiquidMaterial } from "./reagentMaterials";
import type { ReactionKind } from "./tubeReactions";
import type { RuntimeQuality } from "./useRuntimeQualityStore";

export const TUBE_VISUALS = {
  copperColor: "#007fce",
  gasColor: "#863016",
  gasOpacity: 0.56,
  particleCounts: { LOW: 24, MEDIUM: 36, HIGH: 54, ULTRA: 72 },
  curdLayerHeight: 0.24,
  crystalLayerHeight: 0.045,
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
    if (kind === "permanganate-redox") {
      // Match the pre-reaction physical response, including both walls and
      // depth writing. Switching to the bottle shader diluted the first frame.
      liquid.side = physical.side;
      liquid.depthWrite = physical.depthWrite;
      liquid.roughness = physical.roughness;
      liquid.ior = physical.ior;
      liquid.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, liquid.uniforms);
        shader.fragmentShader = `uniform vec3 uBaseColor; uniform vec3 uReactionColor;
uniform float uReactionProgress; uniform float uOpacity;
${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
diffuseColor.rgb = mix(uBaseColor, uReactionColor, uReactionProgress);
diffuseColor.a = uOpacity;`);
      };
      liquid.customProgramCacheKey = () => "tube-liquid-continuous-permanganate-v1";
    }
  }
  const group = new THREE.Group();
  group.name = "TubeReactionVisuals";
  group.position.copy(volume.position);
  group.quaternion.copy(volume.quaternion);
  group.scale.copy(volume.scale);
  volume.parent?.add(group);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const white = new THREE.MeshStandardMaterial({ color: "#c9c7c2", roughness: 1, envMapIntensity: 0.15 });
  white.onBeforeCompile = (shader) => {
    // The nearby burner saturates even non-emissive white. Bound the diffuse
    // response before bloom and keep normal-based relief instead of hot spots.
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
float relief = 0.7 + 0.3 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.3))));
outgoingLight = min(totalDiffuse, vec3(0.65)) * relief;
#include <opaque_fragment>`);
  };
  // Lobed, asymmetric flocs cast their own small shading variations. They do
  // not depend on bloom or emission to distinguish curds from fine crystals.
  const curdGeometry = new THREE.IcosahedronGeometry(1, 2);
  const vertices = curdGeometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const lump = 0.8 + 0.18 * Math.sin(x * 11 + y * 7) * Math.cos(z * 12 - y * 5) + 0.12 * Math.sin(z * 7 + x * 5);
    vertices.setXYZ(i, x * lump, y * lump * 0.75, z * lump);
  }
  curdGeometry.computeVertexNormals();
  const bubbleMaterial = new THREE.MeshPhysicalMaterial({ color: "#e5f4ff", transparent: true, opacity: 0.48, roughness: 0.08, metalness: 0.12, depthWrite: false });
  const gasMaterial = new THREE.MeshBasicMaterial({ color: TUBE_VISUALS.gasColor, transparent: true, opacity: TUBE_VISUALS.gasOpacity, depthWrite: false, toneMapped: false });
  gasMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vGasNormal; varying vec3 vGasView;\n${shader.vertexShader}`
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGasNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal); vGasView = -mvPosition.xyz;");
    shader.fragmentShader = `varying vec3 vGasNormal; varying vec3 vGasView;\n${shader.fragmentShader}`
      .replace("#include <opaque_fragment>", "diffuseColor.a *= smoothstep(0.0, 0.8, abs(dot(normalize(vGasNormal), normalize(vGasView))));\n#include <opaque_fragment>");
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
  if (kind === "silver-chloride") flakes.geometry = curdGeometry;
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
        liquid.uniforms.uOpacity.value = precipitate ? THREE.MathUtils.lerp(0.12, 0.95, onset * (1 - settled))
          : kind === "permanganate-redox" ? THREE.MathUtils.lerp(physical.opacity, 0.14, p) : THREE.MathUtils.lerp(physical.opacity, 1, p);
        liquid.uniforms.uQualityNoise.value = quality === "LOW" ? 0 : 1;
      }
      bed.visible = precipitate && p > 0;
      // AgCl's shallow core only fills gaps; the lobed flocs form its surface.
      bed.scale.y = Math.max(0.0001, settled * (curds ? 0.08 : TUBE_VISUALS.crystalLayerHeight));
      bed.position.y = box.min.y * (1 - bed.scale.y);
      flakes.visible = precipitate && p > 0;
      flakes.count = count;
      bubbles.visible = kind === "copper-nitric" && p > 0;
      bubbles.count = Math.max(4, Math.floor(count / 3));
      gas.visible = bubbles.visible;
      gas.count = Math.max(8, Math.floor(count / 5));
      gasMaterial.opacity = TUBE_VISUALS.gasOpacity * onset * (0.45 + 0.55 * p);
      splash.visible = splashAge >= 0 && splashAge < 1;
      splash.count = Math.max(6, Math.floor(count / 2));
      for (let i = 0; i < count; i++) {
        const angle = random(i + 1) * Math.PI * 2;
        const radial = radius * 0.64 * Math.sqrt(random(i + 93));
        const x = center.x + Math.cos(angle) * radial;
        const z = center.z + Math.sin(angle) * radial;
        const grain = radius * (curds ? 0.32 + random(i + 31) * 0.12 : 0.045);
        const floor = box.min.y + size.y * (curds ? 0.045 + random(i + 14) * (TUBE_VISUALS.curdLayerHeight - 0.09) : 0.02);
        const drift = Math.sin(time * 0.75 + i * 2.4) * radius * 0.07 * (1 - settled);
        place(flakes, i, x + drift, THREE.MathUtils.lerp(box.min.y + size.y * (0.12 + random(i + 71) * 0.78), floor, settled), z,
          grain * onset, grain * onset * (curds ? 1.5 : 0.65), grain * onset);
        if (i < bubbles.count) {
          const rise = (time * 0.48 + random(i + 42)) % 1;
          place(bubbles, i, x * 0.7, box.min.y + size.y * (0.12 + rise * 0.87), z * 0.7, radius * (0.07 + rise * 0.06) * onset);
        }
        if (i < gas.count) {
          const rise = (time * 0.12 + i / gas.count) % 1;
          const r = radius * (0.7 + rise * 0.4);
          place(gas, i, lip.x + Math.sin(time * 0.65 + i) * radius * rise,
            lip.y + r * 1.05 + rise * size.y * 0.06, lip.z, r, r * 0.85, r);
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
        curdGeometry.dispose();
        white.dispose(); bubbleMaterial.dispose(); gasMaterial.dispose(); liquid?.dispose();
        for (const mesh of [flakes, bubbles, gas, splash]) mesh.dispose();
      });
    },
  };
}
