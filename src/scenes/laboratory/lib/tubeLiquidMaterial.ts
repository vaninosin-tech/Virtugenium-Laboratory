import * as THREE from "three";
import { LiquidMaterial, type LiquidOptions } from "./reagentMaterials";

export const TUBE_LIQUID = { clearAlpha: 0.10, edgeAlpha: 0.42, meniscusAlpha: 0.48, clearHighlight: 0.25 };

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
    });
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.uniforms.uClearAlpha = { value: TUBE_LIQUID.clearAlpha };
      shader.uniforms.uEdgeAlpha = { value: TUBE_LIQUID.edgeAlpha };
      shader.uniforms.uMeniscusAlpha = { value: TUBE_LIQUID.meniscusAlpha };
      shader.uniforms.uClearHighlight = { value: TUBE_LIQUID.clearHighlight };
      shader.vertexShader = `attribute float tubeSurface;
uniform vec3 uUp; uniform float uLevel;
uniform vec3 uBoundsMin; uniform vec3 uBoundsSize;
varying vec3 vTubePoint; varying float vCap;
${shader.vertexShader}`.replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
if (tubeSurface > 0.5) objectNormal = uUp;`).replace("#include <begin_vertex>", `#include <begin_vertex>
vCap = tubeSurface;
if (tubeSurface > 0.5) {
  transformed.y = (uLevel - dot(uUp.xz, position.xz)) / max(uUp.y, 0.2);
  // Small wetting rise at the wall, not a tilted solid disk.
  float radial = length((position.xz - uBoundsMin.xz - uBoundsSize.xz * 0.5) / (uBoundsSize.xz * 0.5));
  transformed.y += 0.00035 * pow(radial, 12.0);
}
vTubePoint = transformed;`);
      shader.fragmentShader = `uniform vec3 uBaseColor; uniform vec3 uReactionColor;
uniform float uReactionProgress; uniform float uCloudiness; uniform float uOpacity;
uniform float uClearAlpha; uniform float uEdgeAlpha; uniform float uMeniscusAlpha; uniform float uClearHighlight;
uniform vec3 uUp; uniform float uLevel; uniform vec3 uBoundsMin; uniform vec3 uBoundsSize;
uniform float uReactionKind; uniform float uRate; uniform float uTemperature; uniform float uTime;
varying vec3 vTubePoint; varying float vCap;
${shader.fragmentShader}`.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
float surfaceDistance = dot(uUp, vTubePoint) - uLevel;
if (vCap < 0.5 && surfaceDistance > 0.0004) discard;`)
        .replace("#include <color_fragment>", `#include <color_fragment>
float h = clamp((vTubePoint.y - uBoundsMin.y) / uBoundsSize.y, 0.0, 1.0);
vec2 radial = (vTubePoint.xz - uBoundsMin.xz - uBoundsSize.xz * 0.5) / uBoundsSize.xz;
float p = uReactionProgress;
float stream = sin(radial.x * 16.0 + sin(h * 10.0 - uTime * (0.7 + uTemperature)) + radial.y * 9.0);
float localMix = p;
float cloud = uCloudiness;
if (uReactionKind > 0.5 && uReactionKind < 1.5) {
  // Cu2+ travels out from the metal; convection carries narrow blue fingers upward.
  float front = p * 1.65 + stream * 0.12 * sin(p * 3.14159);
  localMix = smoothstep(h - 0.22, h + 0.22, front) * min(1.0, p * 3.0);
  localMix = mix(localMix, 1.0, smoothstep(0.7, 1.0, p));
} else if (uReactionKind > 1.5 && uReactionKind < 2.5) {
  float ingress = smoothstep(1.0 - h - 0.18, 1.0 - h + 0.18, p * 8.0 + stream * 0.09);
  float settlingFront = 1.0 - smoothstep(1.05 - p, 1.25 - p, h);
  cloud *= ingress * settlingFront;
} else if (uReactionKind > 3.5) {
  // Sulfite enters at the top; retain violet below the moving mixing front.
  localMix = smoothstep(1.0 - h - 0.18, 1.0 - h + 0.18,
    p * 1.36 - 0.18 + stream * 0.12 * sin(p * 3.14159));
}
if (p <= 0.0) { localMix = 0.0; cloud = 0.0; }
vec3 tubeColor = mix(uBaseColor, uReactionColor, localMix);
float baseChroma = max(max(uBaseColor.r, uBaseColor.g), uBaseColor.b) - min(min(uBaseColor.r, uBaseColor.g), uBaseColor.b);
float endChroma = max(max(uReactionColor.r, uReactionColor.g), uReactionColor.b) - min(min(uReactionColor.r, uReactionColor.g), uReactionColor.b);
float scatter = mix(smoothstep(0.15, 0.3, baseChroma), smoothstep(0.15, 0.3, endChroma), localMix);
diffuseColor.rgb = tubeColor;
float waterEdge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.4);
float meniscus = (1.0 - smoothstep(0.00015, 0.0007, abs(surfaceDistance))) * (1.0 - vCap);
float capRim = smoothstep(0.43, 0.50, length(radial)) * vCap;
float waterAlpha = uClearAlpha + waterEdge * uEdgeAlpha + max(meniscus, capRim) * uMeniscusAlpha;
diffuseColor.a = clamp(mix(waterAlpha, uOpacity, scatter) + cloud * 0.85, 0.0, 0.96);`)
        .replace("#include <opaque_fragment>", `
vec3 boundedSpecular = totalSpecular / (vec3(1.0) + totalSpecular);
vec3 clearLight = mix(vec3(0.25, 0.37, 0.40), vec3(0.035, 0.10, 0.13), waterEdge) + boundedSpecular * uClearHighlight;
// Neutral scattering keeps a white precipitate white next to the warm burner.
float relief = 0.7 + 0.2 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.3))));
vec3 coloredLight = tubeColor * (0.5 + relief * 0.3) * mix(1.0, 0.68, waterEdge) + boundedSpecular * 0.2;
outgoingLight = mix(mix(clearLight, coloredLight, scatter), vec3(relief * 0.78), cloud);
#include <opaque_fragment>`);
    };
  }
  customProgramCacheKey() { return "tube-liquid-gravity-fronts-v2"; }
}
