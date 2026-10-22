import * as THREE from "three";
import { LiquidMaterial, type LiquidOptions } from "./reagentMaterials";

export const TUBE_LIQUID = { clearAlpha: 0.17, edgeAlpha: 0.42, meniscusAlpha: 0.22, clearHighlight: 0.30 };
const emptyTransport = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
emptyTransport.needsUpdate = true;

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
      uTransport: { value: emptyTransport }, uTransportActive: { value: 0 },
      uTransportDye: { value: 0 }, uTransportQuality: { value: 1 },
      uTransportAge: { value: 0 },
      uCameraLocal: { value: new THREE.Vector3(0, 0, 1) },
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
uniform sampler2D uTransport; uniform float uTransportActive; uniform float uTransportDye; uniform float uTransportQuality; uniform float uTransportAge;
uniform vec3 uCameraLocal;
varying vec3 vTubePoint; varying float vCap; varying float vTubeWaveSlope;
vec2 transported(vec3 point) {
  vec3 center = uBoundsMin + uBoundsSize * 0.5;
  vec3 direction = normalize(point - uCameraLocal);
  vec2 edge = point.xz - center.xz;
  float depth = clamp(-2.0 * dot(edge, direction.xz) / max(dot(direction.xz, direction.xz), 0.0001), 0.0, uBoundsSize.x);
  float stepLength = depth / uTransportQuality;
  vec2 transmittance = vec2(1.0);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uTransportQuality) break;
    vec3 samplePoint = point + direction * ((float(i) + 0.5) * stepLength);
    vec2 across = (samplePoint.xz - center.xz) / uBoundsSize.xz;
    vec2 uv = vec2(clamp(0.5 + dot(across, vec2(0.42, 0.91)), 0.0, 1.0),
      clamp((samplePoint.y - uBoundsMin.y) / uBoundsSize.y, 0.0, 1.0));
    vec2 concentration = texture2D(uTransport, uv).rg;
    transmittance *= exp(-concentration * stepLength / max(uBoundsSize.x, 0.0001) * 3.2);
  }
  return 1.0 - transmittance;
}
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
vec2 transportedMatter = uTransportActive > 0.01
  ? transported(vTubePoint) : vec2(0.0);
float p = uReactionProgress;
float n = tubeNoise(vec3(radial * 10.0, h * 6.0 - uTime * (0.14 + uTemperature * 0.24)));
float stream = sin(radial.x * 16.0 + sin(h * 10.0 - uTime * (0.7 + uTemperature)) + radial.y * 9.0)
  + (n - 0.5) * 0.8;
