import * as THREE from "three";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { deferDispose } from "./deferredDispose";
import { TubeLiquidMaterial } from "./tubeLiquidMaterial";
import { TubeMixingField } from "./tubeMixingField";
import { TubeImmersion } from "./tubeImmersion";
import { TubeAbsorptionMaterial } from "./tubeAbsorptionMaterial";
import { testTubeLiquidFill } from "./testTubeContents";
import type { ReactionKind, TubeChemistry } from "./tubeReactions";
import type { RuntimeQuality } from "./useRuntimeQualityStore";

export const TUBE_VISUALS = {
  copperColor: "#1f7cc2",
  gasColor: "#86634e",
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
varying vec3 vBackdropPoint; varying float vBackdropCap; varying float vBackdropWave;
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
  if (ray.y < -0.00001) distance = min(distance, max(0.0, (bottom - vBackdropPoint.y) / ray.y));
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
      float fill = max(0.001, uBackdropLevel - bottom);
      float liquidH = clamp((dot(uBackdropUp, q) - bottom) / fill, 0.0, 1.0);
      float clearing = smoothstep(0.42, 0.98, uOpticalProgress);
      float front = mix(1.06, -0.06, clearing);
      float cloud = uOpticalCloud * (1.0 - smoothstep(front - 0.055, front + 0.055, liquidH));
      vec2 uv = vec2(clamp(0.5 + dot(q.xz / (radius * 2.0), vec2(0.42, 0.91)), 0.0, 1.0), h);
      cloud *= mix(0.12 + 0.88 * smoothstep(0.015, 0.65, texture2D(uTracer, uv).g),
        1.0, smoothstep(0.35, 1.9, uOpticalAge));
      scattering += clamp(cloud + uOpticalHaze, 0.0, 1.0) * distance / (6.0 * radius) * 3.0;
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
  material.customProgramCacheKey = () => "tube-water-backdrop-v3-vivid-copper";
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
  profile.push(new THREE.Vector2(radius, box.max.y + radius));
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
  const targetFill = testTubeLiquidFill(options.liquidCount ?? 1);
  const startFill = options.pour ? testTubeLiquidFill((options.liquidCount ?? 1) - 1) : targetFill;
  let pourAge = 0;
  const transportDisabled = import.meta.env.DEV && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("noTubeTransport");
  const transport = options.pour && hasLiquid && !transportDisabled ? new TubeMixingField() : null;
  transport?.start(!!options.incomingDyed);
  if (hasLiquid) volume.geometry = wallGeometry;

  const group = new THREE.Group();
  group.name = "TubeReactionVisuals";
  group.position.copy(volume.position);
  group.quaternion.copy(volume.quaternion);
  group.scale.copy(volume.scale);
  volume.parent?.add(group);
  const backdrop = options.activeSurface && hasLiquid
    ? createWaterBackdropMaterial(radius, box.min.y, size.y, transport, liquid ?? base as TubeLiquidMaterial) : null;
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
    ? new TubeAbsorptionMaterial(radius, box.min.y, size.y) : null;
  const absorptionWall = absorption ? new THREE.Mesh(wallGeometry, absorption) : null;
  const absorptionCap = absorption ? new THREE.Mesh(capGeometry, absorption) : null;
  if (absorptionWall && absorptionCap) {
    absorptionWall.name = "TubeAbsorptionWall";
    absorptionCap.name = "TubeAbsorptionSurface";
    absorptionWall.visible = absorptionCap.visible = false;
    absorptionWall.renderOrder = absorptionCap.renderOrder = 0.5;
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
    envMapIntensity: 0.15, transparent: true, depthWrite: true });
  white.onBeforeCompile = (shader) => {
    shader.uniforms.uSedimentWhite = { value: kind === "barium-sulfate" ? 0.92 : 0.97 };
    shader.uniforms.uPowder = { value: kind === "barium-sulfate" ? 1 : 0 };
    shader.uniforms.uSedimentBottom = { value: box.min.y };
    shader.uniforms.uSedimentRadius = { value: radius * 0.98 };
    shader.uniforms.uSedimentCenter = { value: center };
    shader.vertexShader = `varying vec3 vSedimentPoint;\n${shader.vertexShader}`.replace("#include <project_vertex>", `
vSedimentPoint = transformed;
#ifdef USE_INSTANCING
vSedimentPoint = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
#include <project_vertex>`);
    shader.fragmentShader = `varying vec3 vSedimentPoint; uniform float uSedimentWhite; uniform float uPowder;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
vec3 bowlPoint = vec3(vSedimentPoint.xz - uSedimentCenter.xz, min(vSedimentPoint.y - uSedimentBottom - uSedimentRadius, 0.0));
if (vSedimentPoint.y < uSedimentBottom || length(bowlPoint) > uSedimentRadius) discard;`);
    // The nearby burner saturates even non-emissive white. Bound the diffuse
    // response before bloom and keep normal-based relief instead of hot spots.
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
float relief = 0.84 + 0.16 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.3))));
 outgoingLight = vec3(uSedimentWhite) * relief;
 diffuseColor.a *= mix(0.40 + 0.60 * smoothstep(0.0, 0.68,
   abs(dot(normalize(normal), normalize(vViewPosition)))), 1.0, uPowder);
 #include <opaque_fragment>`);
  };
  // Lobed, asymmetric AgCl flocs cast their own small shading variations.
  const curdGeometry = new THREE.IcosahedronGeometry(1, 3);
  const vertices = curdGeometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const lump = 0.75 + 0.23 * Math.sin(x * 5.8 + y * 3.7) * Math.cos(z * 6.4 - y * 4.1)
      + 0.16 * Math.sin(z * 8.1 + x * 4.8) + 0.12 * Math.sin(x * 12 + z * 9);
    vertices.setXYZ(i, x * lump, y * lump * 0.66, z * lump);
  }
  curdGeometry.computeVertexNormals();
  const bubbleMaterial = new THREE.MeshPhysicalMaterial({ color: "#e8f7fa", transparent: true, opacity: 0.85, roughness: 0.04, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
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
    uniforms: { uUp: up, uLevel: level, uDensity: { value: 0 }, uFront: { value: 0 }, uMouth: { value: 0 }, uResidue: { value: 0 }, uTime: { value: 0 }, uDetail: { value: 1 },
      uMouthHeight: { value: lip.y - box.max.y },
      uLip: { value: lip.y }, uRadius: { value: headRadius }, uColor: { value: new THREE.Color(TUBE_VISUALS.gasColor) } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vEye;
void main() { vP = position; vN = normalize(normalMatrix * normal);
vec4 mv = modelViewMatrix * vec4(position, 1.0); vEye = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uUp; uniform float uLevel; uniform float uDensity; uniform float uFront; uniform float uMouth; uniform float uResidue; uniform float uTime; uniform float uDetail; uniform float uMouthHeight;
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
float heightDensity = mix(1.0, 0.92, smoothstep(0.05, 0.95, h));
float facing = abs(dot(normalize(vN), normalize(vEye)));
float edgeFade = smoothstep(0.0, 0.3, facing);
float wallBand = (0.55 + 0.55 * pow(1.0 - facing, 0.55))
  * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.34, 0.72, h));
float lowerFade = smoothstep(-0.002, 0.018, aboveWater);
float rise = mix(1.0 - smoothstep(uFront - 0.12, uFront + 0.08, h),
  uMouth, smoothstep(0.76, 1.0, h));
float mist = (1.0 - exp(-uDensity * 1.55 * heightDensity)) * edgeFade
  * lowerFade * rise * motion;
gl_FragColor = vec4(uColor, min(0.9, mist + uResidue * wallBand * smoothstep(0.0, 0.12, facing)));
#include <colorspace_fragment>
}`,
  });
  const headspace = new THREE.Mesh(headGeometry, headMaterial);
  headspace.name = "TubeNO2Headspace";
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
  const flakes = makePool(white);
  flakes.renderOrder = 1;
  if (kind === "silver-chloride") flakes.geometry = curdGeometry;
  flakes.name = "TubePrecipitate";
  const bubbles = makePool(bubbleMaterial);
  bubbles.name = "TubeNOBubbles";
  const pourAir = makePool(bubbleMaterial, 12);
  pourAir.name = "TubePourAirBubbles";
  const attachedBubbles = makePool(bubbleMaterial, 192);
  // The copper is drawn after refraction; draw the adhering bubbles after it.
  // Depth testing still hides the bubbles on its far side.
  attachedBubbles.renderOrder = 2;
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
  const bedMaterial = white.clone();
  const sedimentLevel = { value: box.min.y };
  const sedimentGravity = { value: new THREE.Vector3(0, 1, 0) };
  const sedimentDrift = { value: 0 };
  bedMaterial.onBeforeCompile = (shader, renderer) => {
    white.onBeforeCompile(shader, renderer);
    shader.uniforms.uSedimentLevel = sedimentLevel;
    shader.uniforms.uSedimentUp = up;
    shader.uniforms.uSedimentGravity = sedimentGravity;
    shader.uniforms.uSedimentDrift = sedimentDrift;
    shader.vertexShader = `uniform float uSedimentLevel; uniform vec3 uSedimentUp;
uniform vec3 uSedimentGravity; uniform float uSedimentDrift;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.vertexShader}`.replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
if (position.y > uSedimentLevel) objectNormal = uSedimentUp;`).replace("#include <begin_vertex>", `#include <begin_vertex>
transformed.y = min(position.y, uSedimentLevel - dot(uSedimentUp.xz, position.xz - uSedimentCenter.xz) / max(0.3, uSedimentUp.y));
float h = clamp(transformed.y - uSedimentBottom, 0.0, uSedimentRadius);
float availableRadius = sqrt(max(0.0, h * (2.0 * uSedimentRadius - h)));
vec2 radial = position.xz - uSedimentCenter.xz - uSedimentGravity.xz * uSedimentDrift;
transformed.xz = uSedimentCenter.xz + radial * min(1.0, availableRadius / max(length(radial), 0.000001));`);
  };
  const bed = new THREE.Mesh(originalGeometry, bedMaterial);
  bed.renderOrder = 1;
  bed.name = "TubeSediment";
  bed.visible = false;
  bed.raycast = () => {};
  group.add(bed);
  const dummy = new THREE.Object3D();
  const random = (i: number) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
  // Weight the exposed face in the default game close-up, while retaining
  // sites around the back for other viewing angles.
  const coatFacing = new THREE.Vector3(0.82, 0.27, 0.50).normalize();
  const coatRight = new THREE.Vector3(0, 1, 0).cross(coatFacing).normalize();
  const coatUp = coatFacing.clone().cross(coatRight).normalize();
  const bubbleSpecs = Array.from({ length: 72 }, (_, i) => {
    const mix = random(i + 241);
    const variation = random(i + 619);
    if (mix < 0.04) return { diameterMm: 0.18 + variation * 0.08, speed: 0.015, wobble: 0.006 };
    if (mix < 0.24) return { diameterMm: 0.45 + variation * 0.15, speed: 0.06, wobble: 0.015 };
    if (mix < 0.94) return { diameterMm: 0.85 + variation * 0.35, speed: 0.125, wobble: 0.03 };
    return { diameterMm: 1.2 + variation * 0.3, speed: 0.18, wobble: 0.045 };
  });
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  let disposed = false;
  let lastTime: number | undefined;
  let mouthFill = 0;
  // Seconds since vigorous NO evolution began; -1 while it has not.
  let airBrownAge = -1;
  let bubblePhase = 0;
  let surfaceActivity = 0;
  let bubbleStopAge = Infinity;
  let wasProducingBubbles = false;
  let bariumCompletionAge = 0;
  let pendingPour = !!options.pour;
  let heatPulseAge = 0;
  const previousBubbleRise = new Float32Array(72).fill(-1);
  const releasedBubbles: { position: THREE.Vector3; scale: THREE.Vector3 }[] = [];
  const releasedAttached: { position: THREE.Vector3; scale: THREE.Vector3 }[] = [];
  const snapshotBubbles = (pool: THREE.InstancedMesh, target: typeof releasedBubbles) => {
    target.length = 0;
    if (!pool.visible) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < pool.count; i++) {
      pool.getMatrixAt(i, matrix);
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);
      if (scale.x > 0) target.push({ position: new THREE.Vector3().setFromMatrixPosition(matrix), scale });
    }
  };
  let motionReady = false;
  const slope = new THREE.Vector2();
  const velocity = new THREE.Vector2();
  const gravity = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const cameraLocal = new THREE.Vector3();
  const copper = root.getObjectByName("TubeCopperGranules");
  const immersion = new TubeImmersion(center, radius, box.min.y, size.y);
  const detachImmersion = [immersion.attach(white), immersion.attach(bubbleMaterial)];
  const copperDrawState: { mesh: THREE.Mesh; transparent: boolean; order: number }[] = [];
  if (copper) copper.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) {
      detachImmersion.push(immersion.attach(object.material));
      if (absorption) {
        copperDrawState.push({ mesh: object, transparent: object.material.transparent, order: object.renderOrder });
        object.material.transparent = true;
        object.material.needsUpdate = true;
        object.renderOrder = 2;
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
  const source = new THREE.Vector3();
  const bubblePoint = new THREE.Vector3();
  const causticRay = new THREE.Raycaster();
  const causticOrigin = new THREE.Vector3();
  const causticPoint = new THREE.Vector3();
  const causticNormal = new THREE.Vector3();
  const lastCausticOrigin = new THREE.Vector3(Infinity, Infinity, Infinity);
  let causticProbed = false;
  let causticSurfaceStrength = 0;
  return {
    update(chemistry: TubeChemistry, time: number, quality: RuntimeQuality, splashAge: number,
      refraction = false, cameraPosition?: THREE.Vector3) {
      const { progress } = chemistry;
      const rate = Number.isFinite(chemistry.rate) ? THREE.MathUtils.clamp(chemistry.rate, 0, 1) : 0;
      const temperature = Number.isFinite(chemistry.temperature) ? THREE.MathUtils.clamp(chemistry.temperature, 0, 1) : 0;
      const p = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
      const reverseTime = lastTime !== undefined && time < lastTime;
      const dt = lastTime === undefined ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, 0.1);
      lastTime = time;
      pourAge += dt;
      const fill = THREE.MathUtils.lerp(startFill, targetFill,
        THREE.MathUtils.smoothstep(pourAge, 0, 1.3));
      transport?.advance(dt, fill);
      waveSurface?.setQuality(quality);
      volume.updateWorldMatrix(true, false);
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
      if (backdrop && backdropWall && backdropCap) {
        backdrop.up.value.copy(up.value);
        backdrop.level.value = level.value;
        backdrop.tracerStrength.value = transport && !options.incomingDyed && transport.running ? 1 : 0;
        backdropWall.visible = refraction && quality !== "LOW" && !options.incomingDyed;
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
        absorption.uniforms.uKind.value = kind === "copper-nitric" ? 1 : 2;
        absorption.uniforms.uProgress.value = p;
        absorption.uniforms.uTransport.value = transport?.texture ?? null;
        absorption.uniforms.uTransportAge.value = transport?.age ?? 0;
        absorption.uniforms.uIncomingDyed.value = kind === "permanganate-redox" && options.incomingDyed ? 1 : 0;
        absorptionWall.visible = hasLiquid && (standalonePermanganate
          || (kind === "permanganate-redox"
            ? options.incomingDyed ? (transport?.age ?? 0) < 18 : p < 0.999
            : p > 0.001));
        absorptionCap.visible = absorptionWall.visible;
      }
      immersion.uniforms.uImmersionWorldToLocal.value.copy(inverse);
      immersion.uniforms.uImmersionCamera.value.copy(cameraLocal);
      immersion.uniforms.uImmersionUp.value.copy(up.value);
      immersion.uniforms.uImmersionLevel.value = level.value;
      immersion.uniforms.uImmersionProgress.value = p;
      immersion.uniforms.uImmersionKind.value = kind === "copper-nitric" ? 1 : options.incomingDyed ? 2 : 0;
      immersion.uniforms.uImmersionDyeActive.value = transport?.running ? 1 : 0;
      if (transport) immersion.uniforms.uImmersionDye.value = transport.texture;
      gravity.set(0, 1, 0).transformDirection(inverse);
      sedimentGravity.value.copy(gravity);
      // A visual reservoir outlives the instantaneous chemical rate. Seeking
      // backwards resets it; wall residue clears over several minutes.
      if (reverseTime) {
        mouthFill = 0; bubblePhase = 0; surfaceActivity = 0;
        bubbleStopAge = Infinity; wasProducingBubbles = false;
        bariumCompletionAge = 0;
        heatPulseAge = 0; previousBubbleRise.fill(-1); waveSurface?.reset();
        releasedBubbles.length = 0; releasedAttached.length = 0;
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
      bubblePhase += dt;
      const drive = kind === "copper-nitric" && p > 0 && p < 0.999 ? rate : 0;
      const producingBubbles = drive > 0.005;
      if (!producingBubbles && wasProducingBubbles) {
        snapshotBubbles(bubbles, releasedBubbles);
        snapshotBubbles(attachedBubbles, releasedAttached);
        bubbleStopAge = 0;
      } else if (producingBubbles) {
        bubbleStopAge = Infinity;
        releasedBubbles.length = 0;
        releasedAttached.length = 0;
      }
      wasProducingBubbles = producingBubbles;
      if (!producingBubbles && bubbleStopAge < Infinity) bubbleStopAge += dt;
      // Even the slow room-temperature reaction coats the copper with fine
      // bubbles; heating mainly makes them grow and detach faster.
      const targetActivity = producingBubbles ? 0.35 + 0.65 * Math.sqrt(drive) : 0;
      surfaceActivity = THREE.MathUtils.lerp(surfaceActivity, targetActivity, 1 - Math.exp(-dt * 4));
      const count = TUBE_VISUALS.particleCounts[quality];
      const precipitate = kind === "silver-chloride" || kind === "barium-sulfate";
      const curds = kind === "silver-chloride";
      const curdProgress = curds && options.pour
        ? Math.min(p, THREE.MathUtils.smoothstep(pourAge, 0, 14)) : p;
      const onset = THREE.MathUtils.smoothstep(p, 0, curds ? 0.006 : 0.006);
      const settled = precipitate ? THREE.MathUtils.smoothstep(curdProgress,
        curds ? 0.3 : 0.42, curds ? 0.82 : 0.98) : 0;
      if (kind === "barium-sulfate") bariumCompletionAge = p >= 0.999
        ? bariumCompletionAge + dt : 0;
      // The permanganate hold stays at p=0; its vivid reaction material must
      // already be visible before the decolorization front starts moving.
      const reactionLiquidActive = !!liquid && (p > 0 || kind === "permanganate-redox");
      volume.material = reactionLiquidActive ? liquid : baseline;
      cap.material = volume.material;
      const activeLiquid = reactionLiquidActive ? liquid : base instanceof TubeLiquidMaterial ? base : null;
      if (activeLiquid) {
        activeLiquid.uniforms.uUp.value.copy(up.value);
        activeLiquid.uniforms.uLevel.value = level.value;
        activeLiquid.uniforms.uRate.value = rate;
        activeLiquid.uniforms.uTemperature.value = temperature;
        activeLiquid.uniforms.uTime.value = time;
        activeLiquid.uniforms.uCameraLocal.value.copy(cameraLocal);
      }
      if (transport) for (const material of [base, liquid]) {
        if (!(material instanceof TubeLiquidMaterial)) continue;
        material.uniforms.uTransport.value = transport.texture;
        material.uniforms.uTransportActive.value = transport.running
          ? 1 - THREE.MathUtils.smoothstep(transport.age, 8, 12) : 0;
        material.uniforms.uTransportDye.value = options.incomingDyed ? 1 : 0;
        material.uniforms.uTransportAge.value = transport.age;
        material.uniforms.uTransportQuality.value = quality === "LOW" ? 6 : 16;
        material.uniforms.uCameraLocal.value.copy(cameraLocal);
      }
      if (liquid) {
        liquid.uniforms.uTime.value = time;
        liquid.uniforms.uReactionProgress.value = curdProgress;
        liquid.uniforms.uReactionKind.value = kind === "copper-nitric" ? 1 : curds ? 2 : kind === "barium-sulfate" ? 3 : 4;
        liquid.uniforms.uCloudiness.value = curds ? onset * (1 - settled)
          : kind === "barium-sulfate" ? onset : 0;
        liquid.uniforms.uResidualHaze.value = kind === "barium-sulfate"
          ? 0.035 * THREE.MathUtils.smoothstep(p, 0.90, 1)
            * (1 - THREE.MathUtils.smoothstep(bariumCompletionAge, 45, 195)) : 0;
        liquid.uniforms.uWallFilm.value = kind === "barium-sulfate"
          ? THREE.MathUtils.smoothstep(p, 0.33, 0.95) : 0;
        liquid.uniforms.uOpacity.value = precipitate ? 0.3
          : kind === "permanganate-redox" ? THREE.MathUtils.lerp(baseOpacity, 0.14, p)
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
          * (mesh === standCaustic ? causticSurfaceStrength : 1);
        material.uniforms.uWave.value = surfaceActivity;
        material.uniforms.uTime.value = time;
      }
      // AgCl's deposit is made by the same settling flocs, never a smooth cap.
      bed.visible = kind === "barium-sulfate" && settled > 0;
      sedimentLevel.value = box.min.y + (curds ? size.y * settled * 0.155
        : Math.sqrt(settled) * Math.min(0.003, size.y * 0.06));
      sedimentDrift.value = radius * settled * 0.55;
      flakes.visible = curds && p > 0;
      flakes.count = count;
      bubbles.visible = producingBubbles || bubbleStopAge < 1.8 && releasedBubbles.length > 0;
      bubbles.count = producingBubbles ? count : releasedBubbles.length;
      attachedBubbles.visible = producingBubbles && surfaceActivity > 0.02
        || bubbleStopAge < 1.8 && releasedAttached.length > 0;
      attachedBubbles.count = producingBubbles
        ? (quality === "LOW" ? 128 : quality === "MEDIUM" ? 160 : 192)
        : releasedAttached.length;
      gas.count = 1;
      condensate.visible = kind === "copper-nitric" && temperature > 0.01;
      condensate.count = Math.floor(count / 3);
      dropletMaterial.opacity = (0.15 + temperature * 0.25)
        * THREE.MathUtils.smoothstep(temperature, 0.45, 0.72);
      if (copper) {
        const shrink = Math.cbrt(Math.max(0, 1 - p));
        copper.children.forEach((child, i) => {
          const etch = THREE.MathUtils.smoothstep(p * (0.8 + random(i + 150) * 0.38), 0.02, 0.9);
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.color.set("#d58b68").lerp(new THREE.Color("#bd785b"), etch * 0.45);
            child.material.roughness = THREE.MathUtils.lerp(0.32, 0.68, etch);
            child.material.metalness = THREE.MathUtils.lerp(0.62, 0.40, etch);
          }
          // A bounding sphere encloses every rotated, irregular grain. Fit
          // that sphere inside the bowl instead of trusting its drop target.
          const fit = Math.min(1, radius * 0.86 / Math.max(copperBounds[i], 0.000001));
          child.scale.setScalar(shrink * fit * (1 - etch * random(i + 173) * 0.24));
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
      const copperGrain = copper?.children[0];
      if (producingBubbles) attachedBubbles.visible = attachedBubbles.visible && copperGrain instanceof THREE.Mesh && copperGrain.visible;
      if (attachedBubbles.visible && producingBubbles && copperGrain instanceof THREE.Mesh) {
        const grainBound = copperBounds[0] * copperGrain.scale.x;
        for (let i = 0; i < attachedBubbles.count; i++) {
          // A disk distribution fills the visible face instead of making a
          // silhouette ring. Remaining sites cover the back of the grain.
          const angle = random(i + 413) * Math.PI * 2;
          if (random(i + 981) < 0.78) {
            const radial = Math.sqrt(random(i + 521)) * 0.96;
            source.copy(coatFacing).multiplyScalar(Math.sqrt(1 - radial * radial))
              .addScaledVector(coatRight, radial * Math.cos(angle))
              .addScaledVector(coatUp, radial * Math.sin(angle));
          } else {
            const elevation = -0.15 + 1.1 * random(i + 521);
            const radial = Math.sqrt(Math.max(0, 1 - elevation * elevation));
            source.set(Math.cos(angle) * radial, elevation, Math.sin(angle) * radial);
          }
          const elevation = source.y;
          const cycle = (bubblePhase * (0.38 + rate * 0.30 + Math.max(0, elevation) * 0.35)
            + random(i + 307)) % 1;
          const growth = THREE.MathUtils.smoothstep(cycle, 0.02, 0.77);
          const release = 1 - THREE.MathUtils.smoothstep(cycle, 0.78, 1);
          const site = random(i + 721);
          const siteFade = THREE.MathUtils.smoothstep(surfaceActivity, site - 0.03, site + 0.03);
          const sizeBubble = radius * (0.045 + 0.045 * growth) * release
            * THREE.MathUtils.smoothstep(cycle, 0, 0.08) * siteFade
            * THREE.MathUtils.smoothstep(surfaceActivity, 0, 0.18) * copperGrain.scale.x;
          source.multiplyScalar(grainBound * 1.03).add(copperGrain.position);
          place(attachedBubbles, i, source.x, source.y + radius * 0.22 * (1 - release), source.z,
            sizeBubble, sizeBubble, sizeBubble);
        }
        attachedBubbles.instanceMatrix.needsUpdate = true;
      } else if (attachedBubbles.visible) {
        for (let i = 0; i < releasedAttached.length; i++) {
          const { position, scale } = releasedAttached[i];
          const distance = Math.max(0, (level.value - up.value.dot(position)) / Math.max(0.3, up.value.dot(gravity)));
          const fade = 1 - THREE.MathUtils.smoothstep(bubbleStopAge, 0.8, 1.8);
          place(attachedBubbles, i, position.x + gravity.x * distance * bubbleStopAge / 1.8,
            position.y + gravity.y * distance * bubbleStopAge / 1.8,
            position.z + gravity.z * distance * bubbleStopAge / 1.8,
            scale.x * fade, scale.y * fade, scale.z * fade);
        }
        attachedBubbles.instanceMatrix.needsUpdate = true;
      }
      splash.visible = splashAge >= 0 && splashAge < 1;
      splash.count = Math.max(6, Math.floor(count / 2));
      // Dilute acid produces discrete popping bubbles, not a foam blanket.
      foam.visible = false;
      foam.count = Math.floor(count / 4);
      const foamFade = THREE.MathUtils.smoothstep(rate, 0.45, 0.7);
      foamMaterial.opacity = (0.16 + rate * 0.3) * foamFade;
      const activeCount = Math.max(flakes.visible ? count : 0, bubbles.visible ? bubbles.count : 0,
        gas.visible ? gas.count : 0, condensate.visible ? condensate.count : 0, splash.visible ? splash.count : 0,
        foam.visible ? foam.count : 0);
      for (let i = 0; i < activeCount; i++) {
        const angle = random(i + 1) * Math.PI * 2;
        const radial = radius * 0.94 * Math.sqrt(random(i + 93));
        const x = curds ? center.x + (2 * ((i * 0.61803398875) % 1) - 1) * radius * 0.90
          : center.x + Math.cos(angle) * radial;
        const z = curds ? center.z + (2 * random(i + 413) - 1)
          * Math.sqrt(Math.max(0, radius * radius * 0.88 - (x - center.x) ** 2))
          : center.z + Math.sin(angle) * radial;
        const grain = radius * (curds ? (0.28 + random(i + 31) * 0.20)
          * (0.55 + 0.45 * THREE.MathUtils.smoothstep(p, 0.02, 0.35)) : 0.06);
        const floor = box.min.y + size.y * (curds ? 0.045 + random(i + 14) * 0.11
          : 0.07 + random(i + 14) * 0.025);
        const drift = Math.sin(time * 0.75 + i * 2.4) * radius * 0.07 * (1 - settled);
        const ingress = curds ? THREE.MathUtils.smoothstep(p * 8, 1 - random(i + 71) - 0.1, 1 - random(i + 71) + 0.1) : 1;
        if (flakes.visible) {
          const individualSettled = curds ? THREE.MathUtils.smoothstep(curdProgress,
            0.16 + random(i + 205) * 0.26, 0.57 + random(i + 371) * 0.28) : settled;
          const settledX = x + drift - gravity.x * radius * individualSettled * 0.3;
          const settledZ = z - gravity.z * radius * individualSettled * 0.3;
          const arrival = transport?.concentratedTracerPoint(i + 17);
          const birthX = arrival && arrival.concentration > 0
            ? THREE.MathUtils.lerp(x, center.x + (arrival.x - 0.5) * radius * 1.3, 0.08) : x;
          const birthY = box.min.y + size.y * (0.25 + random(i + 71) * 0.64);
          const birthZ = z * 0.82 + center.z * 0.18;
          const radialSq = (settledX - center.x) ** 2 + (settledZ - center.z) ** 2;
          const bowlY = box.min.y + radius - Math.sqrt(Math.max(0, radius * radius - radialSq));
          const settledY = Math.max(floor, bowlY + grain * 0.3);
          place(flakes, i, THREE.MathUtils.lerp(birthX, settledX, individualSettled),
            THREE.MathUtils.lerp(birthY, settledY, individualSettled), THREE.MathUtils.lerp(birthZ, settledZ, individualSettled),
            grain * onset * ingress, grain * onset * ingress * (curds ? 1.15 : 0.65), grain * onset * ingress);
        }
        if (bubbles.visible && !producingBubbles && i < bubbles.count) {
          const { position, scale } = releasedBubbles[i];
          const distance = Math.max(0, (level.value - up.value.dot(position)) / Math.max(0.3, up.value.dot(gravity)));
          const fade = 1 - THREE.MathUtils.smoothstep(bubbleStopAge, 0.8, 1.8);
          place(bubbles, i, position.x + gravity.x * distance * bubbleStopAge / 1.8,
            position.y + gravity.y * distance * bubbleStopAge / 1.8,
            position.z + gravity.z * distance * bubbleStopAge / 1.8,
            scale.x * fade, scale.y * fade, scale.z * fade);
        } else if (bubbles.visible && i < bubbles.count) {
          const site = i % 8;
          const chain = Math.floor(i / 8);
          const spec = bubbleSpecs[i];
          const rise = (bubblePhase * spec.speed / (size.y * 0.72)
            + chain * 0.23) % 1;
          const grainMesh = copper?.children[site % Math.max(1, copper.children.length)];
          if (grainMesh instanceof THREE.Mesh && p < 0.999) {
            const azimuth = site * 2.39996;
            source.set(Math.cos(azimuth), 0.36 + random(site + 201) * 0.35, Math.sin(azimuth))
              .normalize().multiplyScalar(copperBounds[site % copperBounds.length] * 0.84).multiply(grainMesh.scale)
              .applyQuaternion(grainMesh.quaternion).add(grainMesh.position);
          }
          else source.set(x * 0.6, box.min.y + radius * 1.3, z * 0.6);
          const distance = Math.max(0, (level.value - up.value.dot(source)) / Math.max(0.3, up.value.dot(gravity)));
          const travel = rise;
          bubblePoint.copy(source).addScaledVector(gravity, travel * distance);
          bubblePoint.x += Math.sin(time * 3 + site * 1.7 + rise * 8) * radius * spec.wobble * rise;
          bubblePoint.z += Math.cos(time * 2.4 + site * 2.1 + rise * 7) * radius * spec.wobble * 0.82 * rise;
          // A rising bubble hits the wall and slides along it, never exits sideways.
          const radialDistance = Math.hypot(bubblePoint.x, bubblePoint.z);
          if (radialDistance > radius * 0.84) { bubblePoint.x *= radius * 0.84 / radialDistance; bubblePoint.z *= radius * 0.84 / radialDistance; }
          const bubbleFade = THREE.MathUtils.smoothstep(Math.sqrt(drive),
            i / count, (i + 3) / count);
          const cycleFade = THREE.MathUtils.smoothstep(rise, 0, 0.08)
            * (1 - THREE.MathUtils.smoothstep(rise, 0.90, 1));
          const bubbleSize = spec.diameterMm * 0.0005
            * bubbleFade * cycleFade * THREE.MathUtils.smoothstep(drive, 0, 0.06);
          if (producingBubbles && previousBubbleRise[i] > 0.9 && rise < previousBubbleRise[i]) {
            if (waveSurface) waveSurface.impulse((bubblePoint.x - center.x) / radius,
              (bubblePoint.z - center.z) / radius, radius * (0.018 + rate * 0.018), 0.20);
          }
          previousBubbleRise[i] = rise;
          place(bubbles, i, bubblePoint.x, bubblePoint.y, bubblePoint.z, bubbleSize, bubbleSize * (bubbleSize > radius * 0.1 ? 0.82 : 1), bubbleSize);
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
      // NO is colourless inside the tube. Only a faint outlet wisp forms
      // in air during vigorous heated evolution; it disperses quickly.
      const mouthTarget = THREE.MathUtils.smoothstep(drive, 0.3, 0.8)
        * THREE.MathUtils.smoothstep(temperature, 0.15, 0.65);
      mouthFill = THREE.MathUtils.lerp(mouthFill, mouthTarget, 1 - Math.exp(-dt * 3));
      gas.visible = kind === "copper-nitric" && mouthFill > 0.01;
      // The tube starts full of air: the first NO turns it into faint brown
      // NO2 in the upper part, which fades as NO displaces the air. Next to
      // the liquid the gas stays colourless (dilute acid, reference exp1dil-*).
      const vigorous = kind === "copper-nitric" && drive > 0.05 && temperature > 0.1;
      if (kind !== "copper-nitric" || p <= 0 || reverseTime) airBrownAge = -1;
      else if (airBrownAge < 0) { if (vigorous) airBrownAge = 0; }
      else airBrownAge += dt;
      const airBrown = airBrownAge < 0 ? 0 : THREE.MathUtils.smoothstep(airBrownAge, 0, 3)
        * (1 - THREE.MathUtils.smoothstep(airBrownAge, 8, 30));
      headspace.visible = airBrown > 0.01;
      gasMaterial.uniforms.uOpacity.value = TUBE_VISUALS.gasOpacity * mouthFill;
      gasMaterial.uniforms.uTime.value = time;
      gasMaterial.uniforms.uWorldUp.value.copy(gravity);
      // NO rises from the liquid and pushes the air out: the faint brown
      // front climbs to the mouth over ~12 s, leaves, and the tube clears.
      const airAge = Math.max(0, airBrownAge);
      headMaterial.uniforms.uDensity.value = airBrown * 0.6;
      headMaterial.uniforms.uFront.value = THREE.MathUtils.smoothstep(airAge, 0, 12);
      headMaterial.uniforms.uMouth.value = 1 - THREE.MathUtils.smoothstep(airAge, 12, 30);
      headMaterial.uniforms.uMouthHeight.value = up.value.dot(lip) - level.value;
      headMaterial.uniforms.uResidue.value = 0;
      headMaterial.uniforms.uTime.value = time;
      headMaterial.uniforms.uDetail.value = quality === "LOW" ? 0 : 1;
      for (const mesh of [flakes, bubbles, gas, splash, condensate, foam]) if (mesh.visible) mesh.instanceMatrix.needsUpdate = true;
      if (!producingBubbles) previousBubbleRise.fill(-1);
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
      for (const { mesh, transparent, order } of copperDrawState) {
        (mesh.material as THREE.Material).transparent = transparent;
        (mesh.material as THREE.Material).needsUpdate = true;
        mesh.renderOrder = order;
      }
      detachImmersion.forEach(detach => detach());
      immersion.dispose();
      group.removeFromParent();
      deferDispose(group, () => {
        geometry.dispose(); foamGeometry.dispose(); foamMaterial.dispose();
        wallGeometry.dispose(); capGeometry.dispose(); headGeometry.dispose(); headMaterial.dispose(); dropletMaterial.dispose(); splashMaterial.dispose();
        filmGeometry.dispose(); filmMaterial.dispose(); transport?.dispose();
        gasGeometry.dispose(); bedMaterial.dispose(); bottomCausticGeometry.dispose(); standCausticGeometry.dispose();
        bottomCausticMaterial.dispose(); standCausticMaterial.dispose();
        curdGeometry.dispose();
        white.dispose(); bubbleMaterial.dispose(); gasMaterial.dispose(); liquid?.dispose(); backdrop?.material.dispose();
        absorption?.dispose();
        dyedShellMaterial?.dispose();
        for (const mesh of [flakes, bubbles, pourAir, attachedBubbles, gas, splash, condensate, foam]) mesh.dispose();
      });
    },
  };
}
