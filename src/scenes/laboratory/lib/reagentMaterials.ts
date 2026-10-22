import * as THREE from "three";
import { createCopperPile } from "./createCopperPile";
import type { ReagentContainerConfig } from "../../../entities/laboratory/reagents";

export const GLASS_DEFAULTS = {
  transparency: 0.94, roughness: 0.035, fresnelStrength: 0.68,
  fresnelPower: 3.0, edgeTint: "#c5dce5", amberAbsorption: 0.65,
};

// Both materials retain the renderer's lighting, shadows, environment, fog,
// tone mapping and clipping. No new textures or render passes are needed.
// Alpha compositing is intentional: native transmission cannot sample the
// transparent ContentsVolume from its opaque-scene buffer.
function normalizedBounds(geometry: THREE.BufferGeometry) {
  const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
  const size = box.getSize(new THREE.Vector3());
  size.set(Math.max(size.x, 1e-6), Math.max(size.y, 1e-6), Math.max(size.z, 1e-6));
  return { uBoundsMin: { value: box.min }, uBoundsSize: { value: size } };
}

/** The hollow asset has two walls. Alpha glass shades only the exterior;
 * otherwise the far inner wall adds a second silhouette and a milky layer.
 * Classify whole triangles in object space, never by camera-facing halves.
 * Keep the exterior bottom and lip, but omit the upward-facing cavity floor.
 */
export function createExteriorGlassGeometry(source: THREE.BufferGeometry) {
  const geometry = source.clone();
  const position = source.getAttribute("position");
  const bounds = normalizedBounds(source);
  const center = bounds.uBoundsMin.value.clone().addScaledVector(bounds.uBoundsSize.value, 0.5);
  const floorLimit = bounds.uBoundsMin.value.y + bounds.uBoundsSize.value.y * 0.13;
  const indices: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const normal = new THREE.Vector3(), radial = new THREE.Vector3();
  const count = source.index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    const ia = source.index?.getX(i) ?? i;
    const ib = source.index?.getX(i + 1) ?? i + 1;
    const ic = source.index?.getX(i + 2) ?? i + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    radial.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
    radial.y = 0;
    normal.crossVectors(b.sub(a), c.sub(a)).normalize();
    const inward = normal.dot(radial) < -1e-7;
    const innerFloor = a.y < floorLimit && normal.y > 0.5;
    if (!inward && !innerFloor) indices.push(ia, ib, ic);
  }
  geometry.setIndex(indices);
  geometry.clearGroups();
  return geometry;
}

type Shader = Parameters<THREE.MeshPhysicalMaterial["onBeforeCompile"]>[0];
function addCoordinates(shader: Shader) {
  shader.vertexShader = `uniform vec3 uBoundsMin;
uniform vec3 uBoundsSize;
varying vec3 vReagentPosition;
varying vec3 vReagentWorldPosition;
varying float vReagentTop;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vReagentPosition = (position - uBoundsMin) / uBoundsSize;
vReagentWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
vReagentTop = max(normal.y, 0.0);
`);
  shader.fragmentShader = `varying vec3 vReagentPosition;
varying vec3 vReagentWorldPosition;
varying float vReagentTop;
${shader.fragmentShader}`;
}

export class GlassMaterial extends THREE.MeshPhysicalMaterial {
  readonly uniforms;
  readonly variant: "clear" | "amber";

