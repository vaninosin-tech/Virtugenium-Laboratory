import * as THREE from "three";

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
uniform sampler2D uTransport;
varying vec3 vPoint; varying float vCap;
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
      float mixed = pow(smoothstep(0.06, 0.94, uProgress), 2.0);
      float concentration = mixed * (0.79 + 0.21 * (1.0 - h));
      concentration = mix(concentration, 1.0, smoothstep(0.72, 1.0, uProgress));
      vec3 sigma = mix(vec3(1.25, 0.40, 0.18), vec3(3.7, 0.50, 0.18),
        smoothstep(0.62, 1.0, uProgress));
      opticalDepth += sigma * concentration * distance / (8.0 * radius);
    } else {
      float concentration = 1.0 - smoothstep(0.02, 0.98, uProgress);
      if (uIncomingDyed > 0.5) {
        vec2 uv = vec2(clamp(0.5 + dot(q.xz / (radius * 2.0), vec2(0.42, 0.91)), 0.0, 1.0), h);
        float dye = texture2D(uTransport, uv).r;
        float fill = smoothstep(0.2, 2.1, uTransportAge);
        float clearing = smoothstep(3.0, 16.0, uTransportAge);
        float front = mix(1.1, 0.12, clearing);
        float bulk = fill * (1.0 - smoothstep(front - 0.13, front + 0.13, h));
        concentration = max(dye * (1.0 - clearing), bulk);
      }
      opticalDepth += vec3(2.7, 6.5, 2.3) * concentration * distance / (8.0 * radius);
    }
  }
  gl_FragColor = vec4(exp(-opticalDepth), 1.0);
}`,
    });
  }
}