float localMix = p;
float cloud = uCloudiness;
float dyeCloud = 0.0;
float dyeHalo = 0.0;
if (uReactionKind > 0.5 && uReactionKind < 1.5) {
  // Rising gas mixes Cu2+ through the entire column from the outset.
  // Keep only a soft enrichment near the granule and in the rising wake.
  float mixed = smoothstep(0.04, 0.62, p);
  float wake = exp(-pow(radial.x * 3.0 + 0.15 * stream, 2.0))
    * (1.0 - smoothstep(0.35, 0.95, h));
  localMix = mixed * (0.79 + 0.21 * (1.0 - h) + 0.035 * wake);
  localMix = mix(localMix, 1.0, smoothstep(0.72, 1.0, p));
} else if (uReactionKind > 1.5 && uReactionKind < 2.5) {
  // The initial milk fills the tube. Later, flocs clear the supernatant
  // from the top down, with only soft turbulence at the boundary.
  float clearing = smoothstep(0.55, 0.99, p);
  float clearFront = smoothstep(1.0 - clearing - 0.08, 1.0 - clearing + 0.08, h);
  cloud *= 1.0 - clearFront;
  cloud *= 0.96 + 0.08 * n;
} else if (uReactionKind > 2.5 && uReactionKind < 3.5) {
  // Fine BaSO4 stays evenly milky longer; its clearing front descends slowly.
  float clearing = smoothstep(0.42, 0.98, p);
  float liquidH = clamp((dot(uUp, vTubePoint) - uBoundsMin.y)
    / max(0.001, uLevel - uBoundsMin.y), 0.0, 1.0);
  float front = mix(1.06, -0.06, clearing);
  float clearFront = smoothstep(front - 0.055, front + 0.055, liquidH);
  cloud *= 1.0 - clearFront;
  cloud *= 0.97 + 0.06 * n;
} else if (uReactionKind > 3.5) {
  // Only the advected dye is raspberry. The reaction fades each plume
  // after it has had time to curl below the inlet.
  vec2 dyeUv = vec2(clamp((vTubePoint.x - uBoundsMin.x) / uBoundsSize.x
    + 0.045 * sin(h * 32.0 - uTime * 3.1), 0.0, 1.0), h);
  float nearDye = texture2D(uTransport, dyeUv).r;
  vec2 crossingUv = vec2(clamp(0.5 + dot(radial, vec2(-0.76, 0.65)), 0.0, 1.0), h);
  nearDye = max(nearDye, texture2D(uTransport, crossingUv).r * 0.65);
  float acrossPlume = min(texture2D(uTransport, dyeUv + vec2(0.10, 0.0)).r,
    texture2D(uTransport, dyeUv - vec2(0.10, 0.0)).r);
  float alongPlume = min(texture2D(uTransport, dyeUv + vec2(0.0, 0.028)).r,
    texture2D(uTransport, dyeUv - vec2(0.0, 0.028)).r);
  // Close small clear pockets enclosed by dye without spanning the genuinely
  // clear space between separate descending plumes.
  nearDye = max(nearDye, max(acrossPlume, alongPlume) * 0.75);
  dyeHalo = max(max(texture2D(uTransport, dyeUv + vec2(0.13, 0.0)).r,
    texture2D(uTransport, dyeUv - vec2(0.13, 0.0)).r),
    max(texture2D(uTransport, dyeUv + vec2(0.0, 0.04)).r,
      texture2D(uTransport, dyeUv - vec2(0.0, 0.04)).r));
  // Three separated descending tongues. The advected field supplies their
  // movement, while the envelope closes small clear islands inside each
  // tongue and leaves genuinely transparent channels between them.
  float liquidHeight = clamp((uLevel - uBoundsMin.y) / uBoundsSize.y, 0.08, 1.0);
  float descent = smoothstep(0.25, 2.4, uTransportAge);
  float lobeA = exp(-pow((radial.x + 0.30 + 0.045 * sin(h * 29.0 - uTime * 1.7)) / 0.19, 2.0)
    - pow((h - liquidHeight * (0.82 - 0.39 * descent)) / (liquidHeight * 0.31), 2.0));
  float lobeB = exp(-pow((radial.x - 0.015 - 0.06 * sin(h * 24.0 + uTime * 1.3)) / 0.21, 2.0)
    - pow((h - liquidHeight * (0.72 - 0.49 * descent)) / (liquidHeight * 0.37), 2.0));
  float lobeC = exp(-pow((radial.x - 0.34 + 0.045 * sin(h * 27.0 - uTime * 1.1)) / 0.18, 2.0)
    - pow((h - liquidHeight * (0.91 - 0.32 * descent)) / (liquidHeight * 0.28), 2.0));
  float tongues = pow(max(max(lobeA * 0.88, lobeB), lobeC * 0.83), 0.68)
    * smoothstep(0.15, 0.75, uTransportAge);
  float transportedDye = 1.0 - exp(-nearDye * 2.8 - transportedMatter.r * 5.0);
  dyeCloud = max(tongues, transportedDye * (0.08 + tongues * 0.76));
  // Dense permanganate that has reached the rounded bottom overlaps in depth.
  // This optical pool complements the narrow wall tongues without changing
  // the conservative transport field or the reaction's duration.
  float liquidH = h / liquidHeight;
  float dyePool = smoothstep(0.20, 1.25, uTransportAge)
    * (1.0 - smoothstep(0.44, 0.90, liquidH))
    * (1.0 - smoothstep(0.30, 0.52, abs(radial.x)));
  dyeCloud = max(dyeCloud, dyePool * 0.92);
  // A faint fringe belongs to each tongue, never a grey veil across the tube.
  dyeHalo *= smoothstep(0.08, 0.30, tongues);
  // Decolorization follows the chemistry clock. The upper, thinner layer
  // clears first; transport age only controls the shape of the descending dye.
  float dyeFade = 1.0 - smoothstep(0.08, 1.03, p + liquidH * 0.16);
  dyeCloud *= dyeFade;
  dyeHalo *= dyeFade;
  localMix = 1.0 - dyeCloud;
}
if (p <= 0.0 && uReactionKind < 3.5) { localMix = 0.0; cloud = 0.0; }
if (uReactionKind > 1.5 && uReactionKind < 2.5)
  cloud *= 0.96 + 0.04 * smoothstep(0.05, 0.40, h);
if (uReactionKind > 2.5 && uReactionKind < 3.5 && uTransportActive > 0.01)
  // The inlet only shapes the first plume. Fine precipitate disperses through
  // the entire column before the transport field itself has faded away.
  cloud *= mix(0.12 + 0.88 * smoothstep(0.015, 0.65, transportedMatter.g),
    1.0, smoothstep(0.35, 1.9, uTransportAge));