  constructor(geometry: THREE.BufferGeometry, variant: "clear" | "amber", options: Partial<typeof GLASS_DEFAULTS> = {}) {
    const p = { ...GLASS_DEFAULTS, ...options };
    super({ color: "white", roughness: p.roughness, metalness: 0, ior: 1.47,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
      envMapIntensity: 1.05 });
    this.name = `ReagentGlass:${variant}`;
    this.variant = variant;
    this.uniforms = {
      ...normalizedBounds(geometry),
      uTransparency: { value: p.transparency },
      uFresnelStrength: { value: p.fresnelStrength },
      uFresnelPower: { value: p.fresnelPower },
      uEdgeTint: { value: new THREE.Color(p.edgeTint) },
      uAbsorption: { value: variant === "amber" ? p.amberAbsorption : 0.025 },
      uAbsorptionColor: { value: new THREE.Color("#d9e9ef") },
      uAmber: { value: variant === "amber" ? 1 : 0 },
      uDenseLiquid: { value: 0 }, uClearLiquid: { value: 0 }, uLiquidLevel: { value: 0 },
      uLiquidWorldY: { value: 0 },
    };
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      addCoordinates(shader);
      shader.fragmentShader = `uniform float uTransparency;
uniform float uFresnelStrength;
uniform float uFresnelPower;
uniform vec3 uEdgeTint;
uniform float uAbsorption;
uniform vec3 uAbsorptionColor;
uniform float uAmber;
uniform float uDenseLiquid; uniform float uClearLiquid; uniform float uLiquidLevel; uniform float uLiquidWorldY;
${shader.fragmentShader}`.replace("#include <opaque_fragment>", `
float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), uFresnelPower);
float height = clamp(vReagentPosition.y, 0.0, 1.0);
float heavyGlass = 1.0 - smoothstep(0.0, 0.13, height);
heavyGlass += smoothstep(0.78, 1.0, height) * 0.55;
float opticalDepth = mix(0.18, 0.7, uAmber) + edge * 1.4 + heavyGlass * 0.65;
vec3 extinction = mix(vec3(1.0) - uAbsorptionColor, vec3(0.32, 0.9, 3.2), uAmber);
vec3 absorption = exp(-extinction * uAbsorption * opticalDepth * 3.0);
float reflectionWeight = clamp(0.035 + edge * uFresnelStrength, 0.0, 0.85);
// Concentrate contrast at grazing angles so overlapping vessels retain
// separate silhouettes without adding haze through the center of the glass.
float silhouette = smoothstep(0.35, 0.95, edge);
diffuseColor.a = clamp((1.0 - uTransparency) + reflectionWeight +
  silhouette * 0.12 + heavyGlass * 0.035 +
  (1.0 - min(min(absorption.r, absorption.g), absorption.b)) * 0.48, 0.025, 0.88);
diffuseColor.a = max(diffuseColor.a, uAmber * (1.0 - uTransparency * 0.48));
outgoingLight = absorption * totalDiffuse * mix(0.08, 0.6, uAmber) +
  totalSpecular * mix(vec3(1.0), uEdgeTint, edge) *
  (0.7 + edge * uFresnelStrength) / max(diffuseColor.a, 0.08);
outgoingLight += uEdgeTint * totalDiffuse * edge * 0.12 * (1.0 - uAmber);
float denseRegion = uDenseLiquid * (1.0 - smoothstep(uLiquidWorldY - 0.0015,
  uLiquidWorldY + 0.0015, vReagentWorldPosition.y));
float wetRegion = uClearLiquid * (1.0 - smoothstep(uLiquidWorldY - 0.0012,
  uLiquidWorldY + 0.0012, vReagentWorldPosition.y));
outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.76, 0.91, 0.94)
  + vec3(0.012, 0.027, 0.032), wetRegion * 0.65);
diffuseColor.a = clamp(diffuseColor.a + wetRegion * (0.12 + edge * 0.12), 0.0, 0.96);
// Amber is still visible above the meniscus, but cannot glow orange over a
// near-black permanganate column or overpower the label shoulder.
outgoingLight = mix(outgoingLight,
  vec3(0.11, 0.048, 0.018) + min(totalSpecular, vec3(0.16)) * 0.12,
  uDenseLiquid * (1.0 - denseRegion) * 0.94);
outgoingLight = mix(outgoingLight, vec3(0.025, 0.003, 0.043) +
  min(totalSpecular, vec3(0.22)) * vec3(0.22, 0.11, 0.30), denseRegion * 0.96);
diffuseColor.a = max(diffuseColor.a, denseRegion * 0.94);
#include <opaque_fragment>`);
    };
  }

  customProgramCacheKey() { return "reagent-glass-v17-deep-amber"; }
}

export interface LiquidOptions {
  color: string;
  opacity: number;
  reactionColor?: string;
  reactionMix?: number;
  cloudiness?: number;
  turbulenceStrength?: number;
  emissionStrength?: number;
  topHighlight?: number;
}

export class LiquidMaterial extends THREE.MeshPhysicalMaterial {
  readonly uniforms!: Record<string, THREE.IUniform>;

