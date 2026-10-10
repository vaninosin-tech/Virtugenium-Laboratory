import * as THREE from "three";
import { copperFieldGLSL } from "./tubeAbsorptionMaterial";

/** Shared optical path for solids and bubbles rendered after the liquid. */
export class TubeImmersion {
  readonly uniforms = {
    uImmersionWorldToLocal: { value: new THREE.Matrix4() },
    uImmersionCamera: { value: new THREE.Vector3(0, 0, 1) },
    uImmersionCenter: { value: new THREE.Vector3() },
    uImmersionRadius: { value: 0.007 },
    uImmersionBottom: { value: 0 },
    uImmersionHeight: { value: 0.055 },
    uImmersionUp: { value: new THREE.Vector3(0, 1, 0) },
    uImmersionLevel: { value: 0 },
    uImmersionKind: { value: 0 },
    uImmersionProgress: { value: 0 },
    uImmersionRate: { value: 0 },
    uImmersionTime: { value: 0 },
    uCuPrevious: { value: null as THREE.Data3DTexture | null },
    uCuCurrent: { value: null as THREE.Data3DTexture | null },
    uCuBlend: { value: 0 },
    uCuCompletion: { value: 0 },
    uCuTime: { value: 0 },
    uCuBoundsMin: { value: new THREE.Vector3() },
    uCuBoundsSize: { value: new THREE.Vector3(1, 1, 1) },
    uImmersionDye: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat) },
    uImmersionDyeActive: { value: 0 },
  };
  private readonly emptyDye = this.uniforms.uImmersionDye.value;

  constructor(center: THREE.Vector3, radius: number, bottom: number, height: number) {
    this.uniforms.uImmersionCenter.value.copy(center);
    this.uniforms.uImmersionRadius.value = radius;
    this.uniforms.uImmersionBottom.value = bottom;
    this.uniforms.uImmersionHeight.value = height;
    this.uniforms.uImmersionDye.value.needsUpdate = true;
  }

  attach(material: THREE.Material, copperSurface = false) {
    (material as THREE.Material & { glslVersion: string }).glslVersion = THREE.GLSL3;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.uniforms.uImmersionCopperSurface = { value: copperSurface ? 1 : 0 };
      shader.vertexShader = `uniform mat4 uImmersionWorldToLocal;
varying vec3 vImmersionPoint;
${shader.vertexShader}`.replace("#include <project_vertex>", `
vec4 immersionWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
immersionWorld = instanceMatrix * immersionWorld;
#endif
vImmersionPoint = (uImmersionWorldToLocal * modelMatrix * immersionWorld).xyz;
#include <project_vertex>`);
      shader.fragmentShader = `out vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
varying vec3 vImmersionPoint;
uniform vec3 uImmersionCamera, uImmersionCenter, uImmersionUp;
uniform float uImmersionRadius, uImmersionBottom, uImmersionHeight, uImmersionLevel;
uniform float uImmersionKind, uImmersionProgress, uImmersionDyeActive;
uniform float uImmersionRate, uImmersionTime;
uniform float uImmersionCopperSurface;
uniform sampler2D uImmersionDye;
${copperFieldGLSL}
vec3 tubeTransmission() {
  vec3 p = vImmersionPoint;
  float depth = uImmersionLevel - dot(uImmersionUp, p);
  if (depth <= 0.0 || uImmersionKind < 0.5) return vec3(1.0);
  vec3 ray = normalize(uImmersionCamera - p);
  vec2 offset = p.xz - uImmersionCenter.xz;
  float a = max(dot(ray.xz, ray.xz), 0.000001);
  float b = dot(offset, ray.xz);
  float side = (-b + sqrt(max(0.0, b * b + a *
    (uImmersionRadius * uImmersionRadius - dot(offset, offset))))) / a;
  float surface = dot(uImmersionUp, ray) > 0.00001
    ? depth / dot(uImmersionUp, ray) : 1e6;
  float path = clamp(min(side, surface), 0.0, uImmersionHeight * 2.0);
  vec3 absorption = vec3(0.0);
  if (uImmersionKind < 1.5) {
    for (int i = 0; i < 8; i++) {
      vec3 q = p + ray * path * (float(i) + 0.5) / 8.0;
      absorption += mix(vec3(1.0, 0.26, 0.008), vec3(0.95, 0.20, 0.07),
        smoothstep(0.65, 0.95, uCuCompletion)) * copperField(q) / 8.0;
    }
  } else if (uImmersionDyeActive > 0.01) {
    // Sample along the view ray: plumes in front of the object tint it.
    for (int i = 0; i < 4; i++) {
      vec3 q = p + ray * path * (float(i) + 0.5) * 0.25;
      vec2 uv = vec2(clamp(0.5 + (q.x - uImmersionCenter.x) / (2.0 * uImmersionRadius), 0.0, 1.0),
        clamp((q.y - uImmersionBottom) / uImmersionHeight, 0.0, 1.0));
      absorption += vec3(0.45, 1.25, 0.63) * texture2D(uImmersionDye, uv).r * 0.25;
    }
  }
  absorption *= mix(1.0, 0.16, uImmersionCopperSurface);
  vec3 viewLight = exp(-absorption * path / max(uImmersionRadius, 0.0001));
  vec3 topLight = exp(-absorption * depth / max(uImmersionHeight, 0.0001) * 0.38);
  return viewLight * topLight;
}
${shader.fragmentShader}`.replace("#include <opaque_fragment>", `outgoingLight *= tubeTransmission();
#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => `${previousKey.call(material)}-tube-immersion-v2-copper-plumes`;
    material.needsUpdate = true;
    return () => {
      material.onBeforeCompile = previous;
      material.customProgramCacheKey = previousKey;
      material.needsUpdate = true;
    };
  }

  dispose() { this.emptyDye.dispose(); }
}
