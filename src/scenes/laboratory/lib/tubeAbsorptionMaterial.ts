import * as THREE from "three";

/** Shared Cu2+ field for the visible liquid, transmission, and immersed solids. */
export const copperConcentrationGLSL = `
float copperConcentration(vec3 q, vec3 source, float radius, float height,
  float progress, float rate, float time) {
  float h = clamp((q.y - source.y) / max(height, 0.0001), 0.0, 1.0);
  float radial = length(q.xz - source.xz) / max(radius, 0.0001);
  float activity = smoothstep(0.005, 0.16, progress);
  float front = mix(0.12, 1.18, smoothstep(0.02, 0.82, progress));
  float reach = 1.0 - smoothstep(front - 0.20, front + 0.14, h);
  float base = activity * reach * (0.05 + 0.25 * progress)
    * exp(-radial * radial * 0.95);
  float plume = 0.0;
  for (int i = 0; i < 3; i++) {
    float lane = float(i) - 1.0;
    vec2 bend = vec2(sin(h * (8.0 + lane) - time * (0.55 + rate * 0.7) + lane * 2.4),
      cos(h * 7.0 + time * 0.42 + lane * 2.1));
    vec2 axis = source.xz + radius * (vec2(lane * 0.50, lane * 0.15)
      + bend * (0.08 + h * 0.12));
    float width = radius * (0.15 + h * 0.09);
    float laneDensity = exp(-dot(q.xz - axis, q.xz - axis) / (width * width));
    float pulse = 0.84 + (0.04 + rate * 0.12)
      * sin(time * (1.4 + rate * 2.3) - h * 7.0 + lane * 2.0);
    plume = max(plume, laneDensity * pulse);
  }
  float sourceCloud = exp(-radial * radial * 2.1 - h * h * 14.0);
  float streams = activity * reach * (sourceCloud * 0.72
    + plume * (0.25 + 0.20 * rate) * smoothstep(0.0, 0.05, h));
  float homogeneous = smoothstep(0.58, 0.98, progress);
  float partial = max(base, streams) * mix(0.48, 1.0, smoothstep(0.55, 1.0, progress));
  return clamp(mix(partial, 1.0, homogeneous), 0.0, 1.0);
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
      vec3 sigma = mix(vec3(1.25, 0.40, 0.18), vec3(3.7, 0.50, 0.18),
        smoothstep(0.62, 1.0, uProgress));
      opticalDepth += sigma * concentration * distance / (8.0 * radius);
    } else {
      float concentration = 1.0 - smoothstep(0.02, 0.98, uProgress);
      if (uIncomingDyed > 0.5) {
        vec2 uv = vec2(clamp(0.5 + dot(q.xz / (radius * 2.0), vec2(0.42, 0.91)), 0.0, 1.0), h);
        float dye = texture2D(uTransport, uv).r;
        float clearing = smoothstep(3.0, 16.0, uTransportAge);
        // The inlet field carries the dye; its three descending folds are
        // resolved here at each ray sample, leaving clear channels between.
        float x = q.x / (radius * 2.0);
        float descent = smoothstep(0.25, 2.4, uTransportAge);
        float aTongue = exp(-pow((x + 0.30 + 0.045 * sin(h * 29.0 - uTransportAge * 1.7)) / 0.12, 2.0)
          - pow((h - (0.82 - 0.39 * descent)) / 0.21, 2.0));
        float bTongue = exp(-pow((x - 0.015 - 0.06 * sin(h * 24.0 + uTransportAge * 1.3)) / 0.13, 2.0)
          - pow((h - (0.72 - 0.49 * descent)) / 0.23, 2.0));
        float cTongue = exp(-pow((x - 0.34 + 0.045 * sin(h * 27.0 - uTransportAge * 1.1)) / 0.11, 2.0)
          - pow((h - (0.91 - 0.32 * descent)) / 0.19, 2.0));
        float tongues = pow(max(max(aTongue * 0.88, bTongue), cTongue * 0.83), 0.68)
          * smoothstep(0.15, 0.75, uTransportAge);
        concentration = max(smoothstep(0.025, 0.70, dye), smoothstep(0.16, 0.48, tongues))
          * (1.0 - clearing);
      }
      opticalDepth += vec3(2.7, 6.5, 2.3) * concentration * distance / (8.0 * radius);
    }
  }
  gl_FragColor = vec4(exp(-opticalDepth), 1.0);
}`,
    });
  }
}
