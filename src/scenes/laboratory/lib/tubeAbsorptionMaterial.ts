import * as THREE from "three";

/** Shared Cu2+ field for the visible liquid, transmission, and immersed solids. */
export const copperConcentrationGLSL = `
float copperConcentration(vec3 q, vec3 source, float radius, float height,
  float progress, float rate, float time) {
  float h = clamp((q.y - source.y) / max(height, 0.0001), 0.0, 1.0);
  float radial = length(q.xz - source.xz) / max(radius, 0.0001);
  float activity = smoothstep(0.0, 0.035, progress);
  float front = mix(0.20, 1.15, smoothstep(0.0, 0.80, progress));
  float reach = 1.0 - smoothstep(front - 0.20, front + 0.17, h);
  // A broad source cloud and one soft, wandering current. Narrow fixed lanes
  // read as vertical stripes when the dye grows denser.
  float pulse = 0.80 + 0.20 * sin(time * (2.3 + rate * 1.8) - h * 8.0);
  vec2 bend = vec2(sin(h * 8.0 - time * (0.65 + rate * 0.35)),
    cos(h * 6.0 + time * 0.43)) * (0.12 + h * 0.12);
  float streamRadius = length(q.xz - source.xz - radius * bend) / max(radius, 0.0001);
  float sourceCloud = exp(-radial * radial * 1.6 - h * h * 18.0);
  float current = exp(-streamRadius * streamRadius * mix(2.5, 1.2, h))
    * exp(-h * 0.8) * pulse;
  float base = reach * activity * (0.11 + 0.28 * progress);
  float streams = activity * reach * (sourceCloud * (0.67 + 0.25 * rate)
    + current * (0.24 + 0.26 * rate) * smoothstep(0.0, 0.06, h));
  float homogeneous = smoothstep(0.58, 0.98, progress);
  float partial = max(base, streams);
  return clamp(mix(partial, 1.0, homogeneous), 0.0, 1.0);
}`;

/** The same transported, irregular dye silhouette on the liquid and in its optical depth. */
export const permanganateTongueGLSL = `
float permanganateTongue(sampler2D field, vec2 uv, float age) {
  return texture2D(field, clamp(uv, vec2(0.0), vec2(1.0))).r;
}`;

/** Multiplies the rendered scene by the light transmitted through a coloured solution. */
export class TubeAbsorptionMaterial extends THREE.ShaderMaterial {
  constructor(radius: number, bottom: number, height: number) {
    super({
      name: "TubeAbsorption",
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.FrontSide, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uLevel: { value: bottom + height },
        uCameraLocal: { value: new THREE.Vector3(0, 0, 1) },
        uKind: { value: 0 }, uProgress: { value: 0 },
        uRate: { value: 0 }, uTime: { value: 0 },
        uCopperSource: { value: new THREE.Vector3(0, bottom + radius, 0) },
        uTransport: { value: null as THREE.Texture | null },
        uTransportAge: { value: 0 }, uIncomingDyed: { value: 0 },
      },
      vertexShader: `attribute float tubeSurface; attribute float tubeWave;
uniform vec3 uUp; uniform float uLevel;
varying vec3 vPoint; varying float vCap;
void main() {
  vec3 point = position;
  vCap = tubeSurface;
  if (tubeSurface > 0.5) {
    point.y = (uLevel - dot(uUp.xz, position.xz)) / max(uUp.y, 0.2);
    point.y += 0.0008 * pow(clamp((length(position.xz) / ${radius.toFixed(7)} - 0.67) / 0.33, 0.0, 1.0), 2.0) + tubeWave;
  }
  vPoint = point;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
}`,
      fragmentShader: `uniform vec3 uUp, uCameraLocal;
uniform float uLevel, uKind, uProgress, uTransportAge, uIncomingDyed;
uniform float uRate, uTime; uniform vec3 uCopperSource;
uniform sampler2D uTransport;
varying vec3 vPoint; varying float vCap;
${copperConcentrationGLSL}
${permanganateTongueGLSL}
void main() {
  float radius = ${radius.toFixed(7)};
  float bottom = ${bottom.toFixed(7)};
  float height = ${height.toFixed(7)};
  float surfaceDistance = dot(uUp, vPoint) - uLevel;
  if (vCap < 0.5 && surfaceDistance > 0.0004) discard;
  vec3 ray = normalize(vPoint - uCameraLocal);
  vec2 offset = vPoint.xz;
  float a = max(dot(ray.xz, ray.xz), 0.000001);
  float b = dot(offset, ray.xz);
  float root = sqrt(max(0.0, b * b + a * (radius * radius - dot(offset, offset))));
  // The authored shell can expose its far-facing wall. Use the full chord on
  // a wall fragment, independent of which winding reached the rasterizer.
  float side = vCap > 0.5 ? (-b + root) / a : 2.0 * root / a;
  float distance = max(0.0, side);
  if (ray.y < -0.00001) distance = min(distance, max(0.0, (bottom - vPoint.y) / ray.y));
  float upRay = dot(uUp, ray);
  if (upRay > 0.00001) distance = min(distance, max(0.0, -surfaceDistance / upRay));
  distance = min(distance, height * 2.0);
  // The curved glass bends a nearly grazing view into the body of the
  // solution; a flat surface cut would otherwise erase the upper column.
  if (vCap < 0.5) distance = max(distance, 0.55 * side);
  vec3 opticalDepth = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec3 q = vPoint + ray * distance * (float(i) + 0.5) / 8.0;
    float h = clamp((q.y - bottom) / height, 0.0, 1.0);
    if (uKind < 1.5) {
      float concentration = copperConcentration(q, uCopperSource, radius, height,
        uProgress, uRate, uTime);
      vec3 sigma = mix(vec3(0.55, 0.17, 0.07), vec3(0.42, 0.08, 0.0),
        smoothstep(0.62, 1.0, uProgress));
      opticalDepth += sigma * concentration * distance / (8.0 * radius);
    } else {
      float concentration = 1.0 - smoothstep(0.02, 0.98, uProgress);
      if (uIncomingDyed > 0.5) {
        // Integrate one projected silhouette through the chord. Sampling the
        // narrow dye at eight distinct ray positions prints eight parallel
        // bands, even when the transport texture itself has no such pattern.
        vec2 uv = vec2(clamp(0.5 + vPoint.x / (radius * 2.0), 0.0, 1.0),
          clamp((vPoint.y - bottom) / height, 0.0, 1.0));
        float dye = permanganateTongue(uTransport, uv, uTransportAge);
        float clearing = smoothstep(0.65, 3.0, uTransportAge);
        concentration = dye * (1.0 - clearing);
      }
      opticalDepth += vec3(0.16, 0.78, 0.33) * concentration * distance / (8.0 * radius);
    }
  }
  gl_FragColor = vec4(exp(-opticalDepth), 1.0);
}`,
    });
  }
}