cloud = clamp(cloud + uResidualHaze, 0.0, 1.0);
vec3 reactionTint = uReactionColor;
if (uReactionKind > 0.5 && uReactionKind < 1.5)
  reactionTint = mix(vec3(0.26, 0.60, 0.58), uReactionColor, smoothstep(0.55, 1.0, p));
vec3 tubeColor = mix(uBaseColor, reactionTint, localMix);
if (uReactionKind > 3.5) {
  float opticalDensity = 1.0 - exp(-max(dyeCloud, dyeHalo * 0.25) * 3.5);
  // A thin edge transmits raspberry; the overlapping core absorbs green and
  // red light and reads nearly black violet, like concentrated KMnO4.
  tubeColor = mix(vec3(0.77, 0.90, 0.92), vec3(0.55, 0.025, 0.25),
    smoothstep(0.01, 0.38, opticalDensity));
  tubeColor = mix(tubeColor, vec3(0.025, 0.001, 0.055),
    smoothstep(0.38, 0.83, opticalDensity));
}
float baseChroma = max(max(uBaseColor.r, uBaseColor.g), uBaseColor.b) - min(min(uBaseColor.r, uBaseColor.g), uBaseColor.b);
float endChroma = max(max(uReactionColor.r, uReactionColor.g), uReactionColor.b) - min(min(uReactionColor.r, uReactionColor.g), uReactionColor.b);
float pigment = mix(smoothstep(0.15, 0.3, baseChroma), smoothstep(0.15, 0.3, endChroma), localMix);
if (uReactionKind > 0.5 && uReactionKind < 1.5) pigment = localMix;
if (uReactionKind > 3.5) pigment = max(dyeCloud, dyeHalo * 0.22);
diffuseColor.rgb = tubeColor;
float waterEdge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.4);
vec2 tracerUv = vec2(clamp((vTubePoint.x - uBoundsMin.x) / uBoundsSize.x, 0.0, 1.0), h);
float tracerRidge = uTransportActive > 0.01 && uTransportDye < 0.5
  ? abs(texture2D(uTransport, tracerUv - vec2(0.055, 0.0)).g
    - texture2D(uTransport, tracerUv + vec2(0.055, 0.0)).g) : 0.0;
float meniscus = (1.0 - smoothstep(0.0003, 0.0015, abs(surfaceDistance))) * (1.0 - vCap);
float capRadius = length((vTubePoint.xz - uBoundsMin.xz - uBoundsSize.xz * 0.5) / (uBoundsSize.xz * 0.5));
float capRim = vCap * smoothstep(0.77, 0.94, capRadius);
float waterAlpha = uClearAlpha + waterEdge * uEdgeAlpha + meniscus * uMeniscusAlpha
  + vCap * 0.12 + capRim * 0.30 + tracerRidge * 0.22;
waterAlpha += smoothstep(0.6, 0.9, uTemperature) * (n - 0.5) * 0.07;
float milk = uReactionKind > 2.5 && uReactionKind < 3.5 ? 1.0 : 0.0;
float raspberry = uReactionKind > 3.5 ? 1.0 - exp(-dyeCloud * 3.5) : 0.0;
// A stationary chalky veil. No animated or high-frequency patch mask: only
// the filtered film amount changes, so the wall cannot develop crawling marks.
float film = uWallFilm * (1.0 - smoothstep(0.28, 0.54, h))
  * 0.45;
diffuseColor.a = clamp(waterAlpha + pigment * (0.05 + 0.70 * uOpacity * uOpacity
  + (uReactionKind > 0.5 && uReactionKind < 1.5
    ? 0.48 + 0.38 * smoothstep(0.70, 1.0, p) : 0.0))
  + cloud * (uReactionKind > 1.5 && uReactionKind < 2.5 ? 1.65 : mix(1.25, 1.70, milk))
  + raspberry * 1.75 + dyeHalo * 0.12 + film * 0.60
  + vCap * clamp(abs(vTubeWaveSlope) * 10.0, 0.0, 1.0) * 0.55, 0.0, 0.995);`)
        .replace("#include <opaque_fragment>", `
float edgeSoft = vCap > 0.5 ? max(0.42, clamp(abs(vTubeWaveSlope) * 8.0, 0.0, 1.0))
  : max(0.42, smoothstep(0.0, 0.006, -surfaceDistance));
