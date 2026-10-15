import * as THREE from "three";

/** Optical depth through an existing AgCl aggregate instance. The sphere is only a ray-entry proxy. */
export function makeSilverVolumeMaterial(radius: number, bottom: number) {
  const camera = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    uniforms: { uCameraLocal: camera, uRadius: { value: radius },
      uBottom: { value: bottom }, uLevel: { value: bottom } },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    vertexShader: `
      uniform vec3 uCameraLocal;
      varying vec3 vSurface;
      varying vec3 vEye;
      varying vec3 vTubeCenter;
      varying vec3 vBasisX;
      varying vec3 vBasisY;
      varying vec3 vBasisZ;
      void main() {
        vec3 a = instanceMatrix[0].xyz;
        vec3 b = instanceMatrix[1].xyz;
        vec3 c = instanceMatrix[2].xyz;
        vec3 delta = uCameraLocal - instanceMatrix[3].xyz;
        vEye = vec3(dot(delta, a) / dot(a, a), dot(delta, b) / dot(b, b),
          dot(delta, c) / dot(c, c));
        vSurface = position;
        vTubeCenter = instanceMatrix[3].xyz;
        vBasisX = a;
        vBasisY = b;
        vBasisZ = c;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uRadius;
      uniform float uBottom;
      uniform float uLevel;
      varying vec3 vSurface;
      varying vec3 vEye;
      varying vec3 vTubeCenter;
      varying vec3 vBasisX;
      varying vec3 vBasisY;
      varying vec3 vBasisZ;
      float lobe(vec3 p, vec3 center, vec3 axis) {
        vec3 q = (p - center) / axis;
        return exp(-3.2 * dot(q, q));
      }
      float density(vec3 p) {
        // Shape varies with the supplied instance transform, never with time.
        float seed = dot(vTubeCenter, vec3(173.1, 117.7, 203.9));
        vec3 warp = vec3(0.045 * sin(5.0*p.y + seed),
          0.04 * sin(4.0*p.x - seed), 0.045 * sin(5.0*p.y + 0.7*seed));
        vec3 q = p + warp;
        float d = 0.72 * lobe(q, vec3(0.0), vec3(0.82, 0.88, 0.80));
        d += 0.55 * lobe(q, vec3(0.31, 0.15, -0.12), vec3(0.48, 0.57, 0.52));
        d += 0.46 * lobe(q, vec3(-0.28, -0.12, 0.18), vec3(0.48, 0.50, 0.44));
        d += 0.30 * lobe(q, vec3(0.02, -0.37, -0.13), vec3(0.48, 0.46, 0.45));
        return clamp(d, 0.0, 2.0);
      }
      void main() {
        vec3 ray = vSurface - vEye;
        vec3 direction = ray / max(length(ray), 0.000001);
        float travel = clamp(-2.0 * dot(vSurface, direction), 0.0, 2.0);
        float integral = 0.0;
        for (int step = 0; step < 12; step++) {
          vec3 p = vSurface + direction * travel * (float(step) + 0.5) / 12.0;
          vec3 tubePoint = vTubeCenter + vBasisX * p.x + vBasisY * p.y + vBasisZ * p.z;
          float radial = length(tubePoint.xz);
          float bowl = uBottom + uRadius - sqrt(max(0.0, uRadius*uRadius - radial*radial));
          if (radial < uRadius * 0.98 && tubePoint.y >= bowl && tubePoint.y <= uLevel)
            integral += density(p) / 12.0;
        }
        float opticalDepth = clamp(integral * travel * 2.8, 0.0, 32.0);
        float alpha = clamp(1.0 - exp(-opticalDepth), 0.0, 1.0);
        if (alpha < 0.008) discard;
        float shade = clamp(0.88 + 0.08 * exp(-opticalDepth * 0.6), 0.0, 1.0);
        gl_FragColor = vec4(vec3(shade, shade, shade * 0.99), alpha);
      }
    `,
  });
  return { material, camera };
}
