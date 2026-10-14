import * as THREE from "three";

/** Optical depth through a soft, porous AgCl body. The sphere is only a ray-entry proxy. */
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
      float blob(vec3 p, vec3 center, vec3 axis) {
        vec3 q = (p - center) / axis;
        return exp(-2.35 * dot(q, q));
      }
      float density(vec3 p) {
        p += vec3(0.15 * sin(5.0*p.y + 4.0*p.z)
            + 0.045 * sin(17.0*p.y - 11.0*p.z),
          0.12 * sin(7.0*p.x - 5.0*p.z),
          0.11 * sin(6.0*p.y - 3.0*p.x));
        float d = 1.30 * blob(p, vec3(-0.24, 0.26, 0.03), vec3(0.72, 0.58, 0.65));
        d += 0.98 * blob(p, vec3(0.32, 0.04, -0.18), vec3(0.53, 0.55, 0.55));
        d += 0.78 * blob(p, vec3(-0.27, -0.32, 0.13), vec3(0.43, 0.54, 0.48));
        d += 0.46 * blob(p, vec3(0.35, -0.70, 0.08), vec3(0.23, 0.62, 0.31));
        d += 0.28 * blob(p, vec3(-0.55, -0.61, -0.10), vec3(0.18, 0.71, 0.24));
        float grain = 0.88 + 0.19 * sin(11.0*p.x + 7.0*p.y) * sin(9.0*p.z - 6.0*p.y)
          + 0.07 * sin(25.0*p.x - 18.0*p.z);
        return d * grain;
      }
      void main() {
        vec3 direction = normalize(vSurface - vEye);
        float travel = max(0.0, -2.0 * dot(vSurface, direction));
        float integral = 0.0;
        for (int step = 0; step < 10; step++) {
          vec3 p = vSurface + direction * travel * (float(step) + 0.5) / 10.0;
          vec3 tubePoint = vTubeCenter + vBasisX * p.x + vBasisY * p.y + vBasisZ * p.z;
          float radial = length(tubePoint.xz);
          float bowl = uBottom + uRadius - sqrt(max(0.0, uRadius*uRadius - radial*radial));
          if (radial < uRadius * 0.96 && tubePoint.y >= bowl && tubePoint.y <= uLevel)
            integral += density(p);
        }
        float opticalDepth = integral * travel * 0.75;
        float core = smoothstep(0.34, 1.02, opticalDepth);
        float wisps = 0.10 * smoothstep(0.05, 0.35, opticalDepth);
        float alpha = min(1.0, core + wisps) * smoothstep(0.0, 0.55, travel);
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