// The soft fade below the surface only hides a hard line in clear water; a
// coloured or cloudy body keeps its colour right up to the meniscus.
diffuseColor.a *= vCap > 0.5 ? edgeSoft : mix(edgeSoft, 1.0, clamp(max(pigment, cloud), 0.0, 1.0));
// Dense suspension scatters up to the surface. Coloured transparent liquid
// gets its transmitted colour in the backdrop pass, not from an opaque lid.
float surfaceTint = vCap * clamp(max(pigment, cloud), 0.0, 1.0);
diffuseColor.a = max(diffuseColor.a, vCap * cloud * 0.995);
vec3 boundedSpecular = totalSpecular / (vec3(1.0) + totalSpecular);
vec3 clearLight = mix(vec3(0.33, 0.44, 0.47), vec3(0.035, 0.10, 0.13), waterEdge) + boundedSpecular * uClearHighlight;
// Neutral scattering keeps a white precipitate white next to the warm burner.
float relief = 0.7 + 0.2 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.3))));
vec3 coloredLight = tubeColor * (0.68 + relief * 0.42) * mix(1.0, 0.72, waterEdge) + boundedSpecular * 0.26;
coloredLight += vec3(0.08, 0.13, 0.15) * (n - 0.5) * smoothstep(0.6, 0.95, uTemperature);
coloredLight = mix(coloredLight,
  tubeColor * vec3(1.32, 0.72, 1.10) * mix(1.0, 0.72, waterEdge) + boundedSpecular * 0.035,
  raspberry);
outgoingLight = mix(mix(clearLight, coloredLight, pigment),
  mix(vec3(0.91 + 0.07 * relief), vec3(0.91 + 0.04 * relief), milk),
  clamp(cloud, 0.0, 1.0));
outgoingLight = mix(outgoingLight, mix(coloredLight, vec3(0.83 + 0.06 * relief), milk),
  surfaceTint * (1.0 - cloud) * 0.72);
outgoingLight = mix(outgoingLight, vec3(0.93), film * 0.80);
outgoingLight = mix(outgoingLight, vec3(0.85, 0.97, 1.0), tracerRidge * 0.32);
// Surface lines and ripple sheen keep the hue of a coloured or cloudy body:
// a lighter or darker shade of it, never the clear-water cyan over it.
float tinted = clamp(max(pigment, cloud), 0.0, 1.0);
vec3 body = outgoingLight;
float underRim = (1.0 - vCap) * (1.0 - smoothstep(0.0005, 0.0017, -surfaceDistance));
outgoingLight = mix(outgoingLight, mix(vec3(0.10, 0.19, 0.22), body * 0.45, tinted),
  underRim * 0.63 * (1.0 - milk * cloud * 0.9));
outgoingLight = mix(outgoingLight, mix(vec3(0.82, 0.95, 0.98), body + (vec3(1.0) - body) * 0.35, tinted),
  capRim * 0.68);
float waveBright = vCap * clamp(vTubeWaveSlope * 10.0, 0.0, 1.0);
float waveDark = vCap * clamp(-vTubeWaveSlope * 10.0, 0.0, 1.0);
outgoingLight = mix(outgoingLight, mix(vec3(0.90, 0.97, 1.0), body + (vec3(1.0) - body) * 0.30, tinted),
  waveBright * 0.85);
outgoingLight *= 1.0 - waveDark * mix(0.55, 0.25, tinted);
// Permanganate absorbs green strongly even under the bright bench lights.
// Override the neutral water lighting only where a dense tongue is present.
outgoingLight = mix(outgoingLight,
  mix(vec3(0.56, 0.012, 0.27), vec3(0.018, 0.001, 0.038), smoothstep(0.35, 0.82, raspberry))
    + boundedSpecular * 0.015,
  smoothstep(0.04, 0.75, raspberry));
#include <opaque_fragment>
if (uReactionKind > 3.5) {
  float denseDye = smoothstep(0.003, 0.055, dyeCloud);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.025, 0.001, 0.055), denseDye);
  gl_FragColor.a = max(gl_FragColor.a, smoothstep(0.001, 0.035, dyeCloud) * 0.995);
}
if (uReactionKind > 1.5 && uReactionKind < 2.5) {
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.91, 0.94, 0.95), cloud * 0.74);
  gl_FragColor.a = max(gl_FragColor.a, cloud * 0.94);
}
// BaSO4 suspension is an opaque milk on reference footage (exp3-*): the
// background must not show through while the column is still cloudy.
if (uReactionKind > 2.5 && uReactionKind < 3.5) {
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.90), cloud * 0.70);
  gl_FragColor.a = max(gl_FragColor.a, cloud * 0.94);
}`);
    };
  }
  customProgramCacheKey() { return "tube-liquid-water-color-v21-dense-permanganate"; }
}
