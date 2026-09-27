import * as THREE from "three";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { deferDispose } from "./deferredDispose";
import { TubeLiquidMaterial } from "./tubeLiquidMaterial";
import type { ReactionKind, TubeChemistry } from "./tubeReactions";
import type { RuntimeQuality } from "./useRuntimeQualityStore";

export const TUBE_VISUALS = {
  copperColor: "#007fce",
  gasColor: "#8b4d24",
  gasOpacity: 0.55,
  gasBuildSeconds: 4,
  gasDecaySeconds: 18,
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
  const originalGeometry = volume.geometry;
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

  // Extend only the cylindrical wall, then clip against the world-horizontal
  // plane. The authored closed volume cannot expose a higher side on a tilt.
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + i / 12 * Math.PI / 2;
    profile.push(new THREE.Vector2(radius * Math.cos(a), box.min.y + radius + radius * Math.sin(a)));
  }
  profile.push(new THREE.Vector2(radius, box.max.y + radius));
  const wallGeometry = new THREE.LatheGeometry(profile, 48);
  wallGeometry.setAttribute("tubeSurface", new THREE.Float32BufferAttribute(new Float32Array(wallGeometry.attributes.position.count), 1));
  const capGeometry = new THREE.CircleGeometry(radius, 48);
  capGeometry.rotateX(-Math.PI / 2);
  capGeometry.setAttribute("tubeSurface", new THREE.Float32BufferAttribute(new Float32Array(capGeometry.attributes.position.count).fill(1), 1));
  const hasLiquid = base instanceof TubeLiquidMaterial && volume.visible;
  if (hasLiquid) volume.geometry = wallGeometry;

  const group = new THREE.Group();
  group.name = "TubeReactionVisuals";
  group.position.copy(volume.position);
  group.quaternion.copy(volume.quaternion);
  group.scale.copy(volume.scale);
  volume.parent?.add(group);
  const cap = new THREE.Mesh(capGeometry, baseline);
  cap.name = "TubeLiquidSurface";
  cap.visible = hasLiquid;
  cap.raycast = () => {};
  group.add(cap);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const white = new THREE.MeshStandardMaterial({ color: "#c9c7c2", roughness: 1, envMapIntensity: 0.15 });
  white.onBeforeCompile = (shader) => {
    shader.uniforms.uSedimentWhite = { value: kind === "barium-sulfate" ? 0.9 : 0.7 };
    shader.uniforms.uSedimentBottom = { value: box.min.y };
    shader.uniforms.uSedimentRadius = { value: radius * 0.98 };
    shader.uniforms.uSedimentCenter = { value: center };
    shader.vertexShader = `varying vec3 vSedimentPoint;\n${shader.vertexShader}`.replace("#include <project_vertex>", `
vSedimentPoint = transformed;
#ifdef USE_INSTANCING
vSedimentPoint = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
#include <project_vertex>`);
    shader.fragmentShader = `varying vec3 vSedimentPoint; uniform float uSedimentWhite;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
vec3 bowlPoint = vec3(vSedimentPoint.xz - uSedimentCenter.xz, min(vSedimentPoint.y - uSedimentBottom - uSedimentRadius, 0.0));
if (vSedimentPoint.y < uSedimentBottom || length(bowlPoint) > uSedimentRadius) discard;`);
    // The nearby burner saturates even non-emissive white. Bound the diffuse
    // response before bloom and keep normal-based relief instead of hot spots.
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
float relief = 0.7 + 0.3 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.3))));
outgoingLight = vec3(uSedimentWhite) * relief;
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
  const up = { value: new THREE.Vector3(0, 1, 0) };
  const level = { value: box.max.y };
  bubbleMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uWaterUp: up, uWaterLevel: level, uTubeRadius: { value: radius } });
    shader.vertexShader = `varying vec3 vBubblePoint;\n${shader.vertexShader}`.replace("#include <project_vertex>", `
vBubblePoint = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#include <project_vertex>`);
    shader.fragmentShader = `varying vec3 vBubblePoint; uniform vec3 uWaterUp; uniform float uWaterLevel; uniform float uTubeRadius;\n${shader.fragmentShader}`
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
if (length(vBubblePoint.xz) > uTubeRadius || dot(uWaterUp, vBubblePoint) > uWaterLevel) discard;`)
      .replace("#include <opaque_fragment>", `
