import * as THREE from "three";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { deferDispose } from "./deferredDispose";
import { TubeLiquidMaterial } from "./tubeLiquidMaterial";
import type { ReactionKind, TubeChemistry } from "./tubeReactions";
import type { RuntimeQuality } from "./useRuntimeQualityStore";

export const TUBE_VISUALS = {
  copperColor: "#78cbd7",
  gasColor: "#86634e",
  gasOpacity: 0.68,
  gasBuildSeconds: 4,
  gasDecaySeconds: 18,
  gasResidueSeconds: 350,
  particleCounts: { LOW: 24, MEDIUM: 36, HIGH: 54, ULTRA: 72 },
  curdLayerHeight: 0.21,
  settlingStart: 0.18,
  settlingEnd: 0.94,
};

const MENISCUS_RISE = 0.0016;

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
function createWaterBackdropMaterial(radius: number) {
  const material = new THREE.MeshPhysicalMaterial({
    color: "#ffffff", roughness: 0, metalness: 0, ior: 1.333,
    transmission: 1, thickness: radius * 1.8, depthWrite: false,
    side: THREE.FrontSide,
  });
  const up = { value: new THREE.Vector3(0, 1, 0) };
  const level = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uBackdropUp = up;
    shader.uniforms.uBackdropLevel = level;
    shader.vertexShader = `attribute float tubeSurface; attribute float tubeWave;
uniform vec3 uBackdropUp; uniform float uBackdropLevel;
varying vec3 vBackdropPoint; varying float vBackdropCap;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vBackdropCap = tubeSurface;
if (tubeSurface > 0.5) transformed.y =
  (uBackdropLevel - dot(uBackdropUp.xz, position.xz)) / max(uBackdropUp.y, 0.2)
  + 0.0016 * pow(clamp((length(position.xz) / ${radius.toFixed(7)} - 0.67) / 0.33, 0.0, 1.0), 2.0) + tubeWave;
vBackdropPoint = transformed;`);
    shader.fragmentShader = `uniform vec3 uBackdropUp; uniform float uBackdropLevel;
varying vec3 vBackdropPoint; varying float vBackdropCap;
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
if (vBackdropCap < 0.5 && dot(uBackdropUp, vBackdropPoint) > uBackdropLevel + 0.0004) discard;`)
      .replace("#include <opaque_fragment>", `
vec2 screenUv = gl_FragCoord.xy / transmissionSamplerSize;
vec2 bend = vBackdropCap > 0.5 ? vec2(vNormal.x * 14.0, vNormal.z * 8.0)
  : vec2(vNormal.x * 24.0, 0.0);
vec3 backdrop = texture2D(transmissionSamplerMap,
  clamp(screenUv + bend / transmissionSamplerSize, vec2(0.001), vec2(0.999))).rgb * 1.32;
gl_FragColor = vec4(backdrop, 1.0);`);
  };
  material.customProgramCacheKey = () => "tube-water-backdrop-v1";
  return { material, up, level };
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
  options: { activeSurface?: boolean; pour?: boolean } = {}) {
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
  if (hasLiquid) volume.geometry = wallGeometry;

  const group = new THREE.Group();
  group.name = "TubeReactionVisuals";
  group.position.copy(volume.position);
  group.quaternion.copy(volume.quaternion);
  group.scale.copy(volume.scale);
  volume.parent?.add(group);
  const backdrop = options.activeSurface && hasLiquid ? createWaterBackdropMaterial(radius) : null;
  const backdropWall = backdrop ? new THREE.Mesh(wallGeometry, backdrop.material) : null;
  const backdropCap = backdrop ? new THREE.Mesh(capGeometry, backdrop.material) : null;
  if (backdropWall && backdropCap) {
    backdropWall.name = "TubeRefractedBackdrop";
    backdropCap.name = "TubeRefractedSurface";
    backdropWall.visible = false;
    backdropCap.visible = false;
    backdropCap.frustumCulled = false;
    backdropWall.raycast = backdropCap.raycast = () => {};
    group.add(backdropWall, backdropCap);
  }
  const cap = new THREE.Mesh(capGeometry, baseline);
  cap.name = "TubeLiquidSurface";
  cap.visible = hasLiquid;
  cap.frustumCulled = false;
  cap.raycast = () => {};
  group.add(cap);
  const bottomCausticGeometry = new THREE.PlaneGeometry(radius * 1.7, radius * 1.7);
  const standCausticGeometry = new THREE.PlaneGeometry(radius * 2.5, 0.105);
  bottomCausticGeometry.rotateX(-Math.PI / 2);
  const bottomCausticMaterial = createCausticMaterial();
  const standCausticMaterial = createCausticMaterial();
  standCausticMaterial.uniforms.uBillboard.value = 1;
  const bottomCaustic = new THREE.Mesh(bottomCausticGeometry, bottomCausticMaterial);
  const standCaustic = new THREE.Mesh(standCausticGeometry, standCausticMaterial);
  bottomCaustic.name = "TubeBottomCaustic";
  standCaustic.name = "TubeStandCaustic";
  bottomCaustic.position.set(center.x, box.min.y + radius * 0.34, center.z);
  standCaustic.position.set(center.x, box.min.y - 0.055, center.z);
  bottomCaustic.raycast = standCaustic.raycast = () => {};
  group.add(bottomCaustic, standCaustic);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const white = new THREE.MeshStandardMaterial({ color: "#c9c7c2", roughness: 1, envMapIntensity: 0.15 });
  white.onBeforeCompile = (shader) => {
    shader.uniforms.uSedimentWhite = { value: kind === "barium-sulfate" ? 0.92 : 0.96 };
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
float powderGrain = sin(vSedimentPoint.x * 12000.0) * sin(vSedimentPoint.z * 10800.0) * 0.012 * uPowder;
outgoingLight = vec3(uSedimentWhite) * (relief + powderGrain);
#include <opaque_fragment>`);
  };
  // Lobed, asymmetric AgCl flocs cast their own small shading variations.
  const curdGeometry = new THREE.IcosahedronGeometry(1, 2);
  const vertices = curdGeometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const lump = 0.8 + 0.18 * Math.sin(x * 11 + y * 7) * Math.cos(z * 12 - y * 5) + 0.12 * Math.sin(z * 7 + x * 5);
    vertices.setXYZ(i, x * lump, y * lump * 0.75, z * lump);
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
      uOpacity: { value: 0 }, uTime: { value: 0 }, uLip: { value: lip.y } },
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
uniform float uLip;
varying vec2 vP; varying float vGasHeight;
void main() {
  if (vGasHeight < uLip - 0.0005) discard;
  float rise = clamp((vP.y + 1.0) * 0.5, 0.0, 1.0);
  float flow = sin(uTime * 0.28 + rise * 2.8) * 0.025 * rise * rise;
  float width = mix(0.52, 0.63, smoothstep(0.0, 1.0, rise));
  float edge = 1.0 - smoothstep(width * 0.45, width, abs(vP.x - flow));
  float top = 1.0 - smoothstep(0.3, 1.0, rise);
  gl_FragColor = vec4(uColor, uOpacity * edge * top);
  #include <colorspace_fragment>
}`,
  });
  // The liquid mesh is inset from the glass; gas must reach the actual bore.
  const headGeometry = new THREE.CylinderGeometry(headRadius, headRadius, lip.y - box.min.y, 32, 1, true);
  headGeometry.translate(center.x, (lip.y + box.min.y) / 2, center.z);
  const headMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false,
    uniforms: { uUp: up, uLevel: level, uDensity: { value: 0 }, uFront: { value: 0 }, uMouth: { value: 0 }, uResidue: { value: 0 }, uTime: { value: 0 }, uDetail: { value: 1 },
      uLip: { value: lip.y }, uRadius: { value: headRadius }, uColor: { value: new THREE.Color(TUBE_VISUALS.gasColor) } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vEye;
void main() { vP = position; vN = normalize(normalMatrix * normal);
vec4 mv = modelViewMatrix * vec4(position, 1.0); vEye = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uUp; uniform float uLevel; uniform float uDensity; uniform float uFront; uniform float uMouth; uniform float uResidue; uniform float uTime; uniform float uDetail;
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
if (aboveWater < 0.0) discard;
float h = clamp(aboveWater / max(uLip - uLevel, 0.005), 0.0, 1.0);
float motion = 1.0 + 0.10 * sin(h * 2.4 - uTime * 0.3);
if (uDetail > 0.5) {
  vec3 q = vec3(vP.x / uRadius * 1.1, vP.y / uRadius * 0.35 - uTime * 0.13,
    vP.z / uRadius * 1.1);
  float cloud = gasNoise(q) * 0.7 + gasNoise(q * 0.9 + vec3(4.7, 0.0, 1.9)) * 0.3;
  motion = clamp(1.0 + (cloud - 0.5) * 1.25, 0.72, 1.28);
}
motion = mix(motion, 1.0, smoothstep(0.78, 1.0, h));
float heightDensity = mix(1.0, 0.62, smoothstep(0.05, 0.95, h));
float facing = abs(dot(normalize(vN), normalize(vEye)));
float edgeFade = smoothstep(0.0, 0.3, facing);
float wallBand = (0.55 + 0.55 * pow(1.0 - facing, 0.55))
  * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.34, 0.72, h));
float lowerFade = smoothstep(-0.012, 0.03, h);
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
  const attachedBubbles = makePool(bubbleMaterial);
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
  bedMaterial.onBeforeCompile = (shader, renderer) => {
    white.onBeforeCompile(shader, renderer);
    shader.uniforms.uSedimentLevel = sedimentLevel;
    shader.uniforms.uSedimentUp = up;
    shader.vertexShader = `uniform float uSedimentLevel; uniform vec3 uSedimentUp;
