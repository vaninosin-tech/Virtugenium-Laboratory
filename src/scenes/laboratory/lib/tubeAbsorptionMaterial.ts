import * as THREE from "three";

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
uniform float uCuBlend;
uniform vec3 uCuBoundsMin, uCuBoundsSize;
float copperField(vec3 p) {
  vec3 uvw = (p - uCuBoundsMin) / uCuBoundsSize;
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
  float density = mix(texture(uCuPrevious, uvw).r, texture(uCuCurrent, uvw).r, uCuBlend);
  return min(pow(max(0.0, density), 0.25) * 1.5, 1.6);
}`;

export const permanganateTongueGLSL = `
float permanganateTongue(sampler2D field, vec2 uv, float age) {
  return texture(field, clamp(uv, vec2(0.0), vec2(1.0))).r;
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
        uCuBoundsMin: { value: bounds.min },
        uCuBoundsSize: { value: bounds.size },
        uCuSpheres: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
        uCuCount: { value: 0 }, uSteps: { value: 16 },
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
      opticalDepth += vec3(0.42, 0.12, 0.005) * max(0.0, copperField(q)) * distance / (uSteps * radius);
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