  constructor(geometry: THREE.BufferGeometry, options: LiquidOptions) {
    const bounds = normalizedBounds(geometry);
    const uniforms = {
      ...bounds,
      uBaseColor: { value: new THREE.Color(options.color) },
      uReactionColor: { value: new THREE.Color(options.reactionColor ?? options.color) },
      uReactionProgress: { value: options.reactionMix ?? 0 },
      uCloudiness: { value: options.cloudiness ?? 0 },
      uTurbulence: { value: options.turbulenceStrength ?? 0.015 },
      uTime: { value: 0 }, uOpacity: { value: options.opacity },
      uEmissionStrength: { value: options.emissionStrength ?? 0 },
      uTopHighlight: { value: options.topHighlight ?? 0.12 },
      uSloshX: { value: 0 }, uSloshZ: { value: 0 },
      uSloshStrength: { value: 0 }, uFillLevel: { value: 1 },
      uDepthStrength: { value: 0.45 }, uFresnelStrength: { value: 0.28 },
      uFresnelPower: { value: 3.2 }, uDistortionStrength: { value: 0.012 },
      uQualityNoise: { value: 1 },
      // Normalized cavity coordinates, independent of bottle dimensions.
      uReactionOrigin: { value: new THREE.Vector3(0.5, 0.15, 0.5) },
      uReactionRadius: { value: 0.5 },
      uMixingStrength: { value: 0.35 },
    };
    super({ name: "ReagentLiquid", color: "white", roughness: 0.12, metalness: 0,
      ior: 1.333, transparent: true, depthWrite: false, side: THREE.FrontSide });
    // Extend physical shading so all scene lights and shadows affect the liquid.
    this.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `
uniform vec3 uBoundsMin; uniform vec3 uBoundsSize;
uniform float uSloshX; uniform float uSloshZ; uniform float uSloshStrength;
uniform float uFillLevel; uniform float uTime; uniform float uQualityNoise;
 varying vec3 vLocal; varying float vHeight;
${shader.vertexShader}`.replace("#include <begin_vertex>", `
#include <begin_vertex>
  vLocal = (position - uBoundsMin) / uBoundsSize;
   vHeight = vLocal.y;
  vec2 centered = position.xz - (uBoundsMin.xz + uBoundsSize.xz * 0.5);
  vec2 slope = clamp(vec2(uSloshX, uSloshZ), vec2(-0.22), vec2(0.22));
  float wave = sin(dot(centered, vec2(28.0, 21.0)) - uTime * (2.0 + uQualityNoise));
  float amount = clamp(uSloshStrength, 0.0, 1.0);
  float displacement = (dot(slope, centered) + wave * 0.0015 * amount);
  // Anchor the bottom and keep even shallow fills above the cavity floor.
  vec3 p = position;
  p.y = max(uBoundsMin.y, p.y + displacement * clamp(vLocal.y, 0.0, 1.0));
transformed = p;`);
      shader.fragmentShader = `
uniform vec3 uBaseColor; uniform vec3 uReactionColor; uniform float uReactionProgress;
uniform float uCloudiness; uniform float uTime; uniform float uOpacity; uniform float uEmissionStrength;
uniform float uTopHighlight; uniform float uSloshStrength; uniform float uDepthStrength;
uniform float uFresnelStrength; uniform float uFresnelPower; uniform float uDistortionStrength;
uniform float uQualityNoise; uniform float uFillLevel; uniform vec3 uReactionOrigin;
uniform float uReactionRadius; uniform float uMixingStrength;
 varying vec3 vLocal; varying float vHeight;
${shader.fragmentShader}`.replace("#include <emissivemap_fragment>", `
 #include <emissivemap_fragment>
  float liquidNoise = sin(vLocal.x * 17.0 + uTime * 0.25) * sin(vLocal.z * 13.0 - uTime * 0.19) * uQualityNoise;
  float progress = clamp(uReactionProgress + liquidNoise * uMixingStrength * 0.05, 0.0, 1.0);
  vec3 c = mix(uBaseColor, uReactionColor, progress);
  float brightest = max(max(c.r, c.g), c.b);
  float chroma = brightest - min(min(c.r, c.g), c.b);
  float clearLiquid = (1.0 - smoothstep(0.08, 0.3, chroma)) *
    smoothstep(0.55, 0.85, brightest) * (1.0 - clamp(uCloudiness, 0.0, 1.0));
  // Pure water gets a restrained cyan tint so its volume reads against a
  // pale background while remaining visibly transparent.
  c = mix(c, vec3(0.52, 0.78, 0.86), clearLiquid * 0.28);
  float depth = 1.0 - clamp(vHeight, 0.0, 1.0);
  c *= 1.0 - depth * uDepthStrength * 0.35;
  float fresnel = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), uFresnelPower) * uFresnelStrength;
  // Fill is applied through mesh scale; the top stays at normalized height 1.
  float surface = exp(-abs(vHeight - 1.0) * 70.0);
  float alpha = clamp(uOpacity * (0.55 + depth * 0.18) + fresnel * 0.22 + surface * (0.18 + uTopHighlight), 0.04, 0.98);
  float clearAlpha = clamp(uOpacity * (0.42 + depth * 0.20) + fresnel * 0.42 +
    surface * (0.16 + uTopHighlight * 0.5), 0.08, 0.82);
  alpha = mix(alpha, clearAlpha, clearLiquid);
  c = mix(c, vec3(0.8), clamp(uCloudiness, 0.0, 1.0) * 0.35);
diffuseColor = vec4(c, alpha);
totalEmissiveRadiance += c * uEmissionStrength;`)
        .replace("#include <opaque_fragment>", `
// Clear water scatters little diffuse light. Keep the background visible
// and restrain reflected ceiling lights instead of lighting a white volume.
vec3 waterSpecular = totalSpecular / (vec3(1.0) + totalSpecular) * 0.4;
outgoingLight = totalDiffuse * mix(1.0, 0.32, clearLiquid) +
  mix(totalSpecular, waterSpecular, clearLiquid) + totalEmissiveRadiance;
#include <opaque_fragment>`);
    };
    this.uniforms = uniforms;
  }

  customProgramCacheKey() { return "reagent-liquid-v8-visible-clear-water"; }
}