uniform float uSedimentBottom; uniform float uSedimentRadius; uniform vec3 uSedimentCenter;
${shader.vertexShader}`.replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
if (position.y > uSedimentLevel) objectNormal = uSedimentUp;`).replace("#include <begin_vertex>", `#include <begin_vertex>
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
  let gasDensity = 0;
  let gasFront = 0;
  let mouthFill = 0;
  let wallResidue = 0;
  let bubblePhase = 0;
  let surfaceActivity = 0;
  let residueAge = 0;
  let residueAtStop = 0;
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
    update(chemistry: TubeChemistry, time: number, quality: RuntimeQuality, splashAge: number,
      refraction = false) {
      const { progress } = chemistry;
      const rate = Number.isFinite(chemistry.rate) ? THREE.MathUtils.clamp(chemistry.rate, 0, 1) : 0;
      const temperature = Number.isFinite(chemistry.temperature) ? THREE.MathUtils.clamp(chemistry.temperature, 0, 1) : 0;
      const p = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
      const reverseTime = lastTime !== undefined && time < lastTime;
      const dt = lastTime === undefined ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, 0.1);
      lastTime = time;
      waveSurface?.setQuality(quality);
      volume.updateWorldMatrix(true, false);
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
      level.value = up.value.x * center.x + up.value.y * box.max.y + up.value.z * center.z;
      if (backdrop && backdropWall && backdropCap) {
        backdrop.up.value.copy(up.value);
        backdrop.level.value = level.value;
        backdropWall.visible = backdropCap.visible = refraction && quality !== "LOW";
      }
      inverse.copy(volume.matrixWorld).invert();
      gravity.set(0, 1, 0).transformDirection(inverse);
      // A visual reservoir outlives the instantaneous chemical rate. Seeking
      // backwards resets it; wall residue clears over several minutes.
      if (reverseTime) {
        gasDensity = 0; gasFront = 0; mouthFill = 0; wallResidue = 0; bubblePhase = 0; surfaceActivity = 0;
        residueAge = 0; residueAtStop = 0; bubbleStopAge = Infinity; wasProducingBubbles = false;
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
      bubblePhase += dt * (0.3 + rate * 0.4);
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
      gasDensity = THREE.MathUtils.clamp(gasDensity + dt * (drive / TUBE_VISUALS.gasBuildSeconds - gasDensity / TUBE_VISUALS.gasDecaySeconds), 0, 1);
      gasFront = THREE.MathUtils.clamp(gasFront + dt * drive / 3, 0, 1);
      const mouthTarget = drive > 0.005 ? THREE.MathUtils.smoothstep(gasFront, 0.84, 1) : 0;
      mouthFill = THREE.MathUtils.lerp(mouthFill, mouthTarget, 1 - Math.exp(-dt * 1.5));
      const targetActivity = producingBubbles ? Math.sqrt(drive) : 0;
      surfaceActivity = producingBubbles
        ? THREE.MathUtils.lerp(surfaceActivity, targetActivity, 1 - Math.exp(-dt * 7)) : 0;
      if (drive > 0.005) {
        wallResidue = Math.min(1, wallResidue + dt * drive / TUBE_VISUALS.gasBuildSeconds);
        residueAtStop = wallResidue;
        residueAge = 0;
      } else {
        residueAge += dt;
        wallResidue = residueAtStop * (1 - THREE.MathUtils.smoothstep(residueAge, 180, TUBE_VISUALS.gasResidueSeconds));
      }
      const count = TUBE_VISUALS.particleCounts[quality];
      const precipitate = kind === "silver-chloride" || kind === "barium-sulfate";
      const curds = kind === "silver-chloride";
      const onset = THREE.MathUtils.smoothstep(p, 0, curds ? 0.012 : 0.004);
      const settled = precipitate ? THREE.MathUtils.smoothstep(p,
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
      }
      if (liquid) {
        liquid.uniforms.uTime.value = time;
        liquid.uniforms.uReactionProgress.value = p;
        liquid.uniforms.uReactionKind.value = kind === "copper-nitric" ? 1 : curds ? 2 : kind === "barium-sulfate" ? 3 : 4;
        liquid.uniforms.uCloudiness.value = curds ? onset * (1 - settled)
          : kind === "barium-sulfate" ? onset : 0;
        liquid.uniforms.uResidualHaze.value = kind === "barium-sulfate"
          ? 0.65 * THREE.MathUtils.smoothstep(p, 0.90, 1)
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
        mesh.visible = hasLiquid && quality !== "LOW";
        material.uniforms.uTint.value.set(causticTint);
        material.uniforms.uStrength.value = causticStrength * scale;
        material.uniforms.uWave.value = surfaceActivity;
        material.uniforms.uTime.value = time;
      }
      bed.visible = precipitate && settled > 0;
      sedimentLevel.value = box.min.y + size.y * (curds ? settled * 0.155 : Math.sqrt(settled) * 0.10);
      flakes.visible = curds && p > 0;
      flakes.count = count;
      bubbles.visible = producingBubbles || bubbleStopAge < 1.8 && releasedBubbles.length > 0;
      bubbles.count = producingBubbles ? Math.min(count, Math.floor(count * Math.sqrt(rate))) : releasedBubbles.length;
      attachedBubbles.visible = producingBubbles && surfaceActivity > 0.02
        || bubbleStopAge < 1.8 && releasedAttached.length > 0;
      attachedBubbles.count = producingBubbles
        ? Math.min(72, Math.floor((quality === "LOW" ? 24 : quality === "MEDIUM" ? 32 : quality === "HIGH" ? 42 : 50) * surfaceActivity))
        : releasedAttached.length;
      gas.visible = gasDensity > 0.008 && mouthFill > 0.005;
      headspace.visible = gasDensity > 0.008 || wallResidue > 0.008;
      gas.count = 1;
      gasMaterial.uniforms.uOpacity.value = (1 - Math.exp(-gasDensity * 1.55 * 0.62)) * mouthFill;
      gasMaterial.uniforms.uTime.value = time;
      headMaterial.uniforms.uDensity.value = gasDensity;
      headMaterial.uniforms.uFront.value = gasFront;
      headMaterial.uniforms.uMouth.value = mouthFill;
      headMaterial.uniforms.uResidue.value = Math.pow(wallResidue, 0.85) * (1 - gasDensity);
      headMaterial.uniforms.uTime.value = time;
      headMaterial.uniforms.uDetail.value = quality === "LOW" ? 0 : 1;
      condensate.visible = kind === "copper-nitric" && temperature > 0.6;
      condensate.count = Math.floor(count / 3);
      dropletMaterial.opacity = 0.15 + temperature * 0.25;
      if (copper) {
        const shrink = Math.cbrt(Math.max(0, 1 - p));
        copper.children.forEach((child, i) => {
          const etch = THREE.MathUtils.smoothstep(p * (0.8 + random(i + 150) * 0.38), 0.02, 0.9);
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.color.set("#d58b68").lerp(new THREE.Color("#59463f"), etch * 0.9);
            child.material.roughness = THREE.MathUtils.lerp(0.27, 0.84, etch);
            child.material.metalness = THREE.MathUtils.lerp(0.96, 0.42, etch);
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
          const elevation = -0.06 + 1.03 * ((i + 0.5) / 50);
          const radial = Math.sqrt(Math.max(0, 1 - elevation * elevation));
          const angle = i * 2.399963;
          const cycle = (bubblePhase * (0.42 + rate * 0.42) + random(i + 307)) % 1;
          const growth = THREE.MathUtils.smoothstep(cycle, 0.02, 0.77);
          const release = 1 - THREE.MathUtils.smoothstep(cycle, 0.78, 1);
          const sizeBubble = radius * (0.05 + 0.08 * growth) * release * copperGrain.scale.x;
          source.set(Math.cos(angle) * radial, elevation, Math.sin(angle) * radial)
            .multiplyScalar(grainBound * 1.03).add(copperGrain.position);
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
      foam.visible = kind === "copper-nitric" && rate > 0.55;
      foam.count = Math.floor(count / 4);
      foamMaterial.opacity = 0.16 + rate * 0.3;
      const activeCount = Math.max(flakes.visible ? count : 0, bubbles.visible ? bubbles.count : 0,
        gas.visible ? gas.count : 0, condensate.visible ? condensate.count : 0, splash.visible ? splash.count : 0,
        foam.visible ? foam.count : 0);
      for (let i = 0; i < activeCount; i++) {
        const angle = random(i + 1) * Math.PI * 2;
        const radial = radius * 0.64 * Math.sqrt(random(i + 93));
        const x = center.x + Math.cos(angle) * radial;
        const z = center.z + Math.sin(angle) * radial;
        const grain = radius * (curds ? (0.34 + random(i + 31) * 0.13) * (0.45 + settled * 0.55) : 0.06);
        const floor = box.min.y + size.y * (curds ? 0.10 + random(i + 14) * (TUBE_VISUALS.curdLayerHeight - 0.13) : 0.07 + random(i + 14) * 0.025);
        const drift = Math.sin(time * 0.75 + i * 2.4) * radius * 0.07 * (1 - settled);
        const ingress = curds ? THREE.MathUtils.smoothstep(p * 80, 1 - random(i + 71) - 0.1, 1 - random(i + 71) + 0.1) : 1;
        if (flakes.visible) place(flakes, i, x + drift - gravity.x * radius * settled * 0.6, THREE.MathUtils.lerp(box.min.y + size.y * (0.12 + random(i + 71) * 0.78), floor - gravity.z * z, settled), z - gravity.z * radius * settled * 0.6,
          grain * onset * ingress, grain * onset * ingress * (curds ? 1.5 : 0.65), grain * onset * ingress);
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
          const rise = (bubblePhase * (0.7 + random(site + 180) * 0.35)
            + (rate > 0.1 ? chain * 0.23 : random(i + 42))) % 1;
          const grainMesh = copper?.children[site % Math.max(1, copper.children.length)];
          if (grainMesh instanceof THREE.Mesh && p < 0.999) {
            const azimuth = site * 2.39996;
            source.set(Math.cos(azimuth), 0.36 + random(site + 201) * 0.35, Math.sin(azimuth))
              .normalize().multiplyScalar(copperBounds[site % copperBounds.length] * 0.84).multiply(grainMesh.scale)
              .applyQuaternion(grainMesh.quaternion).add(grainMesh.position);
          }
          else source.set(x * 0.6, box.min.y + radius * 1.3, z * 0.6);
          const distance = Math.max(0, (level.value - up.value.dot(source)) / Math.max(0.3, up.value.dot(gravity)));
          const travel = rise * rise * (1.25 - rise * 0.25);
          bubblePoint.copy(source).addScaledVector(gravity, travel * distance);
          bubblePoint.x += Math.sin(time * 3 + site * 1.7 + rise * 8) * radius * 0.055 * rise;
          bubblePoint.z += Math.cos(time * 2.4 + site * 2.1 + rise * 7) * radius * 0.045 * rise;
          // A rising bubble hits the wall and slides along it, never exits sideways.
          const radialDistance = Math.hypot(bubblePoint.x, bubblePoint.z);
          if (radialDistance > radius * 0.84) { bubblePoint.x *= radius * 0.84 / radialDistance; bubblePoint.z *= radius * 0.84 / radialDistance; }
          const coldGate = rate > 0.05 || (time + random(i + 14) * 5) % 4 < 1.5;
          const bubbleSize = coldGate ? radius * (0.095 + Math.pow(random(i + 241), 2) * 0.21) : 0;
          if (waveSurface && producingBubbles && bubbleSize > 0 && previousBubbleRise[i] >= 0
              && (rise > 0.97 && previousBubbleRise[i] <= 0.97
                || rise < previousBubbleRise[i] && previousBubbleRise[i] > 0.9)) {
            waveSurface.impulse((bubblePoint.x - center.x) / radius,
              (bubblePoint.z - center.z) / radius, radius * (0.018 + rate * 0.018), 0.20);
          }
          previousBubbleRise[i] = rise;
          place(bubbles, i, bubblePoint.x, bubblePoint.y, bubblePoint.z, bubbleSize, bubbleSize * (bubbleSize > radius * 0.1 ? 0.82 : 1), bubbleSize);
        }
        if (gas.visible && i < gas.count) {
          place(gas, i, lip.x + gravity.x * radius * 2.4,
            lip.y + gravity.y * radius * 2.4, lip.z + gravity.z * radius * 2.4,
            radius * 2.4, radius * 2.4, radius * 2.4);
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
        if (foam.visible && i < foam.count) {
          const localX = center.x + Math.cos(angle) * radius * (0.52 + 0.32 * random(i + 54));
          const localZ = center.z + Math.sin(angle) * radius * (0.52 + 0.32 * random(i + 54));
          const localY = (level.value - up.value.x * localX - up.value.z * localZ) / Math.max(up.value.y, 0.3);
          const pulse = 0.72 + 0.28 * Math.sin(time * 3.1 + i * 2.3);
          place(foam, i, localX, localY + 0.0002, localZ, radius * (0.04 + random(i + 73) * 0.05) * pulse);
        }
      }
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
      group.removeFromParent();
      deferDispose(group, () => {
        geometry.dispose(); foamGeometry.dispose(); foamMaterial.dispose();
        wallGeometry.dispose(); capGeometry.dispose(); headGeometry.dispose(); headMaterial.dispose(); dropletMaterial.dispose(); splashMaterial.dispose();
        gasGeometry.dispose(); bedMaterial.dispose(); bottomCausticGeometry.dispose(); standCausticGeometry.dispose();
        bottomCausticMaterial.dispose(); standCausticMaterial.dispose();
        curdGeometry.dispose();
        white.dispose(); bubbleMaterial.dispose(); gasMaterial.dispose(); liquid?.dispose(); backdrop?.material.dispose();
        for (const mesh of [flakes, bubbles, attachedBubbles, gas, splash, condensate, foam]) mesh.dispose();
      });
    },
  };
}
