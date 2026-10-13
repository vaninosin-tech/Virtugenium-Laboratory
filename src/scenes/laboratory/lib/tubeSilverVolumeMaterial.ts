import * as THREE from "three";

/** Optical depth through a soft, porous AgCl body. The sphere is only a ray-entry proxy. */
export function makeSilverVolumeMaterial(radius: number, bottom: number) {
  const camera = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    uniforms: { uCameraLocal: camera, uRadius: { value: radius }, uBottom: { value: bottom } },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    vertexShader: `
      uniform vec3 uCameraLocal;
      varying vec3 vSurface;
      varying vec3 vEye;
      varying vec3 vTubePoint;
      void main() {
        vec3 a = instanceMatrix[0].xyz;
        vec3 b = instanceMatrix[1].xyz;
        vec3 c = instanceMatrix[2].xyz;
        vec3 delta = uCameraLocal - instanceMatrix[3].xyz;
        vEye = vec3(dot(delta, a) / dot(a, a), dot(delta, b) / dot(b, b),
          dot(delta, c) / dot(c, c));
        vSurface = position;
        vTubePoint = (instanceMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uRadius;
      uniform float uBottom;
      varying vec3 vSurface;
      varying vec3 vEye;
      varying vec3 vTubePoint;
      float blob(vec3 p, vec3 center, vec3 axis) {
        vec3 q = (p - center) / axis;
        return exp(-2.35 * dot(q, q));
      }
      float density(vec3 p) {
        p += vec3(0.11 * sin(7.0*p.y + 5.0*p.z),
          0.10 * sin(8.0*p.x - 6.0*p.z),
          0.09 * sin(9.0*p.y - 4.0*p.x));
        float d = blob(p, vec3(-0.22, 0.20, 0.02), vec3(0.65, 0.68, 0.64));
        d += blob(p, vec3(0.25, 0.10, -0.12), vec3(0.61, 0.68, 0.58));
        d += blob(p, vec3(-0.18, -0.28, 0.13), vec3(0.57, 0.62, 0.58));
        d += blob(p, vec3(0.14, -0.42, 0.07), vec3(0.44, 0.56, 0.48));
        float grain = 0.78 + 0.25 * sin(13.0*p.x + 7.0*p.y) * sin(11.0*p.z - 8.0*p.y)
          + 0.10 * sin(27.0*p.x - 18.0*p.z);
        return d * grain;
      }
      void main() {
        float radial = length(vTubePoint.xz);
        if (radial > uRadius * 0.96) discard;
        float bowl = uBottom + uRadius - sqrt(max(0.0, uRadius*uRadius - radial*radial));
        if (vTubePoint.y < bowl) discard;
        vec3 direction = normalize(vSurface - vEye);
        float travel = max(0.0, -2.0 * dot(vSurface, direction));
        float integral = 0.0;
        for (int step = 0; step < 10; step++) {
          vec3 p = vSurface + direction * travel * (float(step) + 0.5) / 10.0;
          integral += density(p);
        }
        float opticalDepth = integral * travel * 0.75;
        float alpha = smoothstep(0.18, 1.05, opticalDepth) * smoothstep(0.0, 0.55, travel);
        if (alpha < 0.012) discard;
        vec3 center = vSurface + direction * travel * 0.5;
        float fibers = sin(4.0 * center.x + 3.0 * center.y)
          * sin(5.0 * center.z - 3.0 * center.y);
        float shade = 0.96 + 0.02 * fibers;
        gl_FragColor = vec4(shade, shade, shade * 0.995, alpha);
      }
    `,
  });
  return { material, camera };
}
