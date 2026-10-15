import * as THREE from "three";

/** A 1x1x1 zero texture so the haze sampler is always valid. */
function emptyHaze() {
  const texture = new THREE.Data3DTexture(new Float32Array(1), 1, 1, 1);
  texture.format = THREE.RedFormat; texture.type = THREE.FloatType;
  texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}

/** One bounded ray-marched volume for the conserved dense field and its source. */
export function makeSilverVolumeMaterial(radius: number, bottom: number, height: number,
  dense?: THREE.Data3DTexture, overlap?: THREE.Data3DTexture) {
  const camera = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uCameraLocal: camera, uRadius: { value: radius },
      uBottom: { value: bottom }, uHeight: { value: height }, uLevel: { value: bottom },
      uDense: { value: dense }, uOverlap: { value: overlap },
      uHaze: { value: emptyHaze() }, uTint: { value: emptyHaze() }, uChip: { value: emptyHaze() }, uHazeStrength: { value: 7.0 },
      uTintStrength: { value: 4.0 }, uTime: { value: 0 },
      uUp: { value: new THREE.Vector3(0, 1, 0) } },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    vertexShader: `
      uniform float uBottom; uniform float uHeight;
      out vec3 vPoint;
      void main() {
        vPoint = position + vec3(0.0, uBottom + uHeight * 0.5, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      precision highp sampler3D;
      uniform vec3 uCameraLocal;
      uniform float uRadius, uBottom, uHeight, uLevel;
      uniform vec3 uUp;
      uniform sampler3D uDense, uOverlap, uHaze, uTint, uChip;
      uniform float uHazeStrength, uTintStrength, uTime;
      in vec3 vPoint;
      out vec4 outColor;
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float noise3(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x),
          mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
          mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x),
          mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a*noise3(p); p = p*2.03+vec3(1.7,9.2,3.1); a *= 0.5; } return s; }
      float billow3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a*abs(2.0*noise3(p)-1.0); p = p*2.1+vec3(5.3,1.1,7.7); a *= 0.5; } return s; }
      // Wet cotton wool (the look tuned in cotton-lab.html): the simulated concentration decides where the mass is
      // and how dense its core is; torn, feathery detail exists only at the rim, folds and lumps inside.
      float cotton(vec4 field, vec3 grid, vec3 position) {
        if (field.r <= 0.0) return 0.0;
        vec3 q0 = vec3(position.x,position.y-uBottom,position.z)/uRadius;
        vec3 w = vec3(noise3(q0*1.7+vec3(3.0,1.0,2.0)), noise3(q0*1.7+vec3(7.0,5.0,1.0)),
          noise3(q0*1.7+vec3(2.0,9.0,4.0)))-0.5;
        vec3 q = q0 + w*0.30;
        float concentration = field.r/(field.r+0.23);
        float base = 1.05*concentration;
        float rim = 1.0-smoothstep(0.35,0.95,base);
        float lump = billow3(q*4.6), big = billow3(q*2.2), fold = fbm3(q*8.0);
        float f = base + (0.34+0.30*rim)*(lump-0.30) + 0.22*(big-0.30) + (0.10+0.16*rim)*(fold-0.5);
        f += rim*0.42*(fbm3(q*15.0)-0.45) + rim*0.20*(noise3(q*37.0)-0.5);
        return smoothstep(0.60,0.72,f);
      }
      vec3 uvw(vec3 p) { return vec3(p.x/(2.0*uRadius)+0.5,
        (p.y-uBottom)/uHeight, p.z/(2.0*uRadius)+0.5); }
      bool wet(vec3 p) {
        float radial = length(p.xz);
        float bowl = uBottom+uRadius-sqrt(max(0.0,uRadius*uRadius-radial*radial));
        return radial < uRadius*0.985 && p.y >= bowl && dot(uUp,p) <= uLevel;
      }
      float solidAt(vec3 p) {
        if (!wet(p)) return 0.0;
        vec3 g = uvw(p);
        return cotton(texture(uDense,g),g,p);
      }
      void main() {
        vec3 direction = normalize(vPoint-uCameraLocal);
        vec3 boxMin = vec3(-uRadius*1.2,uBottom-uRadius*0.15,-uRadius*1.2);
        vec3 boxMax = vec3(uRadius*1.2,uBottom+uHeight+uRadius*0.15,uRadius*1.2);
        vec3 safeDirection = vec3(direction.x < 0.0 ? -1.0 : 1.0,
          direction.y < 0.0 ? -1.0 : 1.0, direction.z < 0.0 ? -1.0 : 1.0)
          * max(abs(direction),vec3(0.000001));
        vec3 a = (boxMin-uCameraLocal)/safeDirection;
        vec3 b = (boxMax-uCameraLocal)/safeDirection;
        float entry = max(0.0,max(max(min(a.x,b.x),min(a.y,b.y)),min(a.z,b.z)));
        float exitDistance = min(min(max(a.x,b.x),max(a.y,b.y)),max(a.z,b.z));
        if (exitDistance <= entry) discard;
        float stepLength = (exitDistance-entry)/56.0;
        vec3 accumulated = vec3(0.0);
        float alpha = 0.0;
        // Fixed 56 primary taps and three light taps per occupied sample.
        for (int step = 0; step < 56; step++) {
          vec3 p = uCameraLocal+direction*(entry+(float(step)+0.5)*stepLength);
          if (!wet(p)) continue;
          vec3 grid = uvw(p);
          vec4 field = texture(uDense,grid);
          float rim = 1.0-smoothstep(0.87,0.985,length(p.xz)/uRadius);
          float solid = cotton(field,grid,p)*rim;
          float source = texture(uOverlap,grid).r;
          float mixing = source > 0.015 ? smoothstep(0.015,0.08,source) : 0.0;
          float lit = 1.0, diffuse = 0.5;
          if (solid > 0.01) {
            // Self shadow toward the light and a slope term, as in the cotton lab.
            vec3 toLight = normalize(vec3(0.45,0.7,0.55));
            float sh = 0.0;
            for (int k = 1; k <= 3; k++) sh += solidAt(p+toLight*uRadius*0.12*float(k));
            lit = exp(-sh*0.9);
            diffuse = clamp(0.5-(solidAt(p+toLight*uRadius*0.06)-solid)*3.0,0.0,1.0);
          }
          // Fine solid shed by the cotton tints the water: bluish white, built up gently.
          float smokeValue = texture(uHaze,grid).r;
          float tintValue = texture(uTint,grid).r;
          float smokeDensity = 0.0, ribbon = 0.0;
          if (smokeValue > 0.0004) {
            // Smoke as in the reference: a smooth steel-grey veil plus thin curled ribbons, like ink in water.
            vec3 sq = vec3(p.x,p.y-uBottom,p.z)/uRadius;
            vec3 swirl = vec3(noise3(sq*0.9+vec3(0.0,uTime*0.04,0.0)), noise3(sq*0.9+vec3(5.0,2.0,uTime*0.03)),
              noise3(sq*0.9+vec3(1.0,uTime*0.02,7.0)))-0.5;
            vec3 sw = sq+swirl*1.6;
            float veil = 0.55+0.45*noise3(sw*vec3(1.4,0.8,1.4));
            float line = 1.0-abs(2.0*noise3(sw*vec3(2.6,1.3,2.6)+vec3(0.0,-uTime*0.05,0.0))-1.0);
            ribbon = pow(line,9.0);
            smokeDensity = smokeValue*(0.7*veil+2.2*ribbon);
          }
          // Small torn-off chips: separate bright specks, only where chips are present.
          float chipValue = texture(uChip,grid).r;
          if (chipValue > 0.0004) {
            // Irregular flakes: a warped, lower-frequency noise thresholded high so only a few survive.
            vec3 cq = vec3(p.x,p.y-uBottom,p.z)/uRadius*7.0;
            vec3 cw = vec3(noise3(cq*0.7+vec3(1.0,2.0,3.0)),noise3(cq*0.7+vec3(7.0,5.0,1.0)),noise3(cq*0.7+vec3(4.0,9.0,6.0)))-0.5;
            float speck = smoothstep(0.80,0.84,noise3(cq+cw*1.4+vec3(3.0,1.0,5.0)));
            float chipAlpha = 1.0-exp(-speck*smoothstep(0.004,0.03,chipValue)*40.0*stepLength/uRadius);
            accumulated += (1.0-alpha)*chipAlpha*vec3(0.96,0.97,0.98);
            alpha += (1.0-alpha)*chipAlpha;
          }
          float hazeAlpha = 1.0-exp(-(smokeDensity*uHazeStrength+tintValue*uTintStrength)*stepLength/uRadius);
          accumulated += (1.0-alpha)*hazeAlpha*mix(vec3(0.34,0.44,0.58),vec3(0.74,0.82,0.92),clamp(ribbon*3.0,0.0,1.0));
          alpha += (1.0-alpha)*hazeAlpha;
          float localAlpha = 1.0-exp(-(solid*26.0+mixing*0.012)*stepLength/uRadius);
          vec3 color = mix(vec3(0.91,0.93,0.91),
            vec3(1.0,1.0,0.995)*(0.70+0.22*lit+0.10*diffuse),
            solid/(solid+mixing*0.10+0.00001));
          accumulated += (1.0-alpha)*localAlpha*color;
          alpha += (1.0-alpha)*localAlpha;
        }
        if (alpha < 0.005) discard;
        outColor = vec4(accumulated/max(alpha,0.00001),alpha);
      }
    `,
  });
  return { material, camera };
}


