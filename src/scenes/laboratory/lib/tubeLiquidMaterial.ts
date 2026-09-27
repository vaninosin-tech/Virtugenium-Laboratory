import * as THREE from "three";
import { LiquidMaterial, type LiquidOptions } from "./reagentMaterials";

export const TUBE_LIQUID = { clearAlpha: 0.035, meniscusAlpha: 0.16, clearHighlight: 0.12 };

/** One optical response before mixing and during reactions prevents frame-zero jumps. */
export class TubeLiquidMaterial extends LiquidMaterial {
  constructor(geometry: THREE.BufferGeometry, options: LiquidOptions) {
    super(geometry, options);
    this.name = "TubeLiquidContents";
    this.roughness = 0.15;
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.uniforms.uClearAlpha = { value: TUBE_LIQUID.clearAlpha };
      shader.uniforms.uMeniscusAlpha = { value: TUBE_LIQUID.meniscusAlpha };
      shader.uniforms.uClearHighlight = { value: TUBE_LIQUID.clearHighlight };
      shader.vertexShader = `uniform vec3 uBoundsMin; uniform vec3 uBoundsSize;
varying float vTubeLiquidHeight;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vTubeLiquidHeight = (position.y - uBoundsMin.y) / uBoundsSize.y;`);
      shader.fragmentShader = `uniform vec3 uBaseColor; uniform vec3 uReactionColor;
uniform float uReactionProgress; uniform float uCloudiness; uniform float uOpacity;
uniform float uClearAlpha; uniform float uMeniscusAlpha; uniform float uClearHighlight;
varying float vTubeLiquidHeight;
${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
vec3 tubeColor = mix(uBaseColor, uReactionColor, uReactionProgress);
float baseChroma = max(max(uBaseColor.r, uBaseColor.g), uBaseColor.b) - min(min(uBaseColor.r, uBaseColor.g), uBaseColor.b);
float endChroma = max(max(uReactionColor.r, uReactionColor.g), uReactionColor.b) - min(min(uReactionColor.r, uReactionColor.g), uReactionColor.b);
// Interpolate concentration, not a threshold on the already mixed colour:
// the latter made permanganate lose nearly all opacity halfway through.
float scatter = max(mix(smoothstep(0.15, 0.3, baseChroma), smoothstep(0.15, 0.3, endChroma), uReactionProgress), uCloudiness);
float meniscus = smoothstep(0.99, 1.0, vTubeLiquidHeight);
diffuseColor.rgb = tubeColor;
diffuseColor.a = mix(uClearAlpha + meniscus * uMeniscusAlpha, uOpacity, scatter);`)
        .replace("#include <opaque_fragment>", `
// A colourless liquid transmits the background; diffuse flame illumination
// must not turn its entire volume into a luminous white column.
vec3 boundedSpecular = totalSpecular / (vec3(1.0) + totalSpecular);
vec3 clearLight = boundedSpecular * uClearHighlight;
vec3 scatteringLight = totalDiffuse / (1.0 + max(max(totalDiffuse.r, totalDiffuse.g), totalDiffuse.b) * 0.3) + boundedSpecular * 0.3;
outgoingLight = mix(clearLight, scatteringLight, scatter);
#include <opaque_fragment>`);
    };
  }
  customProgramCacheKey() { return "tube-liquid-transparency-v1"; }
}