float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 1.8);
diffuseColor.a = 0.06 + edge * 0.65;
outgoingLight = vec3(0.45, 0.58, 0.62) + totalSpecular / (vec3(1.0) + totalSpecular) * 0.3;
#include <opaque_fragment>`);
  };
  const dropletMaterial = new THREE.MeshBasicMaterial({ color: "#b9d0d4", transparent: true, opacity: 0.3, depthWrite: false });
  const splashMaterial = dropletMaterial.clone();
  splashMaterial.opacity = 0.48;
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
  const headGeometry = new THREE.CylinderGeometry(radius * 0.98, radius * 0.98, lip.y - box.min.y, 32, 1, true);
  headGeometry.translate(center.x, (lip.y + box.min.y) / 2, center.z);
  const headMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false,
    uniforms: { uUp: up, uLevel: level, uDensity: { value: 0 }, uTime: { value: 0 },
      uLip: { value: lip.y }, uRadius: { value: radius }, uColor: { value: new THREE.Color(TUBE_VISUALS.gasColor) } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vEye;
void main() { vP = position; vN = normalize(normalMatrix * normal);
vec4 mv = modelViewMatrix * vec4(position, 1.0); vEye = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uUp; uniform float uLevel; uniform float uDensity; uniform float uTime;
uniform float uLip; uniform float uRadius; uniform vec3 uColor;
varying vec3 vP; varying vec3 vN; varying vec3 vEye;
void main() {
float aboveWater = dot(uUp, vP) - uLevel;
if (aboveWater < 0.0004) discard;
float column = smoothstep(0.0, 0.006, aboveWater);
float opticalDepth = pow(abs(dot(normalize(vN), normalize(vEye))), 0.6);
float wisp = 0.8 + 0.2 * sin(vP.y * 150.0 - uTime * 1.1 + sin(vP.z / uRadius * 3.0));
float lipFade = 1.0 - 0.25 * smoothstep(uLip - 0.012, uLip, vP.y);
gl_FragColor = vec4(uColor, (1.0 - exp(-uDensity * 1.5)) * opticalDepth * column * wisp * lipFade);
#include <colorspace_fragment>
}`,
  });
  const headspace = new THREE.Mesh(headGeometry, headMaterial);
  headspace.name = "TubeNO2Headspace";
  headspace.visible = false;
  headspace.raycast = () => {};
  group.add(headspace);
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
  const condensate = makePool(dropletMaterial);
  condensate.name = "TubeCondensate";
  const splash = makePool(splashMaterial);
  splash.name = "TubeSplash";
  // The measured cavity is a radius-7 mm hemisphere at its base. Truncate
  // the top, preserving the bowl profile instead of flattening the hemisphere.
  const bedMaterial = white.clone();
  const sedimentLevel = { value: box.min.y };
  bedMaterial.onBeforeCompile = (shader, renderer) => {
    white.onBeforeCompile(shader, renderer);
    shader.uniforms.uSedimentLevel = sedimentLevel;
    shader.uniforms.uSedimentUp = up;
    shader.vertexShader = `uniform float uSedimentLevel; uniform vec3 uSedimentUp;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
transformed.y = min(position.y, uSedimentLevel - dot(uSedimentUp.xz, position.xz - uSedimentCenter.xz) / max(0.3, uSedimentUp.y));
float h = clamp(transformed.y - uSedimentBottom, 0.0, uSedimentRadius);
float availableRadius = sqrt(max(0.0, h * (2.0 * uSedimentRadius - h)));
vec2 radial = position.xz - uSedimentCenter.xz;
transformed.xz = uSedimentCenter.xz + radial * min(1.0, availableRadius / max(length(radial), 0.000001));`);
  };
  const bed = new THREE.Mesh(originalGeometry, bedMaterial);
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
  let lastTime: number | undefined;
  let lastProgress = 0;
  let gasDensity = 0;
  let bubblePhase = 0;
  let motionReady = false;
  const slope = new THREE.Vector2();
  const velocity = new THREE.Vector2();
  const gravity = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const copper = root.getObjectByName("TubeCopperGranules");
  const copperPoints = copper?.children.map(child => new THREE.Vector3(child.position.x,
    typeof child.userData.dropTargetY === "number" ? child.userData.dropTargetY : child.position.y, child.position.z)) ?? [];
  const copperBounds = copper?.children.map(child => {
    if (!(child instanceof THREE.Mesh)) return 0;
    const positions = child.geometry.getAttribute("position");
    let bound = 0;
    for (let i = 0; i < positions.count; i++) bound = Math.max(bound,
      Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)));
    return bound;
  }) ?? [];
  const source = new THREE.Vector3();
  const bubblePoint = new THREE.Vector3();
  return {
    update(chemistry: TubeChemistry, time: number, quality: RuntimeQuality, splashAge: number) {
      const { progress } = chemistry;
      const rate = Number.isFinite(chemistry.rate) ? THREE.MathUtils.clamp(chemistry.rate, 0, 1) : 0;
      const temperature = Number.isFinite(chemistry.temperature) ? THREE.MathUtils.clamp(chemistry.temperature, 0, 1) : 0;
      const p = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
      const reverseTime = lastTime !== undefined && time < lastTime;
      const dt = lastTime === undefined ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, 0.1);
      lastTime = time;
      volume.updateWorldMatrix(true, false);
      const e = volume.matrixWorld.elements;
      const targetX = -e[1] / Math.max(0.001, e[5]);
      const targetZ = -e[9] / Math.max(0.001, e[5]);
      if (!motionReady) { slope.set(targetX, targetZ); motionReady = true; }
      // Same bounded spring integration as inspectionSlosh, driven by actual
      // matrix motion instead of its scripted bottle-inspection animation.
      for (let t = 0; t < dt;) {
        const step = Math.min(1 / 120, dt - t); t += step;
        velocity.x += (144 * (targetX - slope.x) - 7 * velocity.x) * step;
        velocity.y += (144 * (targetZ - slope.y) - 7 * velocity.y) * step;
        slope.addScaledVector(velocity, step);
      }
      up.value.set(-slope.x, 1, -slope.y).normalize();
      level.value = up.value.x * center.x + up.value.y * box.max.y + up.value.z * center.z;
      inverse.copy(volume.matrixWorld).invert();
      gravity.set(0, 1, 0).transformDirection(inverse);
      // A visual reservoir outlives the instantaneous chemical rate. Seeking
      // backwards resets it; a completed reaction dissipates over tens of seconds.
      if (p < lastProgress || p === 0 || reverseTime) { gasDensity = 0; bubblePhase = 0; }
      lastProgress = p;
      bubblePhase += dt * (0.3 + rate * 0.4);
      const drive = kind === "copper-nitric" ? Math.max(0, rate) : 0;
      gasDensity = THREE.MathUtils.clamp(gasDensity + dt * (drive / TUBE_VISUALS.gasBuildSeconds - gasDensity / TUBE_VISUALS.gasDecaySeconds), 0, 1);
      const count = TUBE_VISUALS.particleCounts[quality];
      const precipitate = kind === "silver-chloride" || kind === "barium-sulfate";
      const curds = kind === "silver-chloride";
      const onset = THREE.MathUtils.smoothstep(p, 0, 0.08);
      const settled = THREE.MathUtils.smoothstep(p, TUBE_VISUALS.settlingStart, TUBE_VISUALS.settlingEnd);
      volume.material = p > 0 && liquid ? liquid : baseline;
      cap.material = volume.material;
      const activeLiquid = p > 0 && liquid ? liquid : base instanceof TubeLiquidMaterial ? base : null;
      if (activeLiquid) {
        activeLiquid.uniforms.uUp.value.copy(up.value);
        activeLiquid.uniforms.uLevel.value = level.value;
        activeLiquid.uniforms.uRate.value = rate;
        activeLiquid.uniforms.uTemperature.value = temperature;
        activeLiquid.uniforms.uTime.value = time;
      }
      if (liquid) {
        liquid.uniforms.uTime.value = time;
        liquid.uniforms.uReactionProgress.value = p;
        liquid.uniforms.uReactionKind.value = kind === "copper-nitric" ? 1 : curds ? 2 : kind === "barium-sulfate" ? 3 : 4;
        liquid.uniforms.uCloudiness.value = precipitate ? onset * (1 - settled) : 0;
        liquid.uniforms.uOpacity.value = precipitate ? 0.3
          : kind === "permanganate-redox" ? THREE.MathUtils.lerp(baseOpacity, 0.14, p) : THREE.MathUtils.lerp(baseOpacity, 0.68, p);
        liquid.uniforms.uQualityNoise.value = quality === "LOW" ? 0 : 1;
      }
      bed.visible = precipitate && settled > 0;
      // AgCl's shallow core only fills gaps; the lobed flocs form its surface.
      sedimentLevel.value = box.min.y + size.y * settled * (curds ? 0.08 : TUBE_VISUALS.crystalLayerHeight);
      flakes.visible = precipitate && p > 0;
      flakes.count = count;
      bubbles.visible = kind === "copper-nitric" && (rate > 0.005 || temperature > 0.85);
      bubbles.count = Math.max(1, Math.floor(count * (rate * 0.75 + Math.max(0, temperature - 0.85))));
      gas.visible = gasDensity > 0.008;
      headspace.visible = gas.visible;
      gas.count = Math.max(8, Math.floor(count / 5));
      gasMaterial.uniforms.uOpacity.value = TUBE_VISUALS.gasOpacity * gasDensity;
      gasMaterial.uniforms.uTime.value = time;
      headMaterial.uniforms.uDensity.value = gasDensity;
      headMaterial.uniforms.uTime.value = time;
      condensate.visible = kind === "copper-nitric" && temperature > 0.6;
      condensate.count = Math.floor(count / 3);
      dropletMaterial.opacity = 0.15 + temperature * 0.25;
      if (copper) {
        const shrink = Math.cbrt(Math.max(0, 1 - p));
        copper.children.forEach((child, i) => {
          // A bounding sphere encloses every rotated, irregular grain. Fit
          // that sphere inside the bowl instead of trusting its drop target.
          const fit = Math.min(1, radius * 0.86 / Math.max(copperBounds[i], 0.000001));
          child.scale.setScalar(shrink * fit);
          child.visible = shrink > 0.03;
          child.position.copy(copperPoints[i]);
          child.position.y = box.min.y + (child.position.y - box.min.y) * shrink;
          const clearance = Math.max(0, radius * 0.98 - copperBounds[i] * shrink * fit);
          child.position.x = center.x + (child.position.x - center.x) * shrink - gravity.x * clearance;
          child.position.z = center.z + (child.position.z - center.z) * shrink - gravity.z * clearance;
          const radial = Math.hypot(child.position.x - center.x, child.position.z - center.z);
          if (radial > clearance * 0.98) {
            const factor = clearance * 0.98 / Math.max(radial, 0.000001);
            child.position.x = center.x + (child.position.x - center.x) * factor;
            child.position.z = center.z + (child.position.z - center.z) * factor;
          }
          const offsetSq = (child.position.x - center.x) ** 2 + (child.position.z - center.z) ** 2;
          child.position.y = Math.max(child.position.y,
            box.min.y + radius - Math.sqrt(Math.max(0, clearance * clearance - offsetSq)));
        });
      }
      splash.visible = splashAge >= 0 && splashAge < 1;
      splash.count = Math.max(6, Math.floor(count / 2));
      const activeCount = Math.max(flakes.visible ? count : 0, bubbles.visible ? bubbles.count : 0,
        gas.visible ? gas.count : 0, condensate.visible ? condensate.count : 0, splash.visible ? splash.count : 0);
      for (let i = 0; i < activeCount; i++) {
        const angle = random(i + 1) * Math.PI * 2;
        const radial = radius * 0.64 * Math.sqrt(random(i + 93));
        const x = center.x + Math.cos(angle) * radial;
        const z = center.z + Math.sin(angle) * radial;
        const grain = radius * (curds ? (0.32 + random(i + 31) * 0.12) * (0.45 + settled * 0.55) : 0.045);
        const floor = box.min.y + size.y * (curds ? 0.045 + random(i + 14) * (TUBE_VISUALS.curdLayerHeight - 0.09) : 0.02);
        const drift = Math.sin(time * 0.75 + i * 2.4) * radius * 0.07 * (1 - settled);
        const ingress = curds ? THREE.MathUtils.smoothstep(p * 9, 1 - random(i + 71) - 0.1, 1 - random(i + 71) + 0.1) : 1;
        if (flakes.visible) place(flakes, i, x + drift - gravity.x * radius * settled * 0.6, THREE.MathUtils.lerp(box.min.y + size.y * (0.12 + random(i + 71) * 0.78), floor - gravity.z * z, settled), z - gravity.z * radius * settled * 0.6,
          grain * onset * ingress, grain * onset * ingress * (curds ? 1.5 : 0.65), grain * onset * ingress);
        if (bubbles.visible && i < bubbles.count) {
          const rise = (bubblePhase + random(i + 42)) % 1;
          const grainMesh = copper?.children[i % Math.max(1, copper.children.length)];
          if (grainMesh instanceof THREE.Mesh && p < 0.999 && i < count * rate * 0.75) {
            const vertices = grainMesh.geometry.getAttribute("position");
            source.fromBufferAttribute(vertices, (i * 7) % vertices.count).multiply(grainMesh.scale)
              .applyQuaternion(grainMesh.quaternion).add(grainMesh.position);
          }
          else source.set(x * 0.6, box.min.y + radius * 1.3, z * 0.6);
          const distance = Math.max(0, (level.value - up.value.dot(source)) / Math.max(0.3, up.value.dot(gravity)));
          bubblePoint.copy(source).addScaledVector(gravity, rise * distance);
          // A rising bubble hits the wall and slides along it, never exits sideways.
          const radialDistance = Math.hypot(bubblePoint.x, bubblePoint.z);
          if (radialDistance > radius * 0.84) { bubblePoint.x *= radius * 0.84 / radialDistance; bubblePoint.z *= radius * 0.84 / radialDistance; }
          const coldGate = rate > 0.1 || (time + random(i + 14) * 5) % 4 < 1.5;
          place(bubbles, i, bubblePoint.x, bubblePoint.y, bubblePoint.z, coldGate ? radius * (0.045 + rise * 0.06) : 0);
        }
        if (gas.visible && i < gas.count) {
          const rise = i === 0 ? 0 : (time * 0.13 + i / gas.count) % 1;
          const r = radius * (0.65 + rise * 1.2);
          place(gas, i, lip.x + gravity.x * rise * radius * 5 + Math.sin(time * 0.65 + i) * radius * rise,
            lip.y + radius * 0.12 + gravity.y * rise * radius * 5, lip.z + gravity.z * rise * radius * 5, r, r * 1.2, r);
        }
        if (condensate.visible && i < condensate.count) {
          place(condensate, i, Math.cos(angle) * radius * 0.99,
            THREE.MathUtils.lerp(box.max.y + radius * 2, lip.y - radius, random(i + 29)), Math.sin(angle) * radius * 0.99,
            radius * (0.03 + random(i + 3) * 0.055), radius * 0.09);
        }
        if (splash.visible && i < splash.count) {
          const age = Math.max(0, splashAge);
          const speed = size.y * (0.8 + random(i + 4));
          place(splash, i, lip.x + Math.cos(angle) * speed * age, lip.y + speed * age * 2 - size.y * 4 * age * age,
            lip.z + Math.sin(angle) * speed * age, radius * 0.16 * (1 - Math.min(age, 1)));
        }
      }
      for (const mesh of [flakes, bubbles, gas, splash, condensate]) if (mesh.visible) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      volume.material = baseline;
      volume.geometry = originalGeometry;
      group.removeFromParent();
      deferDispose(group, () => {
        geometry.dispose();
        wallGeometry.dispose(); capGeometry.dispose(); headGeometry.dispose(); headMaterial.dispose(); dropletMaterial.dispose(); splashMaterial.dispose();
        gasGeometry.dispose(); bedMaterial.dispose();
        curdGeometry.dispose();
        white.dispose(); bubbleMaterial.dispose(); gasMaterial.dispose(); liquid?.dispose();
        for (const mesh of [flakes, bubbles, gas, splash, condensate]) mesh.dispose();
      });
    },
  };
}