/** Bottle-only surface and absorption. TubeLiquidMaterial continues to use the base shader. */
export class BottleLiquidMaterial extends LiquidMaterial {
  constructor(geometry: THREE.BufferGeometry, options: LiquidOptions, denseDye: boolean) {
    super(geometry, options);
    this.name = "BottleLiquidContents";
    this.uniforms.uBottleDye = { value: denseDye ? 1 : 0 };
    this.uniforms.uBottleLevel = { value: 1 };
    const compileBase = this.onBeforeCompile;
    this.onBeforeCompile = shader => {
      compileBase(shader, {} as THREE.WebGLRenderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `uniform float uBottleLevel;\n${shader.vertexShader}`.replace("transformed = p;", `
  // Move the authored top cap and its side rim onto one world-horizontal plane.
  // Full-height geometry lets the high side of a tilted bottle remain filled.
  vec3 worldY = vec3(modelMatrix[0].y, modelMatrix[1].y, modelMatrix[2].y);
  vec2 fromAxis = position.xz - uBoundsMin.xz - uBoundsSize.xz * 0.5;
  float levelY = uBoundsMin.y + uBoundsSize.y * uBottleLevel;
  float tiltedY = clamp(levelY - dot(worldY.xz, fromAxis) / max(worldY.y, 0.0001),
    uBoundsMin.y + 0.0001, uBoundsMin.y + uBoundsSize.y);
  transformed = vec3(position.x, mix(uBoundsMin.y, tiltedY, clamp(vHeight, 0.0, 1.0)), position.z);`);
      shader.fragmentShader = `uniform float uBottleDye;
${shader.fragmentShader}`.replace("totalEmissiveRadiance += c * uEmissionStrength;", `
  // A top cap gives the level an ellipse; the wall rim gives it a meniscus.
  float top = smoothstep(0.985, 0.999, vHeight);
  float wall = smoothstep(0.17, 0.44, length(vLocal.xz - vec2(0.5)));
  float rim = top * wall;
  float column = 1.0 - clamp(vHeight, 0.0, 1.0);
  if (uBottleDye > 0.5) {
    // Strong permanganate absorption: violet at thin edges, near-black core.
    c = mix(vec3(0.055, 0.008, 0.075), vec3(0.16, 0.025, 0.23), top * 0.65 + (1.0 - wall) * 0.18);
    alpha = clamp(0.86 + column * 0.11 + rim * 0.08, 0.0, 0.995);
  } else {
    alpha = clamp(0.20 + column * 0.10 + rim * 0.24 + top * 0.09 + fresnel * 0.48,
      0.0, 0.72);
    c = mix(c, vec3(0.39, 0.67, 0.75), column * 0.12);
  }
  diffuseColor = vec4(c, alpha);
  totalEmissiveRadiance += c * uEmissionStrength;`)
        .replace("#include <opaque_fragment>", `
  float cap = smoothstep(0.985, 0.999, vHeight);
  float meniscus = cap * smoothstep(0.17, 0.44, length(vLocal.xz - vec2(0.5)));
  outgoingLight = mix(outgoingLight, outgoingLight * 0.40 + vec3(0.12, 0.20, 0.22), meniscus * 0.56);
  outgoingLight += cap * (1.0 - meniscus) * vec3(0.065, 0.11, 0.13);
  if (uBottleDye > 0.5) {
    outgoingLight = mix(vec3(0.016, 0.001, 0.028), vec3(0.13, 0.016, 0.18), cap * 0.78)
      + min(totalSpecular, vec3(0.16)) * 0.09;
    diffuseColor.a = 0.995;
  }
  #include <opaque_fragment>`);
    };
  }

  customProgramCacheKey() { return "bottle-liquid-v5-dense-permanganate"; }
}

/** Solve the mean height of a tilted cylindrical column, including floor/lip clipping. */
export function conservedBottleLevel(fill: number, slopeX: number, slopeZ: number,
  radiusX: number, radiusZ: number, height: number) {
  if (Math.abs(slopeX * radiusX) + Math.abs(slopeZ * radiusZ) < height * 0.005) return fill;
  let low = -height, high = height * 2;
  for (let iteration = 0; iteration < 12; iteration++) {
    const center = (low + high) * 0.5;
    let mean = 0;
    for (let ring = 0; ring < 8; ring++) {
      const r = Math.sqrt((ring + 0.5) / 8);
      for (let sector = 0; sector < 16; sector++) {
        const angle = (sector + 0.5) * Math.PI / 8;
        const level = center - slopeX * radiusX * r * Math.cos(angle)
          - slopeZ * radiusZ * r * Math.sin(angle);
        mean += THREE.MathUtils.clamp(level, 0, height);
      }
    }
    if (mean / (128 * height) < fill) low = center; else high = center;
  }
  return (low + high) * 0.5 / height;
}

export interface ReagentMaterialBinding {
  reagentId: string;
  glass: GlassMaterial[];
  liquid: LiquidMaterial | null;
  copper?: { shake: (tilt: number, strength: number, time: number) => void };
  setFillLevel: (level: number) => void;
  getFillLevel: () => number;
  updateSurface: () => void;
  dispose: () => void;
}

/** Install materials and owned geometry on cloned meshes; never mutate the GLTF. */
export function installReagentMaterials(root: THREE.Object3D, config: ReagentContainerConfig): ReagentMaterialBinding {
  const glass: GlassMaterial[] = [];
  const owned: THREE.Material[] = [];
  const ownedGeometries: THREE.BufferGeometry[] = [];
  let liquid: LiquidMaterial | null = null;
  let fillMesh: THREE.Mesh | null = null;
  let bottom = 0;
  let initialY = 0;
  let initialScale = 1;
  let initialScaleX = 1;
  let initialScaleZ = 1;
  let copper: ReturnType<typeof createCopperPile> | undefined;
  let copperSource: THREE.Mesh | undefined;
  let currentFill = config.fillLevel;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (/^Cap(?:\.?\d+)?$/.test(object.name)) {
      const cap = new THREE.MeshStandardMaterial({
        name: "ReagentCapMattePlastic",
        color: "#bcbcb7", roughness: 0.62, metalness: 0,
        envMapIntensity: 0.45,
      });
      object.material = cap;
      owned.push(cap);
      return;
    }
    if (/^(Bottle_Glass|Jar_Glass)/.test(object.name)) {
      const cleanGeometry = createExteriorGlassGeometry(object.geometry);
      object.geometry = cleanGeometry;
      ownedGeometries.push(cleanGeometry);
      const material = new GlassMaterial(cleanGeometry, config.containerType === "amber250" ? "amber" : "clear", config.glass);
      object.material = material;
      object.castShadow = false;
      // Contents first, then the nearest glass shell in front of it.
      object.renderOrder = 3;
      glass.push(material);
      owned.push(material);
    } else if (object.name.startsWith("ContentsVolume")) {
      fillMesh = object;
      bottom = normalizedBounds(object.geometry).uBoundsMin.value.y;
      initialY = object.position.y;
      initialScale = object.scale.y;
      initialScaleX = object.scale.x;
      initialScaleZ = object.scale.z;
      if (config.id === "cu" && config.contentsKind === "solid" && config.containerType === "wide120") {
        copper = createCopperPile(object.geometry);
        copper.pile.position.copy(object.position);
        copper.pile.quaternion.copy(object.quaternion);
        copper.pile.scale.copy(object.scale);
        copperSource = object;
        object.visible = false;
        fillMesh = null;
      } else if (config.contentsKind === "solid") {
        const solid = new THREE.MeshStandardMaterial({ color: config.contentsColor,
          roughness: 0.43, metalness: 0.65, opacity: config.contentsOpacity });
        object.material = solid;
        owned.push(solid);
    } else {
        // ReagentContainers.glb puts ContentsVolume at Y=0.0015, inside
        // the solid glass base. These are the asset's inner floor heights
        // in the parent frame (metres). Keep the authored top unchanged.
        const innerFloor = config.containerType === "wide120" ? 0.0045 : 0.005;
        const bounds = normalizedBounds(object.geometry);
        const height = bounds.uBoundsSize.value.y;
        const authoredTop = initialY + (bottom + height) * initialScale;
        const floor = Math.max(initialY + bottom * initialScale, innerFloor + 0.0001);
        initialScale = (authoredTop - floor) / height;
        initialY = floor - bottom * initialScale;
        // Keep the authored lower cap so the liquid remains visible when the
        // bottle is tilted and viewed from underneath.
        const cleanGeometry = object.geometry.clone();
        object.geometry = cleanGeometry;
        ownedGeometries.push(cleanGeometry);
        liquid = new BottleLiquidMaterial(cleanGeometry, { color: config.contentsColor,
          opacity: config.contentsOpacity, ...config.liquid }, config.id === "kmno4");
        object.material = liquid;
        // The shipped closed cavity has outward-facing triangles (including
        // both caps). Cull the far surface so its triangulated cap cannot
        // blend over the visible bottom when the vessel is viewed from below.
        object.visible = true;
        object.castShadow = false;
        object.receiveShadow = true;
        object.renderOrder = 2;
        owned.push(liquid);
      }
    }
  });
  // Add after traversal; preserve the hidden cavity as the asset reference.
  if (copper && copperSource) copperSource.parent?.add(copper.pile);
  const setFillLevel = (level: number) => {
    if (!fillMesh || !Number.isFinite(level)) return;
    const fill = THREE.MathUtils.clamp(level, 0, 1);
    currentFill = fill;
    if (liquid) {
      liquid.uniforms.uFillLevel.value = fill;
      liquid.uniforms.uBottleLevel.value = fill;
    }
    if (liquid) for (const material of glass) {
      material.uniforms.uDenseLiquid.value = config.id === "kmno4" ? 1 : 0;
      material.uniforms.uClearLiquid.value = config.id === "kmno4" ? 0 : 1;
      material.uniforms.uLiquidLevel.value = 0.12 + fill * 0.66;
    }
    fillMesh.visible = fill > 0;
    fillMesh.scale.x = initialScaleX * 1.015;
    fillMesh.scale.z = initialScaleZ * 1.015;
    fillMesh.scale.y = initialScale;
    fillMesh.position.y = initialY;
  };
  setFillLevel(config.fillLevel);
  const updateSurface = () => {
    if (!(liquid instanceof BottleLiquidMaterial) || !fillMesh) return;
    fillMesh.updateWorldMatrix(true, false);
    const e = fillMesh.matrixWorld.elements;
    const sy = Math.abs(e[5]) < 1e-5 ? 1e-5 : e[5];
    const size = liquid.uniforms.uBoundsSize.value as THREE.Vector3;
    liquid.uniforms.uBottleLevel.value = conservedBottleLevel(
      liquid.uniforms.uFillLevel.value, e[1] / sy, e[9] / sy,
      size.x * 0.5, size.z * 0.5, size.y);
    const topY = (liquid.uniforms.uBoundsMin.value as THREE.Vector3).y
      + size.y * liquid.uniforms.uBottleLevel.value;
    const worldY = fillMesh.localToWorld(new THREE.Vector3(0, topY, 0)).y;
    for (const material of glass) material.uniforms.uLiquidWorldY.value = worldY;
  };
  const binding = { reagentId: config.id, glass, liquid, copper: copper ? { shake: copper.shake } : undefined,
    setFillLevel, getFillLevel: () => currentFill, updateSurface, dispose: () => {
    owned.forEach((material) => material.dispose());
    ownedGeometries.forEach((geometry) => geometry.dispose());
    copper?.dispose();
  } };
  root.userData.reagentMaterials = binding;
  return binding;
}
