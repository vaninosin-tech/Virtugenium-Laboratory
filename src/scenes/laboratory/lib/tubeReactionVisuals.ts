import * as THREE from "three";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { deferDispose } from "./deferredDispose";
import { TubeLiquidMaterial, bariumCloudGLSL } from "./tubeLiquidMaterial";
import { TubeBariumField } from "./tubeBariumField";
import { TubeSilverField } from "./tubeSilverField";
import { BariumSedimentField, BariumSedimentGeometry } from "./tubeBariumSediment";
import { SilverSedimentField, SilverSedimentGeometry } from "./tubeSilverSediment";
import { TubeMixingField } from "./tubeMixingField";
import { TubeImmersion } from "./tubeImmersion";
import { cameraInTubeSpace, TubeAbsorptionMaterial } from "./tubeAbsorptionMaterial";
import { TubeVolumeField } from "./tubeVolumeField";
import { TubePermanganateField } from "./tubePermanganateField";
import { tubePourImpact } from "./tubePourImpact";
import { updateTubeFlowDebug } from "./tubeFlowDebug";
import { seedTubeAmounts, syncBariumExtent, syncSilverExtent, syncCopperProgress, syncPermanganateExtent, tubeAmount } from "./tubeAmounts";
import { tubeEffectiveRadius, tubeLiquidFill, tubeLiquidHeight } from "./tubeLiquidLevel";
import { TubeMotion } from "./tubeMotion";
import { CLAMP_TUBE_MOUTH } from "./useStandMotionStore";
import { fillTestTubeContents, resolveTubeContents, testTubeLiquidFill } from "./testTubeContents";
import { copperGranuleRadiusScale, useTubeReactionStore, type ReactionKind, type TubeChemistry } from "./tubeReactions";
import { GasState, readDeveloperOxygen } from "./tubeGasState";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { NO_BUBBLE_CAPACITY, TubeNOBubbles } from "./tubeNOBubbles";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";
import { useRuntimeQualityStore, type RuntimeQuality } from "./useRuntimeQualityStore";

export const TUBE_VISUALS = {
  copperColor: "#1f7cc2",
  gasColor: "#967967",
  gasOpacity: 0.055,
  gasBuildSeconds: 4,
  gasDecaySeconds: 18,
  gasResidueSeconds: 350,
  particleCounts: { LOW: 24, MEDIUM: 36, HIGH: 54, ULTRA: 72 },
  curdLayerHeight: 0.21,
  settlingStart: 0.18,
  settlingEnd: 0.94,
};

const MENISCUS_RISE = 0.0008;

/** Small damped height field shared by the cap vertices; no waves at rest. */
class TubeSurfaceWaves {
  readonly geometry: THREE.BufferGeometry;
  activity = 0;
  private readonly radius: number;
  private cells = 0;
  private height = new Float32Array(0);
  private velocity = new Float32Array(0);
  private next = new Float32Array(0);
  private mask = new Uint8Array(0);

  constructor(radius: number) {
    this.radius = radius;
    const rings = 12, sectors = 48;
    const positions = [0, 0, 0];
    const normals = [0, 1, 0];
    const waves = [0];
    const indices: number[] = [];
    for (let ring = 1; ring <= rings; ring++) {
      const r = radius * ring / rings;
      for (let sector = 0; sector < sectors; sector++) {
        const angle = sector * Math.PI * 2 / sectors;
        positions.push(Math.cos(angle) * r, 0, -Math.sin(angle) * r);
        normals.push(0, 1, 0);
        waves.push(0);
        const current = 1 + (ring - 1) * sectors + sector;
        const next = 1 + (ring - 1) * sectors + (sector + 1) % sectors;
        if (ring === 1) indices.push(0, current, next);
        else {
          const inner = current - sectors;
          const innerNext = next - sectors;
          indices.push(inner, current, next, inner, next, innerNext);
        }
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(indices);
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    this.geometry.setAttribute("tubeWave", new THREE.Float32BufferAttribute(waves, 1));
    this.geometry.setAttribute("tubeWaveSlope", new THREE.Float32BufferAttribute(new Float32Array(waves.length), 1));
    this.geometry.setAttribute("tubeSurface", new THREE.Float32BufferAttribute(new Float32Array(waves.length).fill(1), 1));
  }

  setQuality(quality: RuntimeQuality) {
    const cells = quality === "LOW" ? 13 : quality === "MEDIUM" ? 19 : 25;
    if (cells === this.cells) return;
    this.cells = cells;
    this.height = new Float32Array(cells * cells);
    this.velocity = new Float32Array(cells * cells);
    this.next = new Float32Array(cells * cells);
    this.mask = new Uint8Array(cells * cells);
    for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
      const nx = 2 * x / (cells - 1) - 1, nz = 2 * z / (cells - 1) - 1;
      this.mask[z * cells + x] = nx * nx + nz * nz <= 1 ? 1 : 0;
    }
    this.geometry.userData.waveCells = cells;
  }

  reset() {
    this.height.fill(0); this.velocity.fill(0); this.next.fill(0);
    this.updateGeometry();
  }

  impulse(x: number, z: number, amplitude: number, spread = 0.18) {
    if (!this.cells) return;
    const n = this.cells, inv = 1 / (spread * spread);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const index = iz * n + ix;
      if (!this.mask[index]) continue;
      const dx = 2 * ix / (n - 1) - 1 - x, dz = 2 * iz / (n - 1) - 1 - z;
      this.height[index] += amplitude * Math.exp(-3 * (dx * dx + dz * dz) * inv);
    }
  }

  advance(dt: number) {
    const n = this.cells;
    if (!n) return;
    const steps = Math.max(1, Math.ceil(dt * 60));
    const step = dt / steps;
    const stiffness = Math.pow(1.3 * (n - 1) / 2, 2);
    for (let frame = 0; frame < steps; frame++) {
      let sum = 0, count = 0;
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const i = z * n + x;
        if (!this.mask[i]) continue;
        const h = this.height[i];
        const left = x > 0 && this.mask[i - 1] ? this.height[i - 1] : h;
        const right = x + 1 < n && this.mask[i + 1] ? this.height[i + 1] : h;
        const back = z > 0 && this.mask[i - n] ? this.height[i - n] : h;
        const front = z + 1 < n && this.mask[i + n] ? this.height[i + n] : h;
        this.velocity[i] = (this.velocity[i] + (left + right + back + front - 4 * h) * stiffness * step)
          * Math.exp(-4.5 * step);
        this.next[i] = h + this.velocity[i] * step;
        sum += this.next[i]; count++;
      }
      const mean = count ? sum / count : 0;
      for (let i = 0; i < this.next.length; i++) if (this.mask[i]) this.next[i] -= mean;
      [this.height, this.next] = [this.next, this.height];
    }
    this.updateGeometry();
  }

  private sample(x: number, z: number) {
    const n = this.cells;
    if (!n) return 0;
    const gx = THREE.MathUtils.clamp((x + 1) * (n - 1) / 2, 0, n - 1.001);
    const gz = THREE.MathUtils.clamp((z + 1) * (n - 1) / 2, 0, n - 1.001);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const a = iz * n + ix, b = a + n;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.height[a], this.height[a + 1], fx),
      THREE.MathUtils.lerp(this.height[b], this.height[b + 1], fx), fz);
  }

  private updateGeometry() {
    const position = this.geometry.getAttribute("position");
    const normal = this.geometry.getAttribute("normal");
    const wave = this.geometry.getAttribute("tubeWave");
    const waveSlope = this.geometry.getAttribute("tubeWaveSlope");
    const epsilon = 2 / Math.max(1, this.cells - 1);
    let peak = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) / this.radius, z = position.getZ(i) / this.radius;
      const height = this.sample(x, z);
      wave.setX(i, height);
      peak = Math.max(peak, Math.abs(height));
      const waveDx = (this.sample(x + epsilon, z) - this.sample(x - epsilon, z)) / (2 * epsilon * this.radius);
      const waveDz = (this.sample(x, z + epsilon) - this.sample(x, z - epsilon)) / (2 * epsilon * this.radius);
      const r = Math.hypot(x, z);
      const s = THREE.MathUtils.clamp((r - 0.67) / 0.33, 0, 1);
      const radialSlope = r > 0 ? 2 * MENISCUS_RISE * s / (0.33 * this.radius * r) : 0;
      const dx = waveDx + radialSlope * x;
      const dz = waveDz + radialSlope * z;
      waveSlope.setX(i, -(waveDx * 0.78 + waveDz * 0.62));
      const inv = 1 / Math.hypot(dx, 1, dz);
      normal.setXYZ(i, -dx * inv, inv, -dz * inv);
    }
    wave.needsUpdate = true;
    this.activity = Math.min(1, peak / (this.radius * 0.035));
    waveSlope.needsUpdate = true;
    normal.needsUpdate = true;
  }
}

/** Opaque-scene displacement drawn before the original transparent water. */
function createWaterBackdropMaterial(radius: number, minY: number, height: number, transport: TubeMixingField | null,
  optics: TubeLiquidMaterial) {
  const material = new THREE.MeshPhysicalMaterial({
    color: "#ffffff", roughness: 0, metalness: 0, ior: 1.333,
    transmission: 1, thickness: radius * 1.8, depthWrite: false,
    side: THREE.FrontSide,
  });
  const up = { value: new THREE.Vector3(0, 1, 0) };
  const level = { value: 0 };
  const tracerStrength = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uBackdropUp = up;
    shader.uniforms.uBackdropLevel = level;
    shader.uniforms.uTracer = { value: transport?.texture ?? null };
    shader.uniforms.uTracerStrength = tracerStrength;
    // The opaque-scene sampler contains no transparent solution. Attenuate
    // that background along its path through the liquid before compositing
    // the surface sheen; changing the cap alpha cannot replace this pass.
    shader.uniforms.uOpticalCamera = optics.uniforms.uCameraLocal;
    shader.uniforms.uOpticalKind = optics.uniforms.uReactionKind;
    shader.uniforms.uOpticalProgress = optics.uniforms.uReactionProgress;
    shader.uniforms.uOpticalCloud = optics.uniforms.uCloudiness;
    shader.uniforms.uOpticalHaze = optics.uniforms.uResidualHaze;
    shader.uniforms.uOpticalAge = optics.uniforms.uTransportAge;
    shader.uniforms.uBaField = optics.uniforms.uBaField;
    shader.uniforms.uBaActive = optics.uniforms.uBaActive;
    shader.vertexShader = `attribute float tubeSurface; attribute float tubeWave; attribute float tubeWaveSlope;
uniform vec3 uBackdropUp; uniform float uBackdropLevel;
varying vec3 vBackdropPoint; varying float vBackdropCap; varying float vBackdropWave;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vBackdropCap = tubeSurface;
vBackdropWave = tubeWaveSlope;
if (tubeSurface > 0.5) transformed.y =
  (uBackdropLevel - dot(uBackdropUp.xz, position.xz)) / max(uBackdropUp.y, 0.2)
  + 0.0008 * pow(clamp((length(position.xz) / ${radius.toFixed(7)} - 0.67) / 0.33, 0.0, 1.0), 2.0) + tubeWave;
vBackdropPoint = transformed;`);
    shader.fragmentShader = `uniform vec3 uBackdropUp; uniform float uBackdropLevel;
uniform sampler2D uTracer; uniform float uTracerStrength;
uniform vec3 uOpticalCamera;
uniform float uOpticalKind, uOpticalProgress, uOpticalCloud, uOpticalHaze, uOpticalAge;
uniform sampler3D uBaField; uniform float uBaActive;
varying vec3 vBackdropPoint; varying float vBackdropCap; varying float vBackdropWave;
${bariumCloudGLSL}
vec3 transmitThroughTube(vec3 background) {
  if (uOpticalKind < 2.5 || uOpticalKind > 3.5) return background;
  vec3 ray = normalize(vBackdropPoint - uOpticalCamera);
  float radius = ${radius.toFixed(7)};
  float bottom = ${minY.toFixed(7)};
  float a = max(dot(ray.xz, ray.xz), 0.000001);
  float b = dot(vBackdropPoint.xz, ray.xz);
  float side = (-b + sqrt(max(0.0, b * b + a *
    (radius * radius - dot(vBackdropPoint.xz, vBackdropPoint.xz))))) / a;
  float distance = max(0.0, side);
  if (ray.y < -0.00001) {
    vec3 fromBowlCenter = vBackdropPoint - vec3(0.0, bottom + radius, 0.0);
    float bowlB = dot(fromBowlCenter, ray);
    float bowlDisc = bowlB * bowlB - dot(fromBowlCenter, fromBowlCenter) + radius * radius;
    if (bowlDisc >= 0.0) {
      float bowlExit = -bowlB + sqrt(bowlDisc);
      if (bowlExit > 0.0 && vBackdropPoint.y + ray.y * bowlExit < bottom + radius)
        distance = min(distance, bowlExit);
    } else {
      float rimExit = (bottom + radius - vBackdropPoint.y) / ray.y;
      if (rimExit > 0.0) distance = min(distance, rimExit);
    }
  }
  float upRay = dot(uBackdropUp, ray);
  if (upRay > 0.00001) distance = min(distance,
    max(0.0, (uBackdropLevel - dot(uBackdropUp, vBackdropPoint)) / upRay));
  distance = min(distance, ${height.toFixed(7)} * 2.0);
  vec3 transmission = vec3(1.0);
  float scattering = 0.0;
  for (int sampleIndex = 0; sampleIndex < 6; sampleIndex++) {
    vec3 q = vBackdropPoint + ray * distance * (float(sampleIndex) + 0.5) / 6.0;
    float h = clamp((q.y - bottom) / ${height.toFixed(7)}, 0.0, 1.0);
    if (uOpticalKind < 1.5) {
      float mixed = smoothstep(0.18, 0.78, uOpticalProgress);
      float concentration = mixed * (0.79 + 0.21 * (1.0 - h));
      concentration = mix(concentration, 1.0, smoothstep(0.72, 1.0, uOpticalProgress));
      transmission *= exp(-mix(vec3(0.75, 0.30, 0.32), vec3(3.6, 1.15, 0.28), smoothstep(0.55, 1.0, uOpticalProgress)) * concentration * distance / (6.0 * radius));
    } else if (uOpticalKind > 2.5) {
      vec3 uvw = clamp(vec3((q.x + radius) / (2.0 * radius), h,
        (q.z + radius) / (2.0 * radius)), 0.0, 1.0);
      float density = uBaActive > 0.5 ? texture(uBaField, uvw).r : 0.0;
      scattering += density * distance / (6.0 * radius) * 3.0;
    }
  }
  return mix(background * transmission, vec3(0.94), 1.0 - exp(-scattering));
}
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
if (vBackdropCap < 0.5 && dot(uBackdropUp, vBackdropPoint) > uBackdropLevel + 0.0004) discard;`)
      .replace("#include <opaque_fragment>", `
vec2 screenUv = gl_FragCoord.xy / transmissionSamplerSize;
vec2 bend = vBackdropCap > 0.5 ? vec2(vNormal.x * 14.0, vNormal.z * 8.0)
  : vec2(vNormal.x * 24.0, 0.0);
vec2 tracerUv = vec2(clamp(0.5 + length(vBackdropPoint.xz) / ${(radius * 2).toFixed(7)}, 0.0, 1.0),
  clamp((vBackdropPoint.y - ${minY.toFixed(7)}) / ${height.toFixed(7)}, 0.0, 1.0));
float tracerLeft = texture2D(uTracer, tracerUv - vec2(0.025, 0.0)).g;
float tracerRight = texture2D(uTracer, tracerUv + vec2(0.025, 0.0)).g;
bend.x += (tracerRight - tracerLeft) * 11.0 * uTracerStrength;
vec3 backdrop = texture2D(transmissionSamplerMap,
  clamp(screenUv + bend / transmissionSamplerSize, vec2(0.001), vec2(0.999))).rgb * 1.32;
vec3 straight = texture2D(transmissionSamplerMap, clamp(screenUv, vec2(0.001), vec2(0.999))).rgb;
float edgeSoft = vBackdropCap > 0.5
  ? clamp(abs(vBackdropWave) * 8.0, 0.0, 1.0)
  : mix(0.25, 1.0, smoothstep(0.0, 0.03, uBackdropLevel - dot(uBackdropUp, vBackdropPoint)));
backdrop = mix(straight, backdrop, edgeSoft);
backdrop = transmitThroughTube(backdrop);
gl_FragColor = vec4(backdrop, 1.0);`);
  };
  material.customProgramCacheKey = () => "tube-water-backdrop-v7-barium-field";
  return { material, up, level, tracerStrength };
}