/** Optical depth through an existing AgCl aggregate instance. The sphere is only a ray-entry proxy. */
export function makeLegacySilverVolumeMaterial(radius: number, bottom: number) {
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
        vEye = vec3(dot(delta, a) / max(dot(a, a), 1e-12),
          dot(delta, b) / max(dot(b, b), 1e-12),
          dot(delta, c) / max(dot(c, c), 1e-12));
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
        // A soft density field and overlapping lobes give each existing floc a
        // dense core and a feathered edge without spawning extra particles.
        return clamp(d, 0.0, 2.0);
      }
      void main() {
        vec3 ray = vSurface - vEye;
        vec3 direction = ray / max(length(ray), 0.000001);
        float travel = clamp(-2.0 * dot(vSurface, direction), 0.0, 2.0);
        float integral = 0.0;
        // Fixed 12-tap midpoint quadrature: bounded cost per visible fragment.
        // Integrate optical depth in local sphere units; no time or grid phase.
        for (int step = 0; step < 12; step++) {
          vec3 p = vSurface + direction * travel * (float(step) + 0.5) / 12.0;
          vec3 tubePoint = vTubeCenter + vBasisX * p.x + vBasisY * p.y + vBasisZ * p.z;
          float radial = length(tubePoint.xz);
          float bowl = uBottom + uRadius - sqrt(max(0.0, uRadius*uRadius - radial*radial));
          if (radial < uRadius * 0.98 && tubePoint.y >= bowl && tubePoint.y <= uLevel)
            integral += clamp(density(p), 0.0, 2.0) * travel / 12.0;
        }
        float opticalDepth = clamp(integral * 2.8, 0.0, 32.0);
        float alpha = clamp(1.0 - exp(-opticalDepth), 0.0, 1.0);
        if (alpha < 0.008) discard;
        // Forward scattered light stays below display white even where lobes overlap.
        float shade = clamp(0.85 + 0.11 * exp(-opticalDepth * 0.6), 0.0, 1.0);
        gl_FragColor = vec4(clamp(vec3(shade, shade, shade * 0.99), 0.0, 1.0), alpha);
      }
    `,
  });
  return { material, camera };
}
