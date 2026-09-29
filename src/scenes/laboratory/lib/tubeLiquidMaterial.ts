import * as THREE from "three";
import { LiquidMaterial, type LiquidOptions } from "./reagentMaterials";

export const TUBE_LIQUID = { clearAlpha: 0.10, edgeAlpha: 0.42, meniscusAlpha: 0.12, clearHighlight: 0.25 };

/** Tube-only optics: no framebuffer copy or change to the reagent bottles. */
export class TubeLiquidMaterial extends LiquidMaterial {
  constructor(geometry: THREE.BufferGeometry, options: LiquidOptions) {
    super(geometry, options);
    this.name = "TubeLiquidContents";
    this.roughness = 0.13;
    this.side = THREE.FrontSide;
    Object.assign(this.uniforms, {
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uLevel: { value: this.uniforms.uBoundsMin.value.y + this.uniforms.uBoundsSize.value.y },
      uReactionKind: { value: 0 }, uRate: { value: 0 }, uTemperature: { value: 0 },
      uResidualHaze: { value: 0 }, uWallFilm: { value: 0 },
    });
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.uniforms.uClearAlpha = { value: TUBE_LIQUID.clearAlpha };
      shader.uniforms.uEdgeAlpha = { value: TUBE_LIQUID.edgeAlpha };
      shader.uniforms.uMeniscusAlpha = { value: TUBE_LIQUID.meniscusAlpha };
      shader.uniforms.uClearHighlight = { value: TUBE_LIQUID.clearHighlight };
      shader.vertexShader = `attribute float tubeSurface; attribute float tubeWave; attribute float tubeWaveSlope;
uniform vec3 uUp; uniform float uLevel;
uniform vec3 uBoundsMin; uniform vec3 uBoundsSize;
varying vec3 vTubePoint; varying float vCap; varying float vTubeWaveSlope;
${shader.vertexShader}`.replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
vTubeWaveSlope = tubeSurface > 0.5 ? tubeWaveSlope : 0.0;
if (tubeSurface > 0.5) objectNormal = normalize(uUp + vec3(normal.x, 0.0, normal.z));`).replace("#include <begin_vertex>", `#include <begin_vertex>
vCap = tubeSurface;
if (tubeSurface > 0.5) {
  transformed.y = (uLevel - dot(uUp.xz, position.xz)) / max(uUp.y, 0.2);
  // A shallow wetting rim rises along the glass without outlining the disk.
  float radial = length((position.xz - uBoundsMin.xz - uBoundsSize.xz * 0.5) / (uBoundsSize.xz * 0.5));
  transformed.y += 0.0008 * pow(clamp((radial - 0.67) / 0.33, 0.0, 1.0), 2.0);
  transformed.y += tubeWave;
}
vTubePoint = transformed;`);
      shader.fragmentShader = `uniform vec3 uBaseColor; uniform vec3 uReactionColor;
uniform float uReactionProgress; uniform float uCloudiness; uniform float uOpacity;
uniform float uClearAlpha; uniform float uEdgeAlpha; uniform float uMeniscusAlpha; uniform float uClearHighlight;
uniform vec3 uUp; uniform float uLevel; uniform vec3 uBoundsMin; uniform vec3 uBoundsSize;
uniform float uReactionKind; uniform float uRate; uniform float uTemperature; uniform float uTime;
uniform float uResidualHaze; uniform float uWallFilm;
varying vec3 vTubePoint; varying float vCap; varying float vTubeWaveSlope;
float tubeNoise(vec3 p) {
  vec3 i = floor(p), f = smoothstep(0.0, 1.0, fract(p));
  float n = dot(i, vec3(1.0, 57.0, 113.0));
  vec4 a = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
  vec4 b = fract(sin(vec4(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
  return mix(mix(mix(a.x, a.y, f.x), mix(a.z, a.w, f.x), f.y),
    mix(mix(b.x, b.y, f.x), mix(b.z, b.w, f.x), f.y), f.z);
}
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
float surfaceDistance = dot(uUp, vTubePoint) - uLevel;
if (vCap < 0.5 && surfaceDistance > 0.0004) discard;`)
        .replace("#include <color_fragment>", `#include <color_fragment>
float h = clamp((vTubePoint.y - uBoundsMin.y) / uBoundsSize.y, 0.0, 1.0);
vec2 radial = (vTubePoint.xz - uBoundsMin.xz - uBoundsSize.xz * 0.5) / uBoundsSize.xz;
float p = uReactionProgress;
float n = tubeNoise(vec3(radial * 10.0, h * 6.0 - uTime * (0.14 + uTemperature * 0.24)));
float stream = sin(radial.x * 16.0 + sin(h * 10.0 - uTime * (0.7 + uTemperature)) + radial.y * 9.0)
  + (n - 0.5) * 0.8;
float localMix = p;
float cloud = uCloudiness;
if (uReactionKind > 0.5 && uReactionKind < 1.5) {
  // Cu2+ travels out from the metal; convection carries narrow blue fingers upward.
  float front = p * 1.65 + stream * 0.12 * sin(p * 3.14159);
  localMix = smoothstep(h - 0.22, h + 0.22, front) * min(1.0, p * 3.0);
  localMix = mix(localMix, 1.0, smoothstep(0.7, 1.0, p));
} else if (uReactionKind > 1.5 && uReactionKind < 2.5) {
  // The initial milk fills the tube. Later, flocs clear the supernatant
  // from the top down, with only soft turbulence at the boundary.
  float clearing = smoothstep(0.32, 0.82, p);
  float clearFront = smoothstep(1.0 - clearing - 0.08, 1.0 - clearing + 0.08, h);
  cloud *= 1.0 - clearFront;
  cloud *= 0.90 + 0.16 * n;
} else if (uReactionKind > 2.5 && uReactionKind < 3.5) {
  // Fine BaSO4 stays evenly milky longer; its clearing front descends slowly.
  float clearing = smoothstep(0.42, 0.98, p);
  float clearFront = smoothstep(1.0 - clearing - 0.055, 1.0 - clearing + 0.055, h);
  cloud *= 1.0 - clearFront;
  cloud *= 0.97 + 0.06 * n;
} else if (uReactionKind > 3.5) {
  // Sulfite enters at the top; retain violet below the moving mixing front.
  localMix = smoothstep(1.0 - h - 0.18, 1.0 - h + 0.18,
    p * 1.36 - 0.18 + stream * 0.12 * sin(p * 3.14159));
}
if (p <= 0.0) { localMix = 0.0; cloud = 0.0; }
cloud = clamp(cloud + uResidualHaze, 0.0, 1.0);
vec3 tubeColor = mix(uBaseColor, uReactionColor, localMix);
float baseChroma = max(max(uBaseColor.r, uBaseColor.g), uBaseColor.b) - min(min(uBaseColor.r, uBaseColor.g), uBaseColor.b);
float endChroma = max(max(uReactionColor.r, uReactionColor.g), uReactionColor.b) - min(min(uReactionColor.r, uReactionColor.g), uReactionColor.b);
float pigment = mix(smoothstep(0.15, 0.3, baseChroma), smoothstep(0.15, 0.3, endChroma), localMix);
diffuseColor.rgb = tubeColor;
float waterEdge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.4);
float meniscus = (1.0 - smoothstep(0.0003, 0.0015, abs(surfaceDistance))) * (1.0 - vCap);
float waterAlpha = uClearAlpha + waterEdge * uEdgeAlpha + meniscus * uMeniscusAlpha;
waterAlpha += smoothstep(0.6, 0.9, uTemperature) * (n - 0.5) * 0.07;
float milk = uReactionKind > 2.5 && uReactionKind < 3.5 ? 1.0 : 0.0;
float raspberry = uReactionKind > 3.5 ? 1.0 - localMix : 0.0;
// A stationary chalky veil. No animated or high-frequency patch mask: only
// the filtered film amount changes, so the wall cannot develop crawling marks.
float film = uWallFilm * (1.0 - smoothstep(0.28, 0.54, h))
  * 0.45;
diffuseColor.a = clamp(waterAlpha + pigment * (0.05 + 0.70 * uOpacity * uOpacity)
  + cloud * mix(1.25, 0.72, milk) + raspberry * 0.28 + film * 0.60
  + vCap * clamp(abs(vTubeWaveSlope) * 10.0, 0.0, 1.0) * 0.55, 0.0, 0.995);`)
        .replace("#include <opaque_fragment>", `
float edgeSoft = vCap > 0.5 ? max(0.10, clamp(abs(vTubeWaveSlope) * 8.0, 0.0, 1.0))
  : smoothstep(0.0, 0.009, -surfaceDistance);
diffuseColor.a *= edgeSoft;
vec3 boundedSpecular = totalSpecular / (vec3(1.0) + totalSpecular);
vec3 clearLight = mix(vec3(0.25, 0.37, 0.40), vec3(0.035, 0.10, 0.13), waterEdge) + boundedSpecular * uClearHighlight;
// Neutral scattering keeps a white precipitate white next to the warm burner.
float relief = 0.7 + 0.2 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.3))));
vec3 coloredLight = tubeColor * (0.68 + relief * 0.42) * mix(1.0, 0.72, waterEdge) + boundedSpecular * 0.26;
coloredLight += vec3(0.08, 0.13, 0.15) * (n - 0.5) * smoothstep(0.6, 0.95, uTemperature);
coloredLight = mix(coloredLight,
  tubeColor * vec3(1.45, 1.15, 1.25) * mix(1.0, 0.72, waterEdge) + boundedSpecular * 0.10,
  raspberry);
outgoingLight = mix(mix(clearLight, coloredLight, pigment),
  mix(vec3(0.91 + 0.07 * relief), vec3(0.80 + 0.06 * relief), milk),
  clamp(cloud * mix(1.0, 0.88, milk), 0.0, 1.0));
outgoingLight = mix(outgoingLight, vec3(0.93), film * 0.80);
float waveBright = vCap * clamp(vTubeWaveSlope * 10.0, 0.0, 1.0);
float waveDark = vCap * clamp(-vTubeWaveSlope * 10.0, 0.0, 1.0);
outgoingLight = mix(outgoingLight, vec3(0.90, 0.97, 1.0), waveBright * 0.85);
outgoingLight *= 1.0 - waveDark * 0.55;
#include <opaque_fragment>`);
    };
  }
  customProgramCacheKey() { return "tube-liquid-water-color-v9-waves"; }
}