function createCausticMaterial() {
  return new THREE.ShaderMaterial({
    name: "TubeCaustic",
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: {
      uTint: { value: new THREE.Color("#e2f5ff") },
      uStrength: { value: 0 }, uWave: { value: 0 }, uTime: { value: 0 }, uBillboard: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; uniform float uBillboard;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 view = modelViewMatrix * vec4(uBillboard > 0.5 ? vec3(0.0) : position, 1.0);
  if (uBillboard > 0.5) view.xy += position.xy;
  gl_Position = projectionMatrix * view;
}`,
    fragmentShader: `varying vec2 vUv;
uniform vec3 uTint; uniform float uStrength; uniform float uWave; uniform float uTime;
void main() {
  vec2 p = vUv;
  float drift = uWave * sin(uTime * 3.1 + p.y * 5.0) * 0.11;
  float band = exp(-pow((p.x - 0.18 * sin(p.y * 2.7) - drift) / 0.16, 2.0));
  float fringe = exp(-pow((p.x + 0.33 + 0.08 * sin(p.y * 3.9 + uWave * uTime * 2.0)) / 0.11, 2.0));
  float falloff = exp(-dot(p, p) * 1.6);
  float light = (band * 0.8 + fringe * 0.4) * falloff * uStrength;
  gl_FragColor = vec4(uTint, light);
}`,
  });
}

/** Fixed pools survive progress updates, including seeking backwards in F8. */
const bariumWarmups = new WeakMap<THREE.WebGLRenderer, Map<string, Promise<void>>>();

/** Compile every reaction mesh before the final reagent is poured. */
export function prewarmBariumLiquidShader(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  camera: THREE.Camera, kind: ReactionKind = "barium-sulfate"): Promise<void> {
  const cache = bariumWarmups.get(renderer) ?? new Map<string, Promise<void>>();
  bariumWarmups.set(renderer, cache);
  const prior = cache.get(kind);
  if (prior) return prior;
  const task = (async () => {
    let source: THREE.Object3D | null = null;
    // React mounts the replacement tube after the sandbox click handler exits.
    // Wait for its filled mesh before preparing the expensive reaction variants.
    for (let frame = 0; frame < 90 && !source; frame++) {
      let nearest = Infinity;
      scene.traverse(object => {
        if (object.name !== "TubeReactionVisuals" || !object.parent) return;
        const cavity = object.parent.children.find(child => child.name.startsWith("ContentsVolume"));
        if (!(cavity instanceof THREE.Mesh) || (!cavity.visible && kind !== "copper-nitric")) return;
        const distance = CLAMP_TUBE_MOUTH.valid
          ? object.getWorldPosition(new THREE.Vector3()).distanceToSquared(CLAMP_TUBE_MOUTH.point) : 0;
        if (distance < nearest) { source = object.parent; nearest = distance; }
      });
      if (!source) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    if (!source) throw new Error("No filled tube available for reaction shader warmup");
    const preview = (source as THREE.Object3D).clone(true);
    const existingContents: THREE.Object3D[] = [];
    preview.traverse(object => { if (object.name === "TubeCopperGranules") existingContents.push(object); });
    for (const object of existingContents) object.removeFromParent();
    const reagents = kind === "copper-nitric" ? ["cu", "hno3"]
      : kind === "silver-chloride" ? ["agno3", "nacl"]
        : kind === "barium-sulfate" ? ["bacl2", "k2so4"]
          : ["na2so3", "h2so4", "kmno4"];
    fillTestTubeContents(preview, resolveTubeContents(reagents));
    const previous: THREE.Object3D[] = [];
    preview.traverse(object => { if (object.name === "TubeReactionVisuals") previous.push(object); });
    for (const object of previous) object.removeFromParent();
    const visuals = createTubeReactionVisuals(preview, kind,
      { activeSurface: true, pour: true, liquidCount: 2 });
    if (!visuals) throw new Error("Reaction preview has no visuals");
    visuals.update({ progress: 0.3, rate: 0.2, temperature: 0, age: 1 },
      1, useRuntimeQualityStore.getState().quality, 0.5, false, camera.position);
    preview.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.visible = true;
      object.frustumCulled = false;
      if (object instanceof THREE.InstancedMesh && object.count === 0) {
        object.count = 1;
        object.setMatrixAt(0, new THREE.Matrix4());
        object.instanceMatrix.needsUpdate = true;
      }
      if (object.geometry instanceof SilverSedimentGeometry) {
        const sample = new SilverSedimentField(8, 8);
        sample.deposit(4 * 8 + 4, 0.4);
        object.geometry.update(sample);
      }
      if (object.geometry instanceof BariumSedimentGeometry) {
        const sample = new BariumSedimentField(8, 8);
        sample.deposit(4 * 8 + 4, 0.4);
        object.geometry.update(sample);
      }
    });
    // Shadow depth and transmission variants are created only by a real render.
    // Draw the prospective reacting tube offscreen while the clear reagent is
    // present, then keep its programs cached for the actual pour.
    const parent = (source as THREE.Object3D).parent;
    if (!parent) return;
    parent.add(preview);
    const target = new THREE.WebGLRenderTarget(16, 16);
    const previousTarget = renderer.getRenderTarget();
    try {
      const before = renderer.info.programs?.length ?? 0;
      renderer.compile(preview, camera, scene);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      // The live canvas and the composer use different output targets.
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      const darkScene = new THREE.Scene();
      darkScene.environment = scene.environment;
      scene.traverse(object => {
        if (object !== preview && (object as THREE.Light).isLight
          && object.type !== "SpotLight" && object.visible)
          darkScene.add(object.clone());
      });
      darkScene.add(preview);
      try {
        renderer.compile(darkScene, camera);
        renderer.setRenderTarget(target);
        renderer.render(darkScene, camera);
        renderer.setRenderTarget(null);
        renderer.render(darkScene, camera);
      } finally {
        parent.add(preview);
      }
      // Drivers may defer shader linking until the next frame. Complete the
      // preview GPU work before the reagent is delivered and timing begins.
      renderer.getContext().finish();
      if (import.meta.env.DEV && typeof window !== "undefined")
        (window as unknown as { __reactionWarmup?: unknown }).__reactionWarmup = {
          kind, before, after: renderer.info.programs?.length ?? 0,
          meshes: preview.getObjectsByProperty("isMesh", true).length,
          lights: darkScene.children.filter(child => (child as THREE.Light).isLight).map(child => child.type) };
    } finally {
      renderer.setRenderTarget(previousTarget);
      preview.removeFromParent();
      target.dispose();
    }
  })();
  cache.set(kind, task);
  return task;
}

export function createTubeReactionVisuals(root: THREE.Object3D, kind: ReactionKind | null,
  options: { activeSurface?: boolean; pour?: boolean; liquidCount?: number; incomingDyed?: boolean } = {}) {
  let cavity: THREE.Mesh | undefined;
  let shell: THREE.Mesh | undefined;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.name.startsWith("ContentsVolume")) cavity = object;
    if (object.name.startsWith("Tube_Glass")) shell = object;
  });
  if (!cavity || !shell) return null;
  const volume = cavity;
  const glassShell = shell;
  // The rounded glass bottom is a clear boundary, not an opaque white lens.
  // Preserve the accepted optics of experiments 1, 2 and 4 unchanged.
  const clearBottomOptics = kind === null || kind === "barium-sulfate";
  const baseOptics = (glassShell.material as THREE.Material).userData.baseOptics as THREE.IUniform<number> | undefined;
  if (baseOptics) baseOptics.value = clearBottomOptics ? 0 : 1;
  const glassBackdrop = glassShell.getObjectByName("TubeGlassRefractedBackdrop") as THREE.Mesh | undefined;
  const backdropGain = (glassBackdrop?.material as THREE.Material | undefined)?.userData.backdropGain as THREE.IUniform<number> | undefined;
  if (backdropGain) backdropGain.value = clearBottomOptics ? 1 : 1.32;
  volume.geometry.computeBoundingBox();
  const box = volume.geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.min(size.x, size.z) * 0.5;
  root.updateMatrixWorld(true);
  shell.geometry.computeBoundingBox();
  const shellBox = shell.geometry.boundingBox!;
  const headRadius = Math.min(shellBox.max.x - shellBox.min.x, shellBox.max.z - shellBox.min.z) * 0.45;
  // Read the lip in cavity coordinates so authored node transforms remain valid.
  const lip = volume.worldToLocal(shell.localToWorld(new THREE.Vector3(0, shell.geometry.boundingBox!.max.y, 0)));
  const effectiveRadius = tubeEffectiveRadius(size.y);
  const fieldHeight = Math.max(size.y, tubeLiquidHeight(5, effectiveRadius) + radius * 0.25);
  const renderHeight = fieldHeight;
  // Include the starting 2.5 ml and the full 5 ml capacity in the Cu field.
  const copperHeight = fieldHeight;
  const baseline = volume.material;
  const originalGeometry = volume.geometry;
  const base = Array.isArray(baseline) ? baseline[0] : baseline;
  const physical = base as THREE.MeshPhysicalMaterial;
  const baseOpacity = physical instanceof TubeLiquidMaterial ? physical.uniforms.uOpacity.value : physical.opacity;
  const baseColor = physical instanceof TubeLiquidMaterial ? physical.uniforms.uBaseColor.value : physical.color;
  const originalBaseReactionKind = base instanceof TubeLiquidMaterial ? base.uniforms.uReactionKind.value : 0;
  const standalonePermanganate = kind === null && base instanceof TubeLiquidMaterial
    && baseColor?.getHexString() === new THREE.Color(REAGENTS.kmno4.contentsColor).getHexString();
  if (standalonePermanganate) base.uniforms.uReactionKind.value = 4;
  const liquid = kind ? new TubeLiquidMaterial(volume.geometry, {
    color: kind === "permanganate-redox" ? REAGENTS.kmno4.contentsColor : `#${baseColor?.getHexString() ?? "ffffff"}`,
    opacity: baseOpacity,
    reactionColor: kind === "copper-nitric" ? TUBE_VISUALS.copperColor : "#ffffff",
  }) : null;
  if (liquid) {
    liquid.uniforms.uMixingStrength.value = 0;
    liquid.uniforms.uTopHighlight.value = 0.04;
  }
  const originalShellMaterial = shell.material;
  const dyedShellMaterial = (kind === "permanganate-redox" || kind === "copper-nitric" || standalonePermanganate)
    && shell.material instanceof THREE.MeshPhysicalMaterial ? shell.material.clone() : null;
  if (dyedShellMaterial) {
    // three.js does not copy onBeforeCompile when cloning a material.
    const compileShell = (originalShellMaterial as THREE.MeshPhysicalMaterial).onBeforeCompile;
    dyedShellMaterial.onBeforeCompile = (shader, renderer) => {
      compileShell(shader, renderer);
      // The front glass otherwise repaints the already filtered background.
      // Preserve its contour while letting the coloured column show through.
      shader.fragmentShader = shader.fragmentShader.replace(
        "diffuseColor.a = max(diffuseColor.a, crack * 0.95);",
        `diffuseColor.a = max(diffuseColor.a, crack * 0.95);
float dyeWindow = 1.0 - smoothstep(0.31, 0.35, vTubeHeight);
diffuseColor.a *= mix(1.0, 0.10, dyeWindow);
outgoingLight *= mix(1.0, 0.80, dyeWindow);`);
    };
    dyedShellMaterial.customProgramCacheKey = () => "test-tube-coloured-window-v2";
    shell.material = dyedShellMaterial;
  }

  // Extend only the cylindrical wall, then clip against the world-horizontal
  // plane. The authored closed volume cannot expose a higher side on a tilt.
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + i / 12 * Math.PI / 2;
    profile.push(new THREE.Vector2(radius * Math.cos(a), box.min.y + radius + radius * Math.sin(a)));
  }
  profile.push(new THREE.Vector2(radius, box.min.y + fieldHeight));
  const wallGeometry = new THREE.LatheGeometry(profile, 48);
  wallGeometry.setAttribute("tubeSurface", new THREE.Float32BufferAttribute(new Float32Array(wallGeometry.attributes.position.count), 1));
  wallGeometry.setAttribute("tubeWave", new THREE.Float32BufferAttribute(new Float32Array(wallGeometry.attributes.position.count), 1));
  wallGeometry.setAttribute("tubeWaveSlope", new THREE.Float32BufferAttribute(new Float32Array(wallGeometry.attributes.position.count), 1));
  const waveSurface = options.activeSurface ? new TubeSurfaceWaves(radius) : null;
  const capGeometry = waveSurface?.geometry ?? new THREE.CircleGeometry(radius, 48);
  if (!waveSurface) {
    capGeometry.rotateX(-Math.PI / 2);
    capGeometry.setAttribute("tubeSurface", new THREE.Float32BufferAttribute(new Float32Array(capGeometry.attributes.position.count).fill(1), 1));
    capGeometry.setAttribute("tubeWave", new THREE.Float32BufferAttribute(new Float32Array(capGeometry.attributes.position.count), 1));
    capGeometry.setAttribute("tubeWaveSlope", new THREE.Float32BufferAttribute(new Float32Array(capGeometry.attributes.position.count), 1));
  }
  const hasLiquid = base instanceof TubeLiquidMaterial && volume.visible;
  const inertTracerOnly = import.meta.env.DEV && typeof window !== "undefined"
    && (new URLSearchParams(window.location.search).has("tubeTracer")
      || (window as Window & { __tubeTracerOnly?: boolean }).__tubeTracerOnly === true);
  if (options.activeSurface) {
    const stand = useBunsenStandStorageStore.getState();
    const tubes = useTestTubeStorageStore.getState();
    const attached = stand.attachedTubeSlotIndex === null ? undefined
      : (stand.onFumeHood ? tubes.fumeHoodTestTubes : tubes.workbenchTestTubes)[stand.attachedTubeSlotIndex];
    if (attached) seedTubeAmounts(attached.instanceId,
      options.pour ? attached.contents.slice(0, -1) : attached.contents);
  }
  // Stand tubes have a measured amount below. Detached preview meshes retain
  // their authored fill because they have no volume identity to invert.
  const targetFill = testTubeLiquidFill(options.liquidCount ?? 1);
  const startFill = options.pour ? testTubeLiquidFill((options.liquidCount ?? 1) - 1) : targetFill;
  let pourAge = 0;
  const transportDisabled = import.meta.env.DEV && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("noTubeTransport");
  const legacyTransport = import.meta.env.DEV && typeof window !== "undefined"
    && (window as Window & { __tubeLegacyTransport?: boolean }).__tubeLegacyTransport === true;
  const transport = options.pour && hasLiquid
    && (legacyTransport || kind !== "silver-chloride" && kind !== "barium-sulfate")
    && !transportDisabled ? new TubeMixingField() : null;
  transport?.start(!!options.incomingDyed);
  if (hasLiquid) volume.geometry = wallGeometry;

  const group = new THREE.Group();
  group.name = "TubeReactionVisuals";
  group.position.copy(volume.position);
  group.quaternion.copy(volume.quaternion);
  group.scale.copy(volume.scale);
  volume.parent?.add(group);
  const backdrop = options.activeSurface && hasLiquid
    ? createWaterBackdropMaterial(radius, box.min.y, renderHeight, transport, liquid ?? base as TubeLiquidMaterial) : null;
  const backdropWall = backdrop ? new THREE.Mesh(wallGeometry, backdrop.material) : null;
  const backdropCap = backdrop ? new THREE.Mesh(capGeometry, backdrop.material) : null;
  if (backdropWall && backdropCap) {
    backdropWall.name = "TubeRefractedBackdrop";
    backdropCap.name = "TubeRefractedSurface";
    backdropWall.visible = false;
    backdropCap.visible = false;
    backdropCap.frustumCulled = false;
    backdropWall.renderOrder = backdropCap.renderOrder = -0.5;
    backdropWall.raycast = backdropCap.raycast = () => {};
    group.add(backdropWall, backdropCap);
  }
  const absorption = hasLiquid && (kind === "copper-nitric" || kind === "permanganate-redox" || standalonePermanganate)
    ? new TubeAbsorptionMaterial(radius, box.min.y, kind === "copper-nitric" ? copperHeight : renderHeight) : null;
  const absorptionWall = absorption ? new THREE.Mesh(wallGeometry, absorption) : null;
  const absorptionCap = absorption ? new THREE.Mesh(capGeometry, absorption) : null;
  if (absorptionWall && absorptionCap) {
    absorptionWall.name = "TubeAbsorptionWall";
    absorptionCap.name = "TubeAbsorptionSurface";
    absorptionWall.visible = absorptionCap.visible = false;
    // Multiply the already composited liquid and copper by the 3D Cu(II)
    // transmission. Earlier order let the clear liquid repaint the plumes.
    absorptionWall.renderOrder = absorptionCap.renderOrder = kind === "copper-nitric" ? 3.25 : 0.5;
    absorptionCap.frustumCulled = false;
    absorptionWall.raycast = absorptionCap.raycast = () => {};
    group.add(absorptionWall, absorptionCap);
  }
  const originalVolumeOrder = volume.renderOrder;
  const originalGlassOrder = glassShell.renderOrder;
  if (absorption) {
    volume.renderOrder = 3;
    glassShell.renderOrder = 4;
  }
  const cap = new THREE.Mesh(capGeometry, baseline);
  cap.name = "TubeLiquidSurface";
  cap.visible = hasLiquid;
  cap.frustumCulled = false;
  if (absorption) cap.renderOrder = 3;
  cap.raycast = () => {};
  group.add(cap);
  const filmGeometry = new THREE.PlaneGeometry(1, 1, 8, 48);
  const filmMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uAge: { value: 0 }, uFade: { value: 0 },
      uColor: { value: new THREE.Color(options.incomingDyed ? REAGENTS.kmno4.contentsColor : "#d7e8eb") } },
    vertexShader: `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uAge; uniform float uFade; uniform vec3 uColor; varying vec2 vUv;
void main() {
  float irregular = sin(vUv.y * 17.0 - uAge * 4.0) * 0.018;
  float cross = abs(vUv.x - 0.5 - irregular);
  float wet = 1.0 - smoothstep(0.32, 0.50, cross);
  float glint = exp(-pow((vUv.x - 0.22 - irregular) / 0.09, 2.0));
  float shadow = exp(-pow((vUv.x - 0.77 - irregular) / 0.11, 2.0));
  float down = smoothstep(0.0, 0.07, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
  float wave = 0.94 + 0.06 * sin(vUv.y * 24.0 - uAge * 8.0);
  float alpha = (wet * 0.62 + glint * 0.12 + shadow * 0.08) * down * wave * uFade;
  gl_FragColor = vec4(mix(uColor, vec3(0.23, 0.34, 0.38), shadow * 0.60), alpha);
  #include <colorspace_fragment>
}`,
  });
  const film = new THREE.Mesh(filmGeometry, filmMaterial);
  film.name = "TubePourWallFilm";
  film.visible = false;
  film.frustumCulled = false;
  film.renderOrder = 12;
  film.raycast = () => {};
  group.add(film);
  const bottomCausticGeometry = new THREE.PlaneGeometry(radius * 1.7, radius * 1.7);
  const standCausticGeometry = new THREE.PlaneGeometry(radius * 2.5, radius * 2.5);
  bottomCausticGeometry.rotateX(-Math.PI / 2);
  standCausticGeometry.rotateX(-Math.PI / 2);
  const bottomCausticMaterial = createCausticMaterial();
  const standCausticMaterial = createCausticMaterial();
  const bottomCaustic = new THREE.Mesh(bottomCausticGeometry, bottomCausticMaterial);
  const standCaustic = new THREE.Mesh(standCausticGeometry, standCausticMaterial);
  bottomCaustic.name = "TubeBottomCaustic";
  standCaustic.name = "TubeStandCaustic";
  bottomCaustic.position.set(center.x, box.min.y + radius * 0.34, center.z);
  standCaustic.visible = false;
  bottomCaustic.raycast = standCaustic.raycast = () => {};
  group.add(bottomCaustic, standCaustic);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const white = new THREE.MeshStandardMaterial({ color: "#c9c7c2", roughness: 1,
    envMapIntensity: 0.15, transparent: true, opacity: kind === "silver-chloride" ? 0.82 : 1,
    depthWrite: kind !== "silver-chloride" });
  white.onBeforeCompile = (shader) => {
    shader.uniforms.uSedimentWhite = { value: kind === "barium-sulfate" ? 0.92 : 0.97 };
    shader.uniforms.uPowder = { value: kind === "barium-sulfate" ? 1 : 0 };
    shader.uniforms.uSedimentBottom = { value: box.min.y };
    shader.uniforms.uSedimentRadius = { value: radius * 0.98 };
    shader.uniforms.uSedimentCenter = { value: center };
    shader.vertexShader = `varying vec3 vSedimentPoint; varying vec3 vSedimentLocal;\n${shader.vertexShader}`.replace("#include <project_vertex>", `
vSedimentLocal = transformed;
vSedimentPoint = transformed;
#ifdef USE_INSTANCING
vSedimentPoint = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
#include <project_vertex>`);
    shader.fragmentShader = `varying vec3 vSedimentPoint; varying vec3 vSedimentLocal; uniform float uSedimentWhite; uniform float uPowder;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
vec3 bowlPoint = vec3(vSedimentPoint.xz - uSedimentCenter.xz, min(vSedimentPoint.y - uSedimentBottom - uSedimentRadius, 0.0));
if (vSedimentPoint.y < uSedimentBottom || length(bowlPoint) > uSedimentRadius) discard;`);
    // The nearby burner saturates even non-emissive white. Bound the diffuse
    // response before bloom and keep normal-based relief instead of hot spots.
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
float relief = 0.84 + 0.16 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.3))));
 outgoingLight = vec3(uSedimentWhite) * relief;
 if (uPowder < 0.5) {
   float weave = sin(vSedimentLocal.x * 17.0 + vSedimentLocal.y * 13.0)
     * sin(vSedimentLocal.z * 19.0 - vSedimentLocal.y * 11.0);
   float wisps = sin(vSedimentLocal.x * 39.0 + vSedimentLocal.z * 23.0)
     * sin(vSedimentLocal.y * 31.0 - vSedimentLocal.x * 17.0);
   float rim = abs(dot(normalize(normal), normalize(vViewPosition)));
   diffuseColor.a *= smoothstep(0.08, 0.62, rim + weave * 0.19 + wisps * 0.10);
 }
 diffuseColor.a *= mix(0.40 + 0.60 * smoothstep(0.0, 0.68,
   abs(dot(normalize(normal), normalize(vViewPosition)))), 1.0, uPowder);
 #include <opaque_fragment>`);
  };
  // Irregular overlapping pieces form a single soft cotton mass.
  const curdGeometry = new THREE.IcosahedronGeometry(1, 3);
  const vertices = curdGeometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const curl = Math.sin(x * 5.8 + y * 3.7) * Math.cos(z * 6.4 - y * 4.1);
    const tear = Math.sin(z * 12.1 + x * 8.8) * Math.sin(y * 13.0 - z * 5.0);
    const tail = Math.max(0, Math.sin(x * 3.1 + z * 5.7) * Math.cos(y * 4.9));
    const lump = 0.68 + 0.46 * curl + 0.23 * tear + 0.30 * tail * Math.max(0, y)
      + 0.07 * Math.sin(x * 24 + z * 19);
    vertices.setXYZ(i, x * lump + 0.12 * y * y * Math.sin(z * 7),
      y * lump * (0.65 + 0.42 * Math.sin(x * 5 + z * 4)), z * lump);
  }
  // Open small irregular gaps in the lobed surface rather than stacking
  // round subparticles to suggest porosity.
  for (let i = 0; i + 2 < vertices.count; i += 3) {
    const x = (vertices.getX(i) + vertices.getX(i + 1) + vertices.getX(i + 2)) / 3;
    const y = (vertices.getY(i) + vertices.getY(i + 1) + vertices.getY(i + 2)) / 3;
    const z = (vertices.getZ(i) + vertices.getZ(i + 1) + vertices.getZ(i + 2)) / 3;
    if (Math.sin(x * 13 + z * 7) * Math.sin(y * 17 - z * 6) < 0.77) continue;
    for (let vertex = i; vertex < i + 3; vertex++) vertices.setXYZ(vertex, x, y, z);
  }
  curdGeometry.computeVertexNormals();
  const bubbleMaterial = new THREE.MeshPhysicalMaterial({ color: "#e8f7fa", transparent: true, opacity: 0.85, roughness: 0.04, metalness: 0, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
  const pourAirMaterial = new THREE.MeshBasicMaterial({ color: "#e8f7fa", transparent: true,
    opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const flocMaterial = new THREE.MeshLambertMaterial({ color: "#f3f4f1", transparent: true,
    opacity: 0.87, depthWrite: false, side: THREE.DoubleSide });
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
float edge = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.9);
diffuseColor.a = 0.04 + edge * 0.96;
outgoingLight = vec3(0.16, 0.25, 0.27) + edge * vec3(1.05, 1.12, 1.15) + totalSpecular / (vec3(1.0) + totalSpecular) * 0.35;
#include <opaque_fragment>`);
  };
  const dropletMaterial = new THREE.MeshBasicMaterial({ color: "#b9d0d4", transparent: true, opacity: 0.3, depthWrite: false });
  const splashMaterial = dropletMaterial.clone();
  splashMaterial.opacity = 0.48;
  const foamGeometry = new THREE.TorusGeometry(1, 0.16, 4, 10);
  foamGeometry.rotateX(-Math.PI / 2);
  const foamMaterial = new THREE.MeshBasicMaterial({ color: "#d9e9e5", transparent: true, opacity: 0.43, depthWrite: false });
  const gasGeometry = new THREE.PlaneGeometry(2, 2);
  const gasMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(TUBE_VISUALS.gasColor) },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uWorldUp: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: `varying vec2 vP; varying float vAxisLean;
uniform vec3 uWorldUp;
void main() {
  vP = position.xy;
  vec2 extent = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec3 axisView = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 upView = normalize((modelViewMatrix * vec4(uWorldUp, 0.0)).xyz);
  vAxisLean = clamp(axisView.x - upView.x, -1.0, 1.0);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * extent * vec2(length(modelViewMatrix[0].xyz), length(modelViewMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
varying vec2 vP; varying float vAxisLean;
void main() {
  float rise = clamp((vP.y + 1.0) * 0.5, 0.0, 1.0);
  float flow = sin(uTime * 0.28 + rise * 2.8) * 0.025 * rise * rise;
  flow += vAxisLean * 0.34 * smoothstep(0.0, 0.32, rise);
  float width = mix(0.52, 0.63, smoothstep(0.0, 1.0, rise));
  float edge = 1.0 - smoothstep(width * 0.45, width, abs(vP.x - flow));
  float top = 1.0 - smoothstep(0.3, 1.0, rise);
  float bridge = smoothstep(0.0, 0.07, rise);
  gl_FragColor = vec4(uColor, uOpacity * edge * top * bridge);
  #include <colorspace_fragment>
}`,
  });
  // The liquid mesh is inset from the glass; gas must reach the actual bore.
  const headGeometry = new THREE.CylinderGeometry(headRadius, headRadius, lip.y - box.min.y, 32, 1, true);
  headGeometry.translate(center.x, (lip.y + box.min.y) / 2, center.z);
  const headMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false,
    uniforms: { uUp: up, uLevel: level, uDensity: { value: 0 }, uSurfaceGas: { value: 0 }, uFront: { value: 0 }, uMouth: { value: 0 }, uResidue: { value: 0 }, uTime: { value: 0 }, uDetail: { value: 1 },
      uMouthHeight: { value: lip.y - box.max.y },
      uLip: { value: lip.y }, uRadius: { value: headRadius }, uColor: { value: new THREE.Color(TUBE_VISUALS.gasColor) } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vEye;
void main() { vP = position; vN = normalize(normalMatrix * normal);
vec4 mv = modelViewMatrix * vec4(position, 1.0); vEye = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uUp; uniform float uLevel; uniform float uDensity; uniform float uSurfaceGas; uniform float uFront; uniform float uMouth; uniform float uResidue; uniform float uTime; uniform float uDetail; uniform float uMouthHeight;
uniform float uLip; uniform float uRadius; uniform vec3 uColor;
varying vec3 vP; varying vec3 vN; varying vec3 vEye;
float gasNoise(vec3 p) {
  vec3 i = floor(p), f = smoothstep(0.0, 1.0, fract(p));
  float k = dot(i, vec3(1.0, 57.0, 113.0));
  vec4 a = fract(sin(vec4(k, k + 1.0, k + 57.0, k + 58.0)) * 43758.5453);
  vec4 b = fract(sin(vec4(k + 113.0, k + 114.0, k + 170.0, k + 171.0)) * 43758.5453);
  return mix(mix(mix(a.x, a.y, f.x), mix(a.z, a.w, f.x), f.y),
    mix(mix(b.x, b.y, f.x), mix(b.z, b.w, f.x), f.y), f.z);
}
void main() {
float aboveWater = dot(uUp, vP) - uLevel;
if (aboveWater < -0.005) discard;
float h = clamp(aboveWater / max(uMouthHeight, 0.005), 0.0, 1.0);
float motion = 1.0 + 0.10 * sin(h * 2.4 - uTime * 0.3);
if (uDetail > 0.5) {
  vec3 q = vec3(vP.x / uRadius * 1.1, vP.y / uRadius * 0.35 - uTime * 0.13,
    vP.z / uRadius * 1.1);
  float cloud = gasNoise(q) * 0.7 + gasNoise(q * 0.9 + vec3(4.7, 0.0, 1.9)) * 0.3;
  motion = clamp(1.0 + (cloud - 0.5) * 1.25, 0.72, 1.28);
}
motion = mix(motion, 1.0, smoothstep(0.78, 1.0, h));
float heightDensity = mix(0.10, 1.0, smoothstep(0.0, 0.92, h));
float facing = abs(dot(normalize(vN), normalize(vEye)));
float edgeFade = smoothstep(0.0, 0.3, facing);
float wallBand = (0.55 + 0.55 * pow(1.0 - facing, 0.55))
  * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.34, 0.72, h));
float lowerFade = smoothstep(-0.008, 0.025, aboveWater);
float rise = mix(1.0 - smoothstep(uFront - 0.12, uFront + 0.08, h),
  uMouth, smoothstep(0.76, 1.0, h));
float mist = (1.0 - exp(-uDensity * 1.55 * heightDensity)) * edgeFade
  * lowerFade * rise * motion;
// A thin, dilute NO2 veil sits immediately above the bubbling meniscus.
float surfaceBand = exp(-pow(aboveWater / max(uRadius * 0.65, 0.001), 2.0))
  * smoothstep(-0.001, 0.0015, aboveWater) * (0.65 + 0.35 * edgeFade);
gl_FragColor = vec4(uColor, min(0.9, mist + uSurfaceGas * surfaceBand * motion
  + uResidue * wallBand * smoothstep(0.0, 0.12, facing)));
#include <colorspace_fragment>
}`,
  });
  const headspace = new THREE.Mesh(headGeometry, headMaterial);
  headspace.name = "TubeNO2Headspace";
  headspace.renderOrder = 3;
  headspace.visible = false;
  headspace.raycast = () => {};
  group.add(headspace);
  const makePool = (material: THREE.Material, capacity = 72): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  };
  const coarseGeometry = new THREE.IcosahedronGeometry(1, 1);
  const coarseVertices = coarseGeometry.getAttribute("position");
  for (let i = 0; i < coarseVertices.count; i++) {
    const x = coarseVertices.getX(i), y = coarseVertices.getY(i), z = coarseVertices.getZ(i);
    const irregular = 0.82 + 0.17 * Math.sin(x * 9 + z * 6) * Math.cos(y * 11 - x * 4);
    coarseVertices.setXYZ(i, x * irregular, y * irregular * 0.76, z * irregular);
  }
  coarseGeometry.computeVertexNormals();
  const coarseMaterial = new THREE.MeshBasicMaterial({ color: "#f8f9f7", toneMapped: false });
  const coarseParticles = makePool(coarseMaterial, 24);
  coarseParticles.geometry = coarseGeometry;
  coarseParticles.name = "TubeBariumAggregates";
  coarseParticles.renderOrder = 6;
  const flakes = makePool(kind === "silver-chloride" ? flocMaterial : white);
  flakes.renderOrder = 1;
  if (kind === "silver-chloride") flakes.geometry = curdGeometry;
  flakes.name = "TubePrecipitate";
  const bubbles = makePool(bubbleMaterial, NO_BUBBLE_CAPACITY);
  bubbles.renderOrder = 3.75;
  bubbles.name = "TubeNOBubbles";
  const pourAir = makePool(pourAirMaterial, 12);
  pourAir.name = "TubePourAirBubbles";
  const attachedBubbles = makePool(bubbleMaterial, NO_BUBBLE_CAPACITY);
  // The copper is drawn after refraction; draw the adhering bubbles after it.
  // Depth testing still hides the bubbles on its far side.
  attachedBubbles.renderOrder = 3.75;
  attachedBubbles.name = "TubeNOAttachedBubbles";
  const gas = makePool(gasMaterial);
  gas.geometry = gasGeometry;
  gas.name = "TubeNO2";
  const condensate = makePool(dropletMaterial);
  condensate.name = "TubeCondensate";
  const splash = makePool(splashMaterial);
  splash.name = "TubeSplash";
  const foam = makePool(foamMaterial);
  foam.geometry = foamGeometry;
  foam.name = "TubeSurfaceFoam";
  // The measured cavity is a radius-7 mm hemisphere at its base. Truncate
  // the top, preserving the bowl profile instead of flattening the hemisphere.
  const bedGeometry = new BariumSedimentGeometry(radius, box.min.y);
  const silverBedGeometry = new SilverSedimentGeometry(radius, box.min.y);
  const bedMaterial = kind === "barium-sulfate"
    ? new THREE.MeshStandardMaterial({ color: "#c7ccc9", roughness: 1,
      metalness: 0, side: THREE.DoubleSide, transparent: true,
      opacity: 0.38, depthWrite: false })
    : new THREE.MeshBasicMaterial({ color: "#f8f9f7", toneMapped: false,
      side: THREE.DoubleSide, depthWrite: true });
  if (kind === "barium-sulfate") {
    bedMaterial.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float sedimentThickness;
varying float vSedimentThickness;
${shader.vertexShader}`.replace("#include <begin_vertex>",
        "#include <begin_vertex>\nvSedimentThickness = sedimentThickness;");
      shader.fragmentShader = `varying float vSedimentThickness;
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif (vSedimentThickness < 0.00008) discard;")
        .replace("#include <opaque_fragment>",
          "outgoingLight = min(outgoingLight, vec3(0.58));\n#include <opaque_fragment>");
    };
    bedMaterial.customProgramCacheKey = () => "barium-sediment-film-v1";
  }
  const bed = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(bedGeometry, bedMaterial);
  bed.renderOrder = 5;
  bed.frustumCulled = false;
  bed.name = "TubeSediment";
  bed.visible = false;
  bed.raycast = () => {};
  group.add(bed);
  const dummy = new THREE.Object3D();
  const random = (i: number) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
  // Weight the exposed face in the default game close-up, while retaining
  // sites around the back for other viewing angles.
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  let disposed = false;
  let lastTime: number | undefined;
  const gasState = new GasState();
  const noBubbles = new TubeNOBubbles();
  let lastGasProgress = 0;
  let surfaceActivity = 0;
  let pendingPour = !!options.pour;
  let heatPulseAge = 0;
  let motionReady = false;
  const slope = new THREE.Vector2();
  const velocity = new THREE.Vector2();
  const gravity = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const cameraLocal = new THREE.Vector3();
  const renderInverse = new THREE.Matrix4();
  const renderCameraWorld = new THREE.Vector3();
  if (absorption && absorptionWall && absorptionCap) {
    const syncAbsorptionCamera = (_renderer: THREE.WebGLRenderer, _scene: THREE.Scene,
      camera: THREE.Camera) => {
      cameraInTubeSpace(camera, volume, renderInverse, renderCameraWorld,
        absorption.uniforms.uCameraLocal.value);
    };
    absorptionWall.onBeforeRender = absorptionCap.onBeforeRender = syncAbsorptionCamera;
  }
  const copper = root.getObjectByName("TubeCopperGranules");
  const immersion = new TubeImmersion(center, radius, box.min.y, renderHeight);
  // Clear ionic liquids need no costly copper/dye transmission program on
  // their white solids. Their scattering is already handled by the liquid.
  const detachImmersion = kind === "silver-chloride" || kind === "barium-sulfate"
    ? [] : [immersion.attach(white), immersion.attach(bubbleMaterial)];
  const copperDrawState: { mesh: THREE.Mesh; transparent: boolean; depthWrite: boolean; order: number }[] = [];
  if (copper) copper.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) {
      detachImmersion.push(immersion.attach(object.material, true));
      if (absorption) {
        copperDrawState.push({ mesh: object, transparent: object.material.transparent,
          depthWrite: object.material.depthWrite, order: object.renderOrder });
        object.material.transparent = true;
        // The transparent copper pass still has to occlude bubbles on its far
        // side. Otherwise draw order makes them appear over the metal.
        object.material.depthWrite = true;
        object.material.needsUpdate = true;
        // The absorption pass must filter the liquid in front of the metal.
        // Depth writing by the metal still hides the far-side bubbles.
        object.renderOrder = 0.25;
      }
    }
  });
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
  // Evenly spaced directions cover the entire irregular grain, including the
  // camera-facing, side and bottom faces. Snap each direction to its mesh.
  const copperSourceVertices = copper?.children.flatMap((child, i) => {
    if (!(child instanceof THREE.Mesh)) return [];
    const positions = child.geometry.getAttribute("position");
    const candidates: THREE.Vector3[] = [];
    const vertex = new THREE.Vector3();
    for (let k = 0; k < 24; k++) {
      const elevation = 1 - 2 * (k + 0.5) / 24;
      const angle = k * Math.PI * (3 - Math.sqrt(5)) + i * 1.7;
      const horizontal = Math.sqrt(1 - elevation * elevation);
      const direction = new THREE.Vector3(Math.cos(angle) * horizontal, elevation,
        Math.sin(angle) * horizontal);
      let best = -Infinity;
      let selected = new THREE.Vector3();
      for (let j = 0; j < positions.count; j++) {
        vertex.fromBufferAttribute(positions, j);
        const score = vertex.clone().applyQuaternion(child.quaternion).dot(direction);
        if (score > best) { best = score; selected = vertex.clone(); }
      }
      candidates.push(selected);
    }
    return candidates;
  }) ?? [];
  const sourcePoints = Array.from({ length: (copper?.children.length ?? 0) * 24 }, () => new THREE.Vector3());
  const bubbleSites = Array.from({ length: NO_BUBBLE_CAPACITY }, () => new THREE.Vector3());
  const wettedSites: THREE.Vector3[] = [];
  const bubbleSiteVertex = new THREE.Vector3();
  const attachedNormal = new THREE.Vector3();
  const popSurface = (x: number, z: number, sizeBubble: number) =>
    waveSurface?.impulse((x - center.x) / radius,
      (z - center.z) / radius, sizeBubble * 0.7, 0.18);
  const copperField = kind === "copper-nitric" && hasLiquid
    ? new TubeVolumeField(useRuntimeQualityStore.getState().quality === "LOW" ? "LOW" : "HIGH",
      radius, box.min.y, copperHeight, copperPoints) : null;
  const permanganateField = kind === "permanganate-redox" && hasLiquid
    ? new TubePermanganateField(useRuntimeQualityStore.getState().quality === "LOW" ? "LOW" : "HIGH",
      radius, box.min.y, renderHeight) : null;
  const permanganateInlet = new THREE.Vector3();
  const bariumField = kind === "barium-sulfate" && hasLiquid
    ? new TubeBariumField(useRuntimeQualityStore.getState().quality === "LOW" ? "LOW" : "HIGH",
      radius, box.min.y, fieldHeight, inertTracerOnly ? 0 : 1.1, inertTracerOnly) : null;
  const bariumInlet = new THREE.Vector3();
  let bariumImpactSerial = -1;
  let bariumImpactMl = 0;
  const silverField = kind === "silver-chloride" && hasLiquid
    ? new TubeSilverField(useRuntimeQualityStore.getState().quality === "LOW" ? "LOW" : "HIGH",
      radius, box.min.y, fieldHeight) : null;
  const silverInlet = new THREE.Vector3();
  const impactPoint = new THREE.Vector3();
  const impactDirection = new THREE.Vector3();
  const impactQuaternion = new THREE.Quaternion();
  const tubeMotion = new TubeMotion();
  const permanganateSide = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const tubeWorldPosition = new THREE.Vector3();
  const causticRay = new THREE.Raycaster();
  const causticOrigin = new THREE.Vector3();
  const causticPoint = new THREE.Vector3();
  const causticNormal = new THREE.Vector3();
  const lastCausticOrigin = new THREE.Vector3(Infinity, Infinity, Infinity);
  let causticProbed = false;
  let causticSurfaceStrength = 0;
  return {
    update(chemistry: TubeChemistry, time: number, quality: RuntimeQuality, splashAge: number,
      refraction = false, cameraPosition?: THREE.Vector3, reactionProgress?: number) {
      const { progress } = chemistry;
      const rate = Number.isFinite(chemistry.rate) ? THREE.MathUtils.clamp(chemistry.rate, 0, 1) : 0;
      const temperature = Number.isFinite(chemistry.temperature) ? THREE.MathUtils.clamp(chemistry.temperature, 0, 1) : 0;
      let p = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
      if (copperField && cameraPosition) p = copperField.reaction.extent;
      const reverseTime = lastTime !== undefined && time < lastTime;
      const elapsed = lastTime === undefined ? 0 : Math.max(0, time - lastTime);
      const dt = Math.min(elapsed, 0.1);
      lastTime = time;
      pourAge += dt;
      const standNow = useBunsenStandStorageStore.getState();
      const tubesNow = useTestTubeStorageStore.getState();
      const attachedNow = standNow.attachedTubeSlotIndex === null ? undefined
        : (standNow.onFumeHood ? tubesNow.fumeHoodTestTubes : tubesNow.workbenchTestTubes)[standNow.attachedTubeSlotIndex];
      const impact = options.activeSurface && attachedNow ? tubePourImpact(attachedNow.instanceId) : undefined;
      const fill = attachedNow && tubeAmount(attachedNow.instanceId).volumeMl > 0
        ? tubeLiquidFill(tubeAmount(attachedNow.instanceId).volumeMl, effectiveRadius, size.y)
        : THREE.MathUtils.lerp(startFill, targetFill, THREE.MathUtils.smoothstep(pourAge, 0, 1.3));
      transport?.advance(dt, fill);
      waveSurface?.setQuality(quality);
      volume.updateWorldMatrix(true, false);
      const motion = tubeMotion.sample(volume, dt);
      for (const field of [copperField, permanganateField, bariumField])
        if (field) field.velocity.contributions.acceleration.copy(tubeMotion.impulse);
      causticOrigin.set(center.x, box.min.y, center.z).applyMatrix4(volume.matrixWorld);
      if (hasLiquid && quality !== "LOW" && (!causticProbed
        || causticOrigin.distanceToSquared(lastCausticOrigin) > 0.0001)) {
        causticProbed = true;
        lastCausticOrigin.copy(causticOrigin);
        causticSurfaceStrength = 0;
        standCaustic.visible = false;
        let scene: THREE.Object3D = root;
        while (scene.parent) scene = scene.parent;
        causticRay.set(causticPoint.copy(causticOrigin).add(new THREE.Vector3(0, 0.003, 0)),
          new THREE.Vector3(0, -1, 0));
        causticRay.far = 0.153;
        for (const hit of causticRay.intersectObjects(scene.children, true)) {
          let ancestor: THREE.Object3D | null = hit.object;
          while (ancestor && ancestor !== root) ancestor = ancestor.parent;
          if (ancestor === root || !hit.face) continue;
          causticNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
          if (causticNormal.y < 0.75) continue;
          const gap = causticOrigin.y - hit.point.y;
          if (gap < 0 || gap > 0.15) continue;
          causticPoint.copy(hit.point).addScaledVector(causticNormal, 0.001);
          standCaustic.position.copy(group.worldToLocal(causticPoint));
          causticSurfaceStrength = 1 - THREE.MathUtils.smoothstep(gap, 0.01, 0.15);
          break;
        }
      }
      const e = volume.matrixWorld.elements;
      const targetX = -e[1] / Math.max(0.001, e[5]);
      const targetZ = -e[9] / Math.max(0.001, e[5]);
      if (!motionReady) { slope.set(targetX, targetZ); motionReady = true; }
      const previousSlopeX = slope.x, previousSlopeZ = slope.y;
      // Same bounded spring integration as inspectionSlosh, driven by actual
      // matrix motion instead of its scripted bottle-inspection animation.
      for (let t = 0; t < dt;) {
        const step = Math.min(1 / 120, dt - t); t += step;
        velocity.x += (144 * (targetX - slope.x) - 7 * velocity.x) * step;
        velocity.y += (144 * (targetZ - slope.y) - 7 * velocity.y) * step;
        slope.addScaledVector(velocity, step);
      }
      up.value.set(-slope.x, 1, -slope.y).normalize();
      level.value = up.value.x * center.x + up.value.y * (box.min.y + size.y * fill) + up.value.z * center.z;
      gravity.set(0, 1, 0).transformDirection(inverse.copy(volume.matrixWorld).invert());
      if (copper) {
        const shrink = copperGranuleRadiusScale(p);
        copper.children.forEach((child, i) => {
          const etch = THREE.MathUtils.smoothstep(p * (0.8 + random(i + 150) * 0.38), 0.02, 0.9);
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.color.set("#b8733f").lerp(new THREE.Color("#654b3b"), etch * 0.8);
            child.material.roughness = THREE.MathUtils.lerp(0.24, 0.7, etch);
            child.material.metalness = THREE.MathUtils.lerp(0.98, 0.78, etch);
          }
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
      if (copperField && cameraPosition) {
        let sourceCount = 0;
        copper?.children.forEach((child, i) => {
          if (!(child instanceof THREE.Mesh) || !child.visible) return;
          child.updateMatrix();
          for (let k = 0; k < 24; k++) {
            sourcePoints[sourceCount++].copy(copperSourceVertices[i * 24 + k]).applyMatrix4(child.matrix);
          }
        });
        copperField.setSources(sourcePoints, sourceCount);
        volume.getWorldPosition(tubeWorldPosition);
        const stand = useBunsenStandStorageStore.getState();
        const tubes = useTestTubeStorageStore.getState();
        const index = stand.attachedTubeSlotIndex;
        const attached = index === null ? undefined
          : (stand.onFumeHood ? tubes.fumeHoodTestTubes : tubes.workbenchTestTubes)[index];
        // The UI smooths scalar chemistry for display. Read the attached
        // tube's spatial field directly so its hot side reaches convection.
        const spatialHeat = options.activeSurface && attached
          ? useTubeReactionStore.getState().chemistryById[attached.instanceId]?.temperatureField : undefined;
        const acidDelivery = impact?.reagentId === "hno3" ? {
          inlet: volume.worldToLocal(impactPoint.copy(impact.point)),
          direction: impactDirection.copy(impact.direction)
            .applyQuaternion(volume.getWorldQuaternion(impactQuaternion).invert()),
          deliveredMl: impact.deliveredMl,
        } : !attached ? undefined : {
          inlet: impactPoint.set(0, level.value, 0),
          direction: impactDirection.set(0, -1, 0),
          deliveredMl: 0,
        };
        copperField.advance(Math.min(elapsed, 0.25), reactionProgress ?? chemistry.progress,
          up.value, level.value, rate, temperature, spatialHeat, tubeWorldPosition,
          noBubbles, center, acidDelivery);
        if (import.meta.env.DEV && options.activeSurface &&
          (window as unknown as { __exp1DiagnosticsEnabled?: boolean }).__exp1DiagnosticsEnabled) {
          const debug = window as unknown as { __exp1Diagnostics?: unknown; __exp1Field?: TubeVolumeField };
          debug.__exp1Field = copperField;
          const verticalMass = [0, 0, 0, 0, 0];
          const values = copperField.species["Cu2+"].values;
          for (let a = 0; a < copperField.mask.activeCount; a++) {
            const i = copperField.mask.active[a];
            const y = Math.floor(i / copperField.mask.nx) % copperField.mask.ny;
            verticalMass[Math.min(4, Math.floor(5 * y / copperField.mask.ny))] += values[i];
          }
          debug.__exp1Diagnostics = {
            copperII: copperField.copperII, acid: copperField.species.HNO3.total,
            extent: copperField.reaction.extent, target: reactionProgress ?? chemistry.progress,
            level: level.value, sources: sourceCount, deliveredMl: acidDelivery?.deliveredMl ?? 0,
            fieldBottom: copperField.mask.bottom, fieldHeight: copperField.mask.height,
            volumeMl: attached ? tubeAmount(attached.instanceId).volumeMl : 0,
            fieldTime: Reflect.get(copperField, "time"),
            profile: copperField.profile,
            verticalMass,
          };
        }
        p = copperField.reaction.extent;
        if (attached && tubeAmount(attached.instanceId).copper > 0)
          syncCopperProgress(attached.instanceId, p);
      }
      if (permanganateField) {
        if (impact?.reagentId === "kmno4") {
          permanganateInlet.copy(volume.worldToLocal(impactPoint.copy(impact.point)));
        } else if (CLAMP_TUBE_MOUTH.valid) {
          permanganateSide.subVectors(CLAMP_TUBE_MOUTH.point, CLAMP_TUBE_MOUTH.rod).setY(0);
          if (permanganateSide.lengthSq() < 1e-8) permanganateSide.set(1, 0, 0);
          permanganateSide.normalize();
          // PourStream targets this near-wall side, 26 mm below the mouth.
          permanganateInlet.copy(CLAMP_TUBE_MOUTH.point)
            .addScaledVector(permanganateSide, 0.0065).addScaledVector(worldUp, -0.026);
          volume.worldToLocal(permanganateInlet);
        } else permanganateInlet.set(radius * 0.7, level.value, 0);
        const radial = Math.hypot(permanganateInlet.x, permanganateInlet.z);
        if (radial > radius * 0.82) permanganateInlet.multiplyScalar(radius * 0.82 / radial);
        // The actual liquid interface follows the meniscus as the tube tilts.
        permanganateInlet.y = (level.value - up.value.x * permanganateInlet.x
          - up.value.z * permanganateInlet.z) / Math.max(0.2, up.value.y) - 0.0007;
        // The incoming charge is delivered during the pour. Once added, only
        // local R4 and transport can change its colour.
        const priorExtent = permanganateField.extent;
        permanganateField.advance(dt, up.value, level.value, permanganateInlet,
          attachedNow ? (impact?.reagentId === "kmno4" ? 2 * impact.deliveredMl : 0)
            : 2 * THREE.MathUtils.smoothstep(pourAge, 0, 1.3), impact?.flowMlPerSecond ?? 1,
          impact?.reagentId === "kmno4" ? impactDirection.copy(impact.direction)
            .applyQuaternion(volume.getWorldQuaternion(impactQuaternion).invert()) : undefined);
        updateTubeFlowDebug("KMnO4", permanganateField.solver, permanganateField.tracer,
          permanganateField.species["MnO4-"].values);
        if (attachedNow) syncPermanganateExtent(attachedNow.instanceId, permanganateField.extent);
        if (options.activeSurface) {
          const stand = useBunsenStandStorageStore.getState();
          const tubes = useTestTubeStorageStore.getState();
          const index = stand.attachedTubeSlotIndex;
          const attached = index === null ? undefined
            : (stand.onFumeHood ? tubes.fumeHoodTestTubes : tubes.workbenchTestTubes)[index];
          if (attached?.contents.includes("kmno4") && attached.contents.includes("na2so3")
            && attached.contents.includes("h2so4")) {
            const store = useTubeReactionStore.getState();
            const current = store.chemistryById[attached.instanceId];
            const fieldProgress = permanganateField.progress;
            const fieldRate = dt > 0 ? (permanganateField.extent - priorExtent) / dt : 0;
            if (current && (Math.abs(current.progress - fieldProgress) > 1e-4
              || Math.abs(current.rate - fieldRate) > 1e-3))
              store.setChemistry(attached.instanceId, { ...current, progress: fieldProgress, rate: fieldRate,
                fieldUpdatedAt: Date.now() });
          }
        }
      }
      if (bariumField) {
        if (impact?.reagentId === "k2so4") {
          bariumInlet.copy(volume.worldToLocal(impactPoint.copy(impact.point)));
        } else if (CLAMP_TUBE_MOUTH.valid) {
          permanganateSide.subVectors(CLAMP_TUBE_MOUTH.point, CLAMP_TUBE_MOUTH.rod).setY(0);
          if (permanganateSide.lengthSq() < 1e-8) permanganateSide.set(1, 0, 0);
          permanganateSide.normalize();
          bariumInlet.copy(CLAMP_TUBE_MOUTH.point)
            .addScaledVector(permanganateSide, 0.0065).addScaledVector(worldUp, -0.026);
          volume.worldToLocal(bariumInlet);
        } else bariumInlet.set(radius * 0.7, level.value, 0);
        const radial = Math.hypot(bariumInlet.x, bariumInlet.z);
        if (radial > radius * 0.82) {
          bariumInlet.x *= radius * 0.82 / radial;
          bariumInlet.z *= radius * 0.82 / radial;
        }
        bariumInlet.y = (level.value - up.value.x * bariumInlet.x - up.value.z * bariumInlet.z)
          / Math.max(0.2, up.value.y) - 0.0007;
        if (waveSurface && impact?.reagentId === "k2so4") {
          if (impact.serial !== bariumImpactSerial) {
            bariumImpactSerial = impact.serial;
            bariumImpactMl = 0;
          }
          const newMl = Math.max(0, impact.deliveredMl - bariumImpactMl);
          bariumImpactMl = impact.deliveredMl;
          if (newMl > 0) {
            const flow = THREE.MathUtils.clamp(impact.flowMlPerSecond, 0, 3);
            waveSurface.impulse(bariumInlet.x / radius, bariumInlet.z / radius,
              -radius * Math.min(0.026, newMl * (0.12 + 0.06 * flow)), 0.16 + flow * 0.015);
          }
        }
        const previousExtent = bariumField.extent;
        const agitation = Math.max(motion,
          Math.min(1, Math.hypot(slope.x - previousSlopeX, slope.y - previousSlopeZ) * 15));
        const bariumDelta = Math.min(elapsed, 0.05);
        bariumField.advance(bariumDelta, up.value, level.value, bariumInlet,
          attachedNow ? (impact?.reagentId === "k2so4" ? impact.deliveredMl : 0)
            : THREE.MathUtils.smoothstep(bariumField.ageSeconds + bariumDelta, 0, 1.3), agitation,
          impact?.flowMlPerSecond ?? 1,
          impact?.reagentId === "k2so4" ? impactDirection.copy(impact.direction)
            .applyQuaternion(volume.getWorldQuaternion(impactQuaternion).invert()) : undefined);
        updateTubeFlowDebug("BaSO4", bariumField.solver, bariumField.tracer,
          bariumField.species["SO4(2-)"].values, bariumField.pixels, bariumField.sedimentMass,
          () => ({ suspensionMass: bariumField.suspensionMass, formed: bariumField.extent,
            aggregateMass: bariumField.coarseMass, massBalanceError: bariumField.massBalanceError,
            bariumRemaining: bariumField.species["Ba2+"].total,
            sulfateRemaining: bariumField.species["SO4(2-)"].total,
            layerMass: bariumField.inertTracerOnly ? bariumField.solver.scalarDiagnostics(bariumField.layers).mass : 0,
            motionIntensity: motion, motionImpulse: tubeMotion.impulse.length() }),
          { "Ba2+": bariumField.species["Ba2+"].values,
            "SO4(2-)": bariumField.species["SO4(2-)"].values,
            "product source": bariumField.productSource,
            suspension: bariumField.suspension[0], aggregates: bariumField.coarse,
            ...(bariumField.inertTracerOnly ? { layers: bariumField.layers } : {}) });
        if (attachedNow) syncBariumExtent(attachedNow.instanceId, bariumField.extent);
        if (options.activeSurface) {
          const stand = useBunsenStandStorageStore.getState();
          const tubes = useTestTubeStorageStore.getState();
          const index = stand.attachedTubeSlotIndex;
          const attached = index === null ? undefined
            : (stand.onFumeHood ? tubes.fumeHoodTestTubes : tubes.workbenchTestTubes)[index];
          if (attached?.contents.includes("bacl2") && attached.contents.includes("k2so4")) {
            const store = useTubeReactionStore.getState();
            const current = store.chemistryById[attached.instanceId];
            const fieldProgress = bariumField.progress;
            const fieldRate = dt > 0 ? (bariumField.extent - previousExtent) / dt : 0;
            if (current && (Math.abs(current.progress - fieldProgress) > 1e-4
              || Math.abs(current.rate - fieldRate) > 1e-3
              || Date.now() - (current.fieldUpdatedAt ?? 0) > 300))
              store.setChemistry(attached.instanceId, { ...current, progress: fieldProgress,
                rate: fieldRate, fieldUpdatedAt: Date.now() });
          }
        }
      }
      if (silverField) {
        if (impact?.reagentId === "nacl") {
          silverInlet.copy(volume.worldToLocal(impactPoint.copy(impact.point)));
        } else if (CLAMP_TUBE_MOUTH.valid) {
          permanganateSide.subVectors(CLAMP_TUBE_MOUTH.point, CLAMP_TUBE_MOUTH.rod).setY(0);
          if (permanganateSide.lengthSq() < 1e-8) permanganateSide.set(1, 0, 0);
          permanganateSide.normalize();
          silverInlet.copy(CLAMP_TUBE_MOUTH.point)
            .addScaledVector(permanganateSide, 0.0065).addScaledVector(worldUp, -0.026);
          volume.worldToLocal(silverInlet);
        } else silverInlet.set(radius * 0.7, level.value, 0);
        const radial = Math.hypot(silverInlet.x, silverInlet.z);
        if (radial > radius * 0.82) {
          silverInlet.x *= radius * 0.82 / radial;
          silverInlet.z *= radius * 0.82 / radial;
        }
        silverInlet.y = (level.value - up.value.x * silverInlet.x - up.value.z * silverInlet.z)
          / Math.max(0.2, up.value.y) - 0.0007;
        const previousExtent = silverField.extent;
        const agitation = Math.max(motion,
          Math.min(1, Math.hypot(slope.x - previousSlopeX, slope.y - previousSlopeZ) * 15));
        const silverDelta = Math.min(elapsed, 0.05);
        silverField.advance(silverDelta, up.value, level.value, silverInlet,
          attachedNow ? (impact?.reagentId === "nacl" ? impact.deliveredMl : 0)
            : THREE.MathUtils.smoothstep(silverField.ageSeconds + silverDelta, 0, 1.3), agitation,
          impact?.flowMlPerSecond ?? 1,
          impact?.reagentId === "nacl" ? impactDirection.copy(impact.direction)
            .applyQuaternion(volume.getWorldQuaternion(impactQuaternion).invert()) : undefined);
        updateTubeFlowDebug("AgCl", silverField.solver, silverField.tracer,
          silverField.species["Cl-"].values, silverField.pixels, silverField.sedimentMass,
          () => ({ suspensionMass: silverField.suspensionMass, formed: silverField.extent,
            aggregateMass: silverField.coarseMass, massBalanceError: silverField.massBalanceError,
            silverRemaining: silverField.species["Ag+"].total,
            chlorideRemaining: silverField.species["Cl-"].total }),
          { "Ag+": silverField.species["Ag+"].values,
            "Cl-": silverField.species["Cl-"].values,
            "product source": silverField.productSource,
            suspension: silverField.suspension[0], aggregates: silverField.coarse });
        if (attachedNow) syncSilverExtent(attachedNow.instanceId, silverField.extent);
        if (options.activeSurface) {
          const stand = useBunsenStandStorageStore.getState();
          const tubes = useTestTubeStorageStore.getState();
          const index = stand.attachedTubeSlotIndex;
          const attached = index === null ? undefined
            : (stand.onFumeHood ? tubes.fumeHoodTestTubes : tubes.workbenchTestTubes)[index];
          if (attached?.contents.includes("agno3") && attached.contents.includes("nacl")) {
            const store = useTubeReactionStore.getState();
            const current = store.chemistryById[attached.instanceId];
            const fieldProgress = silverField.progress;
            const fieldRate = dt > 0 ? (silverField.extent - previousExtent) / dt : 0;
            if (current && (Math.abs(current.progress - fieldProgress) > 1e-4
              || Math.abs(current.rate - fieldRate) > 1e-3
              || Date.now() - (current.fieldUpdatedAt ?? 0) > 300))
              store.setChemistry(attached.instanceId, { ...current, progress: fieldProgress,
                rate: fieldRate, fieldUpdatedAt: Date.now() });
          }
        }
      }
      if (backdrop && backdropWall && backdropCap) {
        backdrop.up.value.copy(up.value);
        backdrop.level.value = level.value;
        backdrop.tracerStrength.value = transport && !options.incomingDyed && transport.running ? 1 : 0;
        backdropWall.visible = refraction && quality !== "LOW" && !options.incomingDyed && !inertTracerOnly;
        // The top ray also crosses coloured liquid. Its transmitted backdrop
        // must use the same absorption/scattering as the cylindrical wall.
        backdropCap.visible = backdropWall.visible && p > 0.01
          && (kind === "copper-nitric" || kind === "barium-sulfate");
      }
      inverse.copy(volume.matrixWorld).invert();
      if (cameraPosition) cameraLocal.copy(cameraPosition).applyMatrix4(inverse);
      if (absorption && absorptionWall && absorptionCap) {
        absorption.uniforms.uUp.value.copy(up.value);
        absorption.uniforms.uLevel.value = level.value;
        absorption.uniforms.uCameraLocal.value.copy(cameraLocal);
        absorption.uniforms.uKind.value = kind === "copper-nitric" ? 1 : permanganateField ? 3 : 2;
        absorption.uniforms.uProgress.value = p;
        if (copperField) {
          absorption.uniforms.uCuPrevious.value = copperField.previous;
          absorption.uniforms.uCuCurrent.value = copperField.current;
          absorption.uniforms.uCuBlend.value = copperField.alpha;
          absorption.uniforms.uCuCompletion.value = p;
          absorption.uniforms.uCuTime.value = time;
          // Copper composites after absorption. A sphere proxy here would
          // hide concentration in front of the irregular metal surface.
          absorption.uniforms.uCuCount.value = 0;
        }
        if (permanganateField) {
          absorption.uniforms.uMnField.value = permanganateField.texture;
          absorption.uniforms.uCuTime.value = time;
        }
        absorption.uniforms.uTransport.value = transport?.texture ?? null;
        absorption.uniforms.uTransportAge.value = transport?.age ?? 0;
        absorption.uniforms.uIncomingDyed.value = kind === "permanganate-redox" && options.incomingDyed ? 1 : 0;
        absorptionWall.visible = hasLiquid && !inertTracerOnly && (standalonePermanganate || !!permanganateField || p > 0.001);
        absorptionCap.visible = absorptionWall.visible;
      }
      immersion.uniforms.uImmersionWorldToLocal.value.copy(inverse);
      immersion.uniforms.uImmersionCamera.value.copy(cameraLocal);
      immersion.uniforms.uImmersionUp.value.copy(up.value);
      immersion.uniforms.uImmersionLevel.value = level.value;
      immersion.uniforms.uImmersionProgress.value = p;
      immersion.uniforms.uImmersionRate.value = rate;
      immersion.uniforms.uImmersionTime.value = time;
      if (copperField) {
        immersion.uniforms.uCuPrevious.value = copperField.previous;
        immersion.uniforms.uCuCurrent.value = copperField.current;
        immersion.uniforms.uCuBlend.value = copperField.alpha;
        immersion.uniforms.uCuCompletion.value = p;
        immersion.uniforms.uCuTime.value = time;
        immersion.uniforms.uCuBoundsMin.value.set(-radius, box.min.y, -radius);
        immersion.uniforms.uCuBoundsSize.value.set(2 * radius, copperHeight, 2 * radius);
      }
      immersion.uniforms.uImmersionKind.value = kind === "copper-nitric" ? 1 : options.incomingDyed ? 2 : 0;
      immersion.uniforms.uImmersionDyeActive.value = transport?.running ? 1 : 0;
      if (transport) immersion.uniforms.uImmersionDye.value = transport.texture;
      gravity.set(0, 1, 0).transformDirection(inverse);
      // A visual reservoir outlives the instantaneous chemical rate. Seeking
      // backwards resets it; wall residue clears over several minutes.
      if (reverseTime) {
        gasState.reset(); noBubbles.reset(); lastGasProgress = 0; surfaceActivity = 0;
        heatPulseAge = 0; waveSurface?.reset();
      }
      if (waveSurface && hasLiquid) {
        if (pendingPour) {
          waveSurface.impulse(0.12, -0.08, radius * 0.11, 0.28);
          pendingPour = false;
        }
        const dx = slope.x - previousSlopeX, dz = slope.y - previousSlopeZ;
        const movement = Math.hypot(dx, dz);
        if (movement > 0.001) waveSurface.impulse(dx / movement * 0.76, dz / movement * 0.76,
          Math.min(radius * 0.08, radius * 0.22 * movement), 0.27);
        if (bariumField && motion > 0.03) {
          const acceleration = tubeMotion.impulse;
          const horizontal = Math.hypot(acceleration.x, acceleration.z);
          if (horizontal > 0.001) waveSurface.impulse(
            acceleration.x / horizontal * 0.72, acceleration.z / horizontal * 0.72,
            radius * Math.min(0.035, 0.018 * motion) * dt * 20, 0.3);
        }
        heatPulseAge += dt * THREE.MathUtils.smoothstep(temperature, 0.72, 1);
        if (heatPulseAge > 0.14) {
          heatPulseAge -= 0.14;
          const phase = time * 19.7;
          waveSurface.impulse(Math.sin(phase) * 0.52, Math.cos(phase * 0.83) * 0.52,
            radius * 0.025, 0.22);
        }
      }
      film.visible = !!options.pour && pourAge < 2.5;
      if (film.visible) {
        const lower = box.min.y + size.y * fill;
        const top = lip.y - 0.004;
        const leading = THREE.MathUtils.lerp(top, lower,
          THREE.MathUtils.smoothstep(pourAge, 0, 0.72));
        const trailing = THREE.MathUtils.lerp(top, lower,
          THREE.MathUtils.smoothstep(pourAge, 1.28, 2.45));
        const positions = filmGeometry.getAttribute("position") as THREE.BufferAttribute;
        const uv = filmGeometry.getAttribute("uv");
        const towardCameraX = cameraLocal.x - center.x;
        const towardCameraZ = cameraLocal.z - center.z;
        const cameraDistance = Math.max(0.001, Math.hypot(towardCameraX, towardCameraZ));
        const wallX = towardCameraX / cameraDistance;
        const wallZ = towardCameraZ / cameraDistance;
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const width = (uv.getX(vertex) - 0.5) * Math.min(0.0035, radius * 0.36);
          const y = THREE.MathUtils.lerp(leading, trailing, uv.getY(vertex));
          // The dyed trickle clings to the near-side inner wall, close to its
          // silhouette. In projection it must never resemble an axial rod.
          const theta = 1.24 + width / radius + Math.sin(y * 100 + pourAge * 4) * 0.005;
          const x = center.x + radius * 0.965 * (wallX * Math.cos(theta) - wallZ * Math.sin(theta));
          const z = center.z + radius * 0.965 * (wallZ * Math.cos(theta) + wallX * Math.sin(theta));
          positions.setXYZ(vertex, x, y, z);
        }
        positions.needsUpdate = true;
        filmMaterial.uniforms.uAge.value = pourAge;
        filmMaterial.uniforms.uFade.value = THREE.MathUtils.smoothstep(pourAge, 0, 0.18)
          * (1 - THREE.MathUtils.smoothstep(pourAge, 1.35, 2.5));
        if (waveSurface && pourAge > 0.65 && pourAge < 1.45 && Math.floor((pourAge - dt) * 8) !== Math.floor(pourAge * 8))
          waveSurface.impulse(0.22, 0.70, radius * 0.055, 0.22);
      }
      pourAir.visible = !!options.pour && !options.incomingDyed && pourAge > 0.66 && pourAge < 2.15 && hasLiquid;
      pourAir.count = quality === "LOW" ? 6 : 12;
      if (pourAir.visible) {
        const surfaceY = box.min.y + size.y * fill;
        for (let i = 0; i < pourAir.count; i++) {
          const age = pourAge - 0.70 - i * 0.06;
          const x = center.x + radius * (0.13 + 0.20 * random(i + 228));
          const z = center.z + radius * (0.30 + 0.28 * random(i + 452));
          const y = Math.min(surfaceY - 0.0005, surfaceY - 0.012 + Math.max(0, age) * 0.07);
          const scale = age > 0 && age < 0.8 && y < surfaceY - 0.0006
            ? radius * (0.024 + random(i + 611) * 0.035)
              * THREE.MathUtils.smoothstep(age, 0, 0.12) : 0;
          place(pourAir, i, x, y, z, scale, scale, scale);
        }
        pourAir.instanceMatrix.needsUpdate = true;
      }
      const gasProgress = kind === "copper-nitric" ? reactionProgress ?? p : 0;
      if (gasProgress < lastGasProgress - 1e-6) { gasState.reset(); noBubbles.reset(); lastGasProgress = 0; }
      const deltaExtent = Math.max(0, gasProgress - lastGasProgress);
      lastGasProgress = gasProgress;
      gasState.oxygenAvailable = readDeveloperOxygen();
      gasState.advance(deltaExtent, dt);
      wettedSites.length = 0;
      if (kind === "copper-nitric" && copper && (deltaExtent > 0 || noBubbles.born > 0)) {
        for (let i = 0; i < bubbleSites.length; i++) {
          const child = copper?.children[i % copper.children.length];
          if (!(child instanceof THREE.Mesh) || !child.visible) continue;
          const vertices = child.geometry.getAttribute("position");
          if (!vertices?.count) continue;
          let vertex = Math.floor(random(i * 17 + 571) * vertices.count);
          // The underside rests against the rounded glass floor. Prefer
          // exposed metal so attached bubbles remain visible on the granule.
          for (let attempt = 0; attempt < 8 && vertices.getY(vertex) < -copperBounds[i % copperBounds.length] * 0.12; attempt++)
            vertex = (vertex + 17) % vertices.count;
          child.updateMatrix();
          bubbleSiteVertex.fromBufferAttribute(vertices, vertex).applyMatrix4(child.matrix);
          // Include the face toward the camera: attached bubbles should coat
          // the visible copper surface and hide part of its volume.
          if (bubbleSiteVertex.dot(up.value) > level.value - radius * 0.015) continue;
          bubbleSites[i].copy(bubbleSiteVertex);
          wettedSites.push(bubbleSites[i]);
        }
      }
      noBubbles.advance(dt, 2 * deltaExtent, Math.pow(copperGranuleRadiusScale(p), 2),
        wettedSites, gravity, level.value, center, radius, copperField?.velocity, time, popSurface,
        copperField ? point => copperField.surfaceActivityAt(point) : undefined);
      if (copperField) copperField.velocity.contributions.bubbles = Math.min(1, noBubbles.activeRising / 24);
      // Even the slow room-temperature reaction coats the copper with fine
      // bubbles; heating mainly makes them grow and detach faster.
      const targetActivity = Math.min(1, (noBubbles.activeRising + noBubbles.born * 0.01) / 30);
      surfaceActivity = THREE.MathUtils.lerp(surfaceActivity, targetActivity, 1 - Math.exp(-dt * 4));
      const count = TUBE_VISUALS.particleCounts[quality];
      const precipitate = kind === "silver-chloride" || kind === "barium-sulfate";
      const curds = kind === "silver-chloride";
      const curdProgress = silverField ? silverField.progress : p;
      const onset = silverField ? Math.min(1, silverField.extent * 25)
        : options.pour && precipitate ? THREE.MathUtils.smoothstep(pourAge, 0, 0.3)
          : THREE.MathUtils.smoothstep(p, 0, 0.006);
      const settled = precipitate ? curds && options.pour
        ? Math.max(THREE.MathUtils.smoothstep(curdProgress, 0.3, 0.82),
          THREE.MathUtils.smoothstep(pourAge, 2.2, 4.5))
        : THREE.MathUtils.smoothstep(curdProgress, curds ? 0.3 : 0.42,
          curds ? 0.82 : 0.98) : 0;
      // The permanganate hold stays at p=0; its vivid reaction material must
      // already be visible before the decolorization front starts moving.
      const reactionLiquidActive = !!liquid && (p > 0 || !!bariumField || !!silverField || kind === "permanganate-redox");
      volume.material = reactionLiquidActive ? liquid : baseline;
      cap.material = volume.material;
      const activeLiquid = reactionLiquidActive ? liquid : base instanceof TubeLiquidMaterial ? base : null;
      if (activeLiquid) {
        activeLiquid.uniforms.uBoundsSize.value.y = renderHeight;
        activeLiquid.uniforms.uUp.value.copy(up.value);
        activeLiquid.uniforms.uLevel.value = level.value;
        activeLiquid.uniforms.uRate.value = rate;
        activeLiquid.uniforms.uTemperature.value = temperature;
        activeLiquid.uniforms.uTime.value = time;
        activeLiquid.uniforms.uCameraLocal.value.copy(cameraLocal);
        if (copperField) {
          activeLiquid.uniforms.uCuPrevious.value = copperField.previous;
          activeLiquid.uniforms.uCuCurrent.value = copperField.current;
          activeLiquid.uniforms.uCuBlend.value = copperField.alpha;
          activeLiquid.uniforms.uCuCompletion.value = p;
          activeLiquid.uniforms.uCuTime.value = time;
          activeLiquid.uniforms.uCuBoundsMin.value.set(-radius, box.min.y, -radius);
          activeLiquid.uniforms.uCuBoundsSize.value.set(2 * radius, copperHeight, 2 * radius);
        }
        if (permanganateField) {
          activeLiquid.uniforms.uMnField.value = permanganateField.texture;
          activeLiquid.uniforms.uMnActive.value = 1;
          activeLiquid.uniforms.uCuTime.value = time;
          activeLiquid.uniforms.uCuBoundsMin.value.set(-radius, box.min.y, -radius);
          activeLiquid.uniforms.uCuBoundsSize.value.set(2 * radius, renderHeight, 2 * radius);
        }
        if (bariumField) {
          activeLiquid.uniforms.uBaField.value = bariumField.texture;
          activeLiquid.uniforms.uBaActive.value = 1;
          activeLiquid.uniforms.uCuBoundsMin.value.set(-radius, box.min.y, -radius);
          activeLiquid.uniforms.uCuBoundsSize.value.set(2 * radius, fieldHeight, 2 * radius);
        }
        if (silverField) {
          activeLiquid.uniforms.uBaField.value = silverField.texture;
          activeLiquid.uniforms.uBaActive.value = 1;
          activeLiquid.uniforms.uCuBoundsMin.value.set(-radius, box.min.y, -radius);
          activeLiquid.uniforms.uCuBoundsSize.value.set(2 * radius, fieldHeight, 2 * radius);
        }
      }
      if (transport) for (const material of [base, liquid]) {
        if (!(material instanceof TubeLiquidMaterial)) continue;
        material.uniforms.uTransport.value = transport.texture;
        material.uniforms.uTransportActive.value = transport.running
          ? 1 - THREE.MathUtils.smoothstep(transport.age, 8, 12) : 0;
        material.uniforms.uTransportDye.value = options.incomingDyed ? 1 : 0;
        material.uniforms.uTransportAge.value = precipitate ? pourAge : transport.age;
        material.uniforms.uTransportQuality.value = quality === "LOW"
          ? TUBE_SIMULATION.render.transportStepsLow : TUBE_SIMULATION.render.transportStepsHigh;
        material.uniforms.uCameraLocal.value.copy(cameraLocal);
      }
      if (liquid) {
        liquid.uniforms.uTracerMode.value = inertTracerOnly ? 1 : 0;
        if (bariumField?.inertTracerOnly) {
          liquid.uniforms.uBaseColor.value.set("#ffffff");
          liquid.uniforms.uReactionColor.value.set("#18c8ec");
        }
        liquid.uniforms.uTime.value = time;
        liquid.uniforms.uReactionProgress.value = curdProgress;
        liquid.uniforms.uReactionKind.value = kind === "copper-nitric" ? 1 : curds ? 2 : kind === "barium-sulfate" ? 3 : 4;
        liquid.uniforms.uCloudiness.value = silverField || bariumField ? 1 : 0;
        liquid.uniforms.uResidualHaze.value = 0;
        liquid.uniforms.uWallFilm.value = 0;
        liquid.uniforms.uOpacity.value = precipitate ? 0.3
          : kind === "permanganate-redox" ? 0.14
            : kind === "copper-nitric" ? THREE.MathUtils.lerp(baseOpacity, 0.13, p)
              : THREE.MathUtils.lerp(baseOpacity, 0.42, p);
        liquid.uniforms.uQualityNoise.value = quality === "LOW" ? 0 : 1;
      }
      const causticTint = kind === "copper-nitric" && p > 0.05 ? "#a5ecff"
        : kind === "permanganate-redox" ? "#ffc0e6" : "#e2f5ff";
      const causticStrength = kind === "barium-sulfate" && p > 0.01 ? 0.035 : 1;
      for (const [mesh, material, scale] of [
        [bottomCaustic, bottomCausticMaterial, 0.30],
        [standCaustic, standCausticMaterial, 0.16],
      ] as const) {
        mesh.visible = hasLiquid && quality !== "LOW" && !curds
          && (mesh !== standCaustic || causticSurfaceStrength > 0.001);
        material.uniforms.uTint.value.set(causticTint);
        material.uniforms.uStrength.value = causticStrength * scale
          * (kind === "permanganate-redox"
            ? THREE.MathUtils.clamp((permanganateField?.species["MnO4-"].total ?? 0) / 2, 0, 1) : 1)
          * (mesh === standCaustic ? causticSurfaceStrength : 1);
        material.uniforms.uWave.value = surfaceActivity;
        material.uniforms.uTime.value = time;
      }
      // AgCl's deposit is made by the same settling flocs, never a smooth cap.
      bed.visible = !!bariumField && bariumField.sedimentMass > 0.02
        || !!silverField && silverField.sedimentMass > 0.01;
      if (bed.visible && bariumField) bedGeometry.update(bariumField.sedimentField);
      if (bed.visible && silverField) {
        bed.geometry = silverBedGeometry;
        silverBedGeometry.update(silverField.sedimentField);
      }
      coarseParticles.visible = p > 0 && !!bariumField && bariumField.coarseMass > 0.0001;
      if (coarseParticles.visible && bariumField) {
        const candidates: number[] = [];
        for (let a = 0; a < bariumField.mask.activeCount; a++) {
          const i = bariumField.mask.active[a];
          if (bariumField.coarse[i] > 0.000006) candidates.push(i);
        }
        candidates.sort((a, b) => bariumField.coarse[b] - bariumField.coarse[a]);
        let shown = 0;
        for (const i of candidates) {
          if (shown >= 18) break;
          const x = i % bariumField.mask.nx;
          const y = Math.floor(i / bariumField.mask.nx) % bariumField.mask.ny;
          const z = Math.floor(i / (bariumField.mask.nx * bariumField.mask.ny));
          const point = bariumField.mask.point(x, y, z, bariumInlet);
          const scale = radius * (0.035 + 0.025 * random(i + 970));
          place(coarseParticles, shown++, point.x, point.y, point.z, scale, scale * 0.75, scale);
        }
        coarseParticles.count = shown;
        coarseParticles.instanceMatrix.needsUpdate = true;
      }
      flakes.visible = curds && !!silverField && silverField.flocs.length > 0;
      flakes.count = silverField ? Math.min(count, silverField.flocs.length) : 0;
      let freeCount = 0, attachedCount = 0;
      const bubbleLimit = noBubbles.capacity;
      for (let i = 0; i < bubbleLimit; i++) {
        const state = noBubbles.state[i];
        if (!state) continue;
        const growth = state === 1 ? THREE.MathUtils.smoothstep(noBubbles.age[i], 0, noBubbles.growTime[i]) : 1;
        const bubbleSize = noBubbles.size[i] * (0.55 + 0.45 * growth);
        if (state === 1) {
          const grain = copper?.children[0];
          attachedNormal.set(noBubbles.x[i] - (grain?.position.x ?? center.x),
            noBubbles.y[i] - (grain?.position.y ?? box.min.y),
            noBubbles.z[i] - (grain?.position.z ?? center.z)).normalize();
          place(attachedBubbles, attachedCount++, noBubbles.x[i] + attachedNormal.x * bubbleSize * 0.95,
            noBubbles.y[i] + attachedNormal.y * bubbleSize * 0.95,
            noBubbles.z[i] + attachedNormal.z * bubbleSize * 0.95,
            bubbleSize, bubbleSize, bubbleSize);
        }
        else place(bubbles, freeCount++, noBubbles.x[i], noBubbles.y[i], noBubbles.z[i],
          bubbleSize, bubbleSize, bubbleSize);
      }
      bubbles.count = freeCount;
      attachedBubbles.count = attachedCount;
      bubbles.visible = freeCount > 0;
      attachedBubbles.visible = attachedCount > 0;
      if (bubbles.visible) bubbles.instanceMatrix.needsUpdate = true;
      if (attachedBubbles.visible) attachedBubbles.instanceMatrix.needsUpdate = true;
      gas.count = 1;
      condensate.visible = kind === "copper-nitric" && temperature > 0.01;
      condensate.count = Math.floor(count / 3);
      dropletMaterial.opacity = (0.15 + temperature * 0.25)
        * THREE.MathUtils.smoothstep(temperature, 0.45, 0.72);
      splash.visible = splashAge >= 0 && splashAge < 1;
      splash.count = Math.max(6, Math.floor(count / 2));
      // Dilute acid produces discrete popping bubbles, not a foam blanket.
      foam.visible = false;
      foam.count = Math.floor(count / 4);
      const foamFade = THREE.MathUtils.smoothstep(rate, 0.45, 0.7);
      foamMaterial.opacity = (0.16 + rate * 0.3) * foamFade;
      const activeCount = Math.max(flakes.visible ? flakes.count : 0, bubbles.visible ? bubbles.count : 0,
        gas.visible ? gas.count : 0, condensate.visible ? condensate.count : 0, splash.visible ? splash.count : 0,
        foam.visible ? foam.count : 0);
      for (let i = 0; i < activeCount; i++) {
        const angle = random(i + 1) * Math.PI * 2;
        const radial = radius * 0.94 * Math.sqrt(random(i + 93));
        const x = curds ? center.x + (2 * ((i * 0.61803398875) % 1) - 1) * radius * 0.97
          : center.x + Math.cos(angle) * radial;
        const z = curds ? center.z + (2 * random(i + 413) - 1)
          * Math.sqrt(Math.max(0, radius * radius * 0.88 - (x - center.x) ** 2))
          : center.z + Math.sin(angle) * radial;
        const grain = radius * (curds ? (0.28 + random(i + 31) * 0.24)
          * (0.55 + 0.45 * THREE.MathUtils.smoothstep(p, 0.02, 0.35)) : 0.06);
        const floor = box.min.y + size.y * (curds ? 0.05 + random(i + 14) * 0.14
          : 0.07 + random(i + 14) * 0.025);
        const drift = Math.sin(time * 0.75 + i * 2.4) * radius * 0.07 * (1 - settled);
        const ingress = curds ? THREE.MathUtils.smoothstep(p * 8, 1 - random(i + 71) - 0.1, 1 - random(i + 71) + 0.1) : 1;
        if (flakes.visible && silverField) {
          const floc = silverField.flocs[i];
          const scale = radius * Math.min(0.65, 0.25 + Math.cbrt(floc.mass) * 1.6);
          place(flakes, i, floc.position.x * 0.78, floc.position.y, floc.position.z * 0.78,
            scale, scale * (0.8 + 0.4 * floc.porosity), scale * 0.85);
        } else if (flakes.visible) {
          const individualSettled = curds && options.pour
            ? THREE.MathUtils.smoothstep(pourAge, 0.45 + random(i + 205) * 0.55,
              3.1 + random(i + 371) * 1.1)
            : curds ? THREE.MathUtils.smoothstep(curdProgress,
              0.16 + random(i + 205) * 0.26, 0.57 + random(i + 371) * 0.28) : settled;
          const settledX = x + drift - gravity.x * radius * individualSettled * 0.3;
          const settledZ = z - gravity.z * radius * individualSettled * 0.3;
          const arrival = transport?.concentratedTracerPoint(i + 17);
          const birthX = arrival && arrival.concentration > 0
            ? THREE.MathUtils.lerp(x, center.x + (arrival.x - 0.5) * radius * 1.3, 0.08) : x;
          // Each poured floc starts at the salt inlet and crosses clear water.
          const surfaceBirth = curds && (options.pour || i % 4 === 0);
          const birthY = surfaceBirth
            ? Math.min(box.min.y + size.y * fill - grain * 1.2, box.max.y - grain)
            : box.min.y + size.y * (0.25 + random(i + 71) * 0.64);
          const birthZ = z * 0.82 + center.z * 0.18;
          const radialSq = (settledX - center.x) ** 2 + (settledZ - center.z) ** 2;
          const bowlY = box.min.y + radius - Math.sqrt(Math.max(0, radius * radius - radialSq));
          const settledY = Math.max(floor, bowlY + grain * 0.3);
          place(flakes, i, THREE.MathUtils.lerp(birthX, settledX, individualSettled),
            THREE.MathUtils.lerp(birthY, settledY, individualSettled), THREE.MathUtils.lerp(birthZ, settledZ, individualSettled),
            grain * onset * ingress, grain * onset * ingress * (curds ? 1.15 : 0.65), grain * onset * ingress);
        }
        if (i < gas.count) {
          // The narrow wisp starts at the lip, never at the liquid.
          const plumeHalfHeight = radius * 1.6;
          const plumeCenter = radius * 1.6;
          place(gas, i, lip.x + gravity.x * plumeCenter,
            lip.y + gravity.y * plumeCenter, lip.z + gravity.z * plumeCenter,
            radius * 0.65, plumeHalfHeight, radius * 0.65);
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
            lip.z + Math.sin(angle) * speed * age,
            radius * 0.16 * THREE.MathUtils.smoothstep(age, 0, 0.12)
              * (1 - THREE.MathUtils.smoothstep(age, 0.7, 1)));
        }
        if (foam.visible && i < foam.count) {
          const localX = center.x + Math.cos(angle) * radius * (0.52 + 0.32 * random(i + 54));
          const localZ = center.z + Math.sin(angle) * radius * (0.52 + 0.32 * random(i + 54));
          const localY = (level.value - up.value.x * localX - up.value.z * localZ) / Math.max(up.value.y, 0.3);
          const pulse = 0.72 + 0.28 * Math.sin(time * 3.1 + i * 2.3);
          place(foam, i, localX, localY + 0.0002, localZ,
            radius * (0.04 + random(i + 73) * 0.05) * pulse * foamFade);
        }
      }
      // Only NO2 absorbs brown light. The gas renderer clips every fragment
      // below the actual, tilted meniscus in its fragment shader.
      const brownDensity = kind === "copper-nitric" ? Math.min(0.32, gasState.no2 * 0.48) : 0;
      headspace.visible = brownDensity > 0.001;
      gas.visible = brownDensity > 0.12;
      gasMaterial.uniforms.uOpacity.value = TUBE_VISUALS.gasOpacity * brownDensity * 0.5;
      gasMaterial.uniforms.uTime.value = time;
      gasMaterial.uniforms.uWorldUp.value.copy(gravity);
      headMaterial.uniforms.uDensity.value = brownDensity * 0.85;
      headMaterial.uniforms.uSurfaceGas.value = brownDensity * 0.035;
      headMaterial.uniforms.uFront.value = 1;
      headMaterial.uniforms.uMouth.value = 1;
      headMaterial.uniforms.uMouthHeight.value = up.value.dot(lip) - level.value;
      headMaterial.uniforms.uResidue.value = 0;
      headMaterial.uniforms.uTime.value = time;
      headMaterial.uniforms.uDetail.value = quality === "LOW" ? 0 : 1;
      for (const mesh of [flakes, bubbles, gas, splash, condensate, foam]) if (mesh.visible) mesh.instanceMatrix.needsUpdate = true;
      if (waveSurface && hasLiquid) waveSurface.advance(dt);
      bottomCausticMaterial.uniforms.uWave.value = standCausticMaterial.uniforms.uWave.value =
        Math.max(surfaceActivity, waveSurface?.activity ?? 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      volume.material = baseline;
      volume.geometry = originalGeometry;
      if (standalonePermanganate) base.uniforms.uReactionKind.value = originalBaseReactionKind;
      volume.renderOrder = originalVolumeOrder;
      glassShell.renderOrder = originalGlassOrder;
      if (dyedShellMaterial) glassShell.material = originalShellMaterial;
      for (const { mesh, transparent, depthWrite, order } of copperDrawState) {
        (mesh.material as THREE.Material).transparent = transparent;
        (mesh.material as THREE.Material).depthWrite = depthWrite;
        (mesh.material as THREE.Material).needsUpdate = true;
        mesh.renderOrder = order;
      }
      detachImmersion.forEach(detach => detach());
      immersion.dispose();
      copperField?.dispose();
      permanganateField?.dispose();
      bariumField?.dispose();
      silverField?.dispose();
      group.removeFromParent();
      deferDispose(group, () => {
        geometry.dispose(); foamGeometry.dispose(); foamMaterial.dispose();
        wallGeometry.dispose(); capGeometry.dispose(); headGeometry.dispose(); headMaterial.dispose(); dropletMaterial.dispose(); splashMaterial.dispose();
        filmGeometry.dispose(); filmMaterial.dispose(); transport?.dispose();
        gasGeometry.dispose(); bedGeometry.dispose(); silverBedGeometry.dispose(); coarseGeometry.dispose(); coarseMaterial.dispose(); bedMaterial.dispose(); bottomCausticGeometry.dispose(); standCausticGeometry.dispose();
        bottomCausticMaterial.dispose(); standCausticMaterial.dispose();
        curdGeometry.dispose();
        white.dispose(); flocMaterial.dispose(); bubbleMaterial.dispose(); pourAirMaterial.dispose(); gasMaterial.dispose(); liquid?.dispose(); backdrop?.material.dispose();
        absorption?.dispose();
        dyedShellMaterial?.dispose();
        for (const mesh of [coarseParticles, flakes, bubbles, pourAir, attachedBubbles, gas, splash, condensate, foam]) mesh.dispose();
      });
    },
  };
}
