import * as THREE from "three";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";

export function copperTextureBounds(radius: number, bottom: number, height: number) {
  return { min: new THREE.Vector3(-radius, bottom, -radius),
    size: new THREE.Vector3(2 * radius, height, 2 * radius) };
}

export function copperTextureUVW(point: THREE.Vector3, radius: number, bottom: number, height: number) {
  const { min, size } = copperTextureBounds(radius, bottom, height);
  return point.clone().sub(min).divide(size);
}

export function cameraInTubeSpace(camera: THREE.Camera, tube: THREE.Object3D,
  inverse: THREE.Matrix4, world: THREE.Vector3, result: THREE.Vector3) {
  inverse.copy(tube.matrixWorld).invert();
  camera.getWorldPosition(world);
  return result.copy(world).applyMatrix4(inverse);
}

export const copperFieldGLSL = `
uniform sampler3D uCuPrevious, uCuCurrent;
uniform float uCuBlend, uCuCompletion, uCuTime, uCuMeanDensity, uCuSurfaceDensity;
uniform vec3 uCuBoundsMin, uCuBoundsSize;
float copperField(vec3 p) {
  vec3 uvw = (p - uCuBoundsMin) / uCuBoundsSize;
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
  float density = mix(texture(uCuPrevious, uvw).r, texture(uCuCurrent, uvw).r, uCuBlend);
  float c = max(0.0, density);
  // The conserved mean colours the bulk separately. Only real local excess
  // contributes to the plume, so a uniformly blue field cannot paint one.
  // A sublinear response preserves visible differences before transmission
  // approaches zero in an already coloured solution.
  return 18.0 * pow(max(c - uCuMeanDensity, 0.0), 0.9);
}`;

export const permanganateTongueGLSL = `
float permanganateTongue(sampler2D field, vec2 uv, float age) {
  return texture(field, clamp(uv, vec2(0.0), vec2(1.0))).r;
}`;

/** Sub-voxel folds only change where the remaining MnO4- field is sampled. */
export const permanganateVolumeGLSL = `
uniform sampler3D uMnField;
float permanganateVolume(vec3 p) {
  vec3 uvw = (p - uCuBoundsMin) / uCuBoundsSize;
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
  float centre = texture(uMnField, uvw).r;
  float adjacent = texture(uMnField, clamp(uvw + vec3(0.05, 0.025, -0.04), 0.0, 1.0)).r;
  float edge = smoothstep(0.012, 0.20, abs(centre - adjacent));
  vec3 fold = vec3(
    0.05 * sin(uvw.y * 23.0 + uvw.z * 13.0 + uCuTime * 1.6),
    0.012 * sin(uvw.x * 19.0 - uvw.z * 16.0 + uCuTime * 1.1),
    0.05 * cos(uvw.y * 27.0 - uvw.x * 12.0 - uCuTime * 1.3));
  return max(0.0, texture(uMnField, clamp(uvw + fold * edge, 0.0, 1.0)).r);
}`;

