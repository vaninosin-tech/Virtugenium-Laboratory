import * as THREE from "three";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { deferDispose } from "./deferredDispose";
import { TubeLiquidMaterial } from "./tubeLiquidMaterial";
import type { ReactionKind } from "./tubeReactions";
import type { RuntimeQuality } from "./useRuntimeQualityStore";

export const TUBE_VISUALS = {
  copperColor: "#007fce",
  gasColor: "#8b4d24",
  gasOpacity: 0.4,
  particleCounts: { LOW: 24, MEDIUM: 36, HIGH: 54, ULTRA: 72 },
  curdLayerHeight: 0.24,
  crystalLayerHeight: 0.065,
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
  const baseOpacity = physical instanceof TubeLiquidMaterial ? physical.uniforms.uOpacity.value : physical.opacity;
  const baseColor = physical instanceof TubeLiquidMaterial ? physical.uniforms.uBaseColor.value : physical.color;
  const liquid = kind ? new TubeLiquidMaterial(volume.geometry, {
    color: kind === "permanganate-redox" ? REAGENTS.kmno4.contentsColor : `#${baseColor?.getHexString() ?? "ffffff"}`,
    opacity: baseOpacity,
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
  const white = new THREE.MeshStandardMaterial({ color: "#c9c7c2", roughness: 1, envMapIntensity: 0.15 });
  white.onBeforeCompile = (shader) => {
    shader.uniforms.uSedimentBottom = { value: box.min.y };
    shader.uniforms.uSedimentRadius = { value: radius * 0.98 };
    shader.uniforms.uSedimentCenter = { value: center };
    shader.vertexShader = `varying vec3 vSedimentPoint;\n${shader.vertexShader}`.replace("#include <project_vertex>", `
vSedimentPoint = transformed;
#ifdef USE_INSTANCING
vSedimentPoint = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
#include <project_vertex>`);
    shader.fragmentShader = `varying vec3 vSedimentPoint;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
vec3 bowlPoint = vec3(vSedimentPoint.xz - uSedimentCenter.xz, min(vSedimentPoint.y - uSedimentBottom - uSedimentRadius, 0.0));
if (vSedimentPoint.y < uSedimentBottom || length(bowlPoint) > uSedimentRadius) discard;`);
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
  const gasGeometry = new THREE.PlaneGeometry(2, 2);
  const gasMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(TUBE_VISUALS.gasColor) },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uLip: { value: lip.y }, uHeight: { value: radius * 4 } },
    vertexShader: `varying vec2 vP; varying float vGasHeight;
void main() {
  vP = position.xy;
  vec2 extent = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vGasHeight = instanceMatrix[3].y + position.y * extent.y;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * extent * vec2(length(modelViewMatrix[0].xyz), length(modelViewMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
uniform float uLip; uniform float uHeight;
varying vec2 vP; varying float vGasHeight;
void main() {
  if (vGasHeight < uLip - 0.0005) discard;
  vec2 p = vP + 0.13 * vec2(sin(vP.y * 6.0 + uTime), cos(vP.x * 7.0 - uTime * 0.7));
  float edge = 1.0 - smoothstep(0.2, 1.0, length(p));
  float wisps = 0.65 + 0.35 * sin(p.x * 8.0 + sin(p.y * 6.0) - uTime * 0.8);
  float fade = 1.0 - smoothstep(uLip + uHeight * 0.3, uLip + uHeight, vGasHeight);
  gl_FragColor = vec4(uColor, uOpacity * edge * edge * wisps * fade);
  #include <colorspace_fragment>
}`,
  });
  const makePool = (material: THREE.Material): THREE.InstancedMesh => {
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
  gas.geometry = gasGeometry;
  gas.name = "TubeNO2";
  const splash = makePool(bubbleMaterial);
  splash.name = "TubeSplash";
  // The measured cavity is a radius-7 mm hemisphere at its base. Truncate
  // the top, preserving the bowl profile instead of flattening the hemisphere.
  const bedMaterial = white.clone();
  const sedimentLevel = { value: box.min.y };
  bedMaterial.onBeforeCompile = (shader, renderer) => {
    white.onBeforeCompile(shader, renderer);
    shader.uniforms.uSedimentLevel = sedimentLevel;
    shader.vertexShader = `uniform float uSedimentLevel;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
transformed.y = min(position.y, uSedimentLevel);
float h = clamp(transformed.y - uSedimentBottom, 0.0, uSedimentRadius);
float availableRadius = sqrt(max(0.0, h * (2.0 * uSedimentRadius - h)));
vec2 radial = position.xz - uSedimentCenter.xz;
transformed.xz = uSedimentCenter.xz + radial * min(1.0, availableRadius / max(length(radial), 0.000001));`);
  };
  const bed = new THREE.Mesh(volume.geometry, bedMaterial);
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
          : kind === "permanganate-redox" ? THREE.MathUtils.lerp(baseOpacity, 0.14, p) : THREE.MathUtils.lerp(baseOpacity, 1, p);
        liquid.uniforms.uQualityNoise.value = quality === "LOW" ? 0 : 1;
      }
      bed.visible = precipitate && settled > 0;
      // AgCl's shallow core only fills gaps; the lobed flocs form its surface.
      sedimentLevel.value = box.min.y + size.y * settled * (curds ? 0.08 : TUBE_VISUALS.crystalLayerHeight);
      flakes.visible = precipitate && p > 0;
      flakes.count = count;
      bubbles.visible = kind === "copper-nitric" && p > 0;
      bubbles.count = Math.max(4, Math.floor(count / 3));
      gas.visible = bubbles.visible;
      gas.count = Math.max(8, Math.floor(count / 5));
      gasMaterial.uniforms.uOpacity.value = TUBE_VISUALS.gasOpacity * onset * (0.45 + 0.55 * p);
      gasMaterial.uniforms.uTime.value = time;
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
          const rise = i === 0 ? 0 : (time * 0.13 + i / gas.count) % 1;
          const r = radius * (0.65 + rise * 1.2);
          place(gas, i, lip.x + Math.sin(time * 0.65 + i) * radius * rise,
            lip.y + radius * 0.12 + rise * radius * 2.4, lip.z, r, r * 0.8, r);
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
        gasGeometry.dispose(); bedMaterial.dispose();
        curdGeometry.dispose();
        white.dispose(); bubbleMaterial.dispose(); gasMaterial.dispose(); liquid?.dispose();
        for (const mesh of [flakes, bubbles, gas, splash]) mesh.dispose();
      });
    },
  };
}