/** Multiplies the scene by transmitted light through the liquid volume. */
export class TubeAbsorptionMaterial extends THREE.ShaderMaterial {
  constructor(radius: number, bottom: number, height: number) {
    const bounds = copperTextureBounds(radius, bottom, height);
    super({
      name: "TubeAbsorption", glslVersion: THREE.GLSL3,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) }, uLevel: { value: bottom + height },
        uCameraLocal: { value: new THREE.Vector3() }, uKind: { value: 0 }, uProgress: { value: 0 },
        uCuPrevious: { value: null as THREE.Data3DTexture | null },
        uCuCurrent: { value: null as THREE.Data3DTexture | null }, uCuBlend: { value: 0 },
        uMnField: { value: null as THREE.Data3DTexture | null },
        uCuCompletion: { value: 0 },
        uCuMeanDensity: { value: 0 }, uCuSurfaceDensity: { value: 0 },
        uCuTime: { value: 0 },
        uCuBoundsMin: { value: bounds.min },
        uCuBoundsSize: { value: bounds.size },
        uCuSpheres: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
        uCuCount: { value: 0 }, uSteps: { value: TUBE_SIMULATION.render.raySteps },
        uTransport: { value: null as THREE.Texture | null }, uTransportAge: { value: 0 },
        uIncomingDyed: { value: 0 },
      },
      vertexShader: `in float tubeSurface; in float tubeWave;
uniform vec3 uUp; uniform float uLevel; out vec3 vPoint; out float vCap;
void main() {
  vec3 p = position; vCap = tubeSurface;
  if (tubeSurface > 0.5) {
    p.y = (uLevel - dot(uUp.xz, position.xz)) / max(uUp.y, 0.2);
    p.y += 0.0008 * pow(clamp((length(position.xz) / ${radius.toFixed(7)} - 0.67) / 0.33, 0.0, 1.0), 2.0) + tubeWave;
  }
  vPoint = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: `uniform vec3 uUp, uCameraLocal;
uniform float uLevel, uKind, uProgress, uTransportAge, uIncomingDyed, uSteps;
uniform sampler2D uTransport; uniform vec4 uCuSpheres[8]; uniform int uCuCount;
in vec3 vPoint; in float vCap; out vec4 outColor;
${copperFieldGLSL}
${permanganateTongueGLSL}
${permanganateVolumeGLSL}
void main() {
  float radius = ${radius.toFixed(7)}, bottom = ${bottom.toFixed(7)}, height = ${height.toFixed(7)};
  float surface = dot(uUp, vPoint) - uLevel;
  if (vCap < 0.5 && surface > 0.0004) discard;
  vec3 ray = normalize(vPoint - uCameraLocal);
  float a = max(dot(ray.xz, ray.xz), 0.000001), b = dot(vPoint.xz, ray.xz);
  float root = sqrt(max(0.0, b * b + a * (radius * radius - dot(vPoint.xz, vPoint.xz))));
  float distance = max(0.0, (-b + root) / a);
  if (ray.y < -0.00001) distance = min(distance, max(0.0, (bottom - vPoint.y) / ray.y));
  float upRay = dot(uUp, ray);
  if (upRay > 0.00001) distance = min(distance, max(0.0, -surface / upRay));
  distance = min(distance, height * 2.0);
  if (uKind < 1.5) for (int k = 0; k < 8; k++) {
    if (k >= uCuCount) break;
    vec3 delta = vPoint - uCuSpheres[k].xyz;
    float bb = dot(delta, ray);
    float determinant = bb * bb - dot(delta, delta) + uCuSpheres[k].w * uCuSpheres[k].w;
    if (determinant > 0.0) {
      float hit = -bb - sqrt(determinant);
      if (hit > 0.0) distance = min(distance, hit);
    }
  }
  vec3 opticalDepth = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uSteps) break;
    vec3 q = vPoint + ray * distance * (float(i) + 0.5) / uSteps;
    float h = q.y - bottom;
    float wall = h < radius ? radius * radius - (h - radius) * (h - radius) : radius * radius;
    if (h < 0.0 || h > height || dot(q.xz, q.xz) > wall || dot(uUp, q) > uLevel) continue;
    if (uKind < 1.5) {
      float frontWeight = 2.3 * exp(-2.0 * (float(i) + 0.5) / uSteps);
      float bulk = 0.45 * pow(max(uCuMeanDensity, 0.0), 0.68);
      float plume = copperField(q);
      opticalDepth += mix(vec3(1.0, 0.26, 0.008), vec3(0.95, 0.20, 0.07),
        smoothstep(0.65, 0.95, uCuCompletion)) * (bulk + plume * frontWeight)
        * 1.55 * distance / (uSteps * radius);
    } else if (uKind > 2.5) {
      float c = permanganateVolume(q);
      // Beer-Lambert: retained dissolved MnO4- alone determines transmission.
      opticalDepth += vec3(0.17, 1.12, 0.43) * max(0.0, c) * distance / (uSteps * radius);
    } else {
      float c = 1.0 - smoothstep(0.02, 0.98, uProgress);
      if (uIncomingDyed > 0.5) {
        vec2 uv = vec2(clamp(0.5 + vPoint.x / (radius * 2.0), 0.0, 1.0), clamp((vPoint.y - bottom) / height, 0.0, 1.0));
        c = permanganateTongue(uTransport, uv, uTransportAge) * (1.0 - smoothstep(0.65, 3.0, uTransportAge));
      }
      opticalDepth += vec3(0.16, 0.78, 0.33) * c * distance / (uSteps * radius);
    }
  }
  outColor = vec4(exp(-opticalDepth), 1.0);
}`,
    });
  }
}
