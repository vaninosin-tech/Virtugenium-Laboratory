import * as THREE from "three";

/** Periodic value-noise volume (64^3, 8 bit). One filtered texture tap replaces eight hash evaluations per noise lookup,
 * which keeps the shader small enough to compile quickly in the browser. */
function noiseVolume() {
  const size = 64, data = new Uint8Array(size * size * size);
  let seed = 1234567;
  for (let i = 0; i < data.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data[i] = seed >>> 24; }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}

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
      uHaze: { value: emptyHaze() }, uTint: { value: emptyHaze() }, uChip: { value: emptyHaze() }, uHazeStrength: { value: 9.0 }, uSteps: { value: 88 }, uNoise: { value: noiseVolume() },
      uTintStrength: { value: 6.0 }, uSmokeOn: { value: 0 }, uDiag: { value: 0 }, uCloudOn: { value: 0 }, uCloudK: { value: 2.2 }, uFlocOn: { value: 1 }, uTime: { value: 0 },
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
      uniform sampler3D uDense, uOverlap, uHaze, uTint, uChip, uNoise;
      uniform float uHazeStrength, uTintStrength, uTime;
      uniform int uSteps;
      uniform float uSmokeOn, uDiag, uCloudOn, uCloudK, uFlocOn;
      in vec3 vPoint;
      out vec4 outColor;
      // Value noise from a periodic 64^3 texture (see noiseVolume): one tap per lookup.
      float noise3(vec3 p) { return texture(uNoise, p*(1.0/64.0)).r; }
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
        // Cotton is a very porous fractal aggregate: it becomes opaque at a low concentration.
        float concentration = field.r/(field.r+0.23);
        float base = 1.05*concentration;
        float rim = 1.0-smoothstep(0.35,0.95,base);
        float lump = billow3(q*3.4), big = billow3(q*1.7), fold = fbm3(q*6.0);
        float f = base + (0.34+0.30*rim)*(lump-0.30) + 0.22*(big-0.30) + (0.10+0.16*rim)*(fold-0.5);
        // Fibres: elongated along the carrier flow direction stored in the field, torn at the rim only.
        vec3 qf = q*vec3(9.0,4.0,9.0);
        f += rim*0.34*(fbm3(qf)-0.45) + rim*0.12*(noise3(q*vec3(24.0,10.0,24.0))-0.5);
        return smoothstep(0.58,0.80,f);
      }
      vec3 uvw(vec3 p) { return vec3(p.x/(2.0*uRadius)+0.5,
        (p.y-uBottom)/uHeight, p.z/(2.0*uRadius)+0.5); }
      bool wet(vec3 p) {
        float radial = length(p.xz);
        float bowl = uBottom+uRadius-sqrt(max(0.0,uRadius*uRadius-radial*radial));
        return radial < uRadius*0.985 && p.y >= bowl && dot(uUp,p) <= uLevel + 0.0035;
      }
      // Packed heaps are stored column by column; a small cross blur in x and z removes the column pattern.
      vec4 denseAt(vec3 g) {
        vec3 s = vec3(1.0/float(textureSize(uDense,0).x),1.0/float(textureSize(uDense,0).y),1.0/float(textureSize(uDense,0).z));
        vec3 d = s*1.4;
        vec4 c = texture(uDense,g)*0.32;
        c += (texture(uDense,g+vec3(d.x,0,0))+texture(uDense,g-vec3(d.x,0,0))
            +texture(uDense,g+vec3(0,0,d.z))+texture(uDense,g-vec3(0,0,d.z))
            +texture(uDense,g+vec3(0,d.y,0))+texture(uDense,g-vec3(0,d.y,0)))*0.113;
        return c;
      }
      void main() {
        vec3 direction = normalize(vPoint-uCameraLocal);
        vec3 boxMin = vec3(-uRadius*1.2,uBottom-uRadius*0.15,-uRadius*1.2);
        vec3 boxMax = vec3(uRadius*1.2,uBottom+uHeight+uRadius*0.6,uRadius*1.2);
        vec3 safeDirection = vec3(direction.x < 0.0 ? -1.0 : 1.0,
          direction.y < 0.0 ? -1.0 : 1.0, direction.z < 0.0 ? -1.0 : 1.0)
          * max(abs(direction),vec3(0.000001));
        vec3 a = (boxMin-uCameraLocal)/safeDirection;
        vec3 b = (boxMax-uCameraLocal)/safeDirection;
        float entry = max(0.0,max(max(min(a.x,b.x),min(a.y,b.y)),min(a.z,b.z)));
        float exitDistance = min(min(max(a.x,b.x),max(a.y,b.y)),max(a.z,b.z));
        if (exitDistance <= entry) discard;
        float stepLength = (exitDistance-entry)/float(uSteps);
        vec3 accumulated = vec3(0.0);
        float alpha = 0.0;
        // Fixed 88 primary taps and three light taps per occupied sample.
        // The bound is a uniform: the compiler cannot unroll it (unrolling 88 copies of the cotton noise took minutes to compile).
        for (int step = 0; step < uSteps; step++) {
          // Per-pixel jitter of the sample positions removes the ray-march banding (concentric rings) on the curved floor.
          float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);
          vec3 p = uCameraLocal+direction*(entry+(float(step)+jitter)*stepLength);
          if (!wet(p)) continue;
          vec3 grid = uvw(p);
          vec4 field = denseAt(grid);
          float rim = 1.0-smoothstep(0.87,0.985,length(p.xz)/uRadius);
          float solid = uFlocOn > 0.5 ? cotton(field,grid,p)*rim : 0.0;
          float source = texture(uOverlap,grid).r;
          if (uDiag > 1.5) {
            // Occupied-cell diagnostic: reads the concentration texture cell by cell, no optics, no normalization.
            ivec3 sz = textureSize(uOverlap,0);
            float cell = texelFetch(uOverlap,clamp(ivec3(grid*vec3(sz)),ivec3(0),sz-ivec3(1)),0).r;
            if (cell > 1e-9) { accumulated += (1.0-alpha)*0.55*vec3(1.0,0.0,0.9); alpha += (1.0-alpha)*0.55; }
            continue;
          }
          if (uDiag > 0.5) {
            // Phase A: the incoming NaCl as a passive tracer, a translucent blue-green volume.
            float tr = clamp(source*2.2,0.0,1.0);
            float a2 = 1.0-exp(-tr*14.0*stepLength/uRadius);
            accumulated += (1.0-alpha)*a2*vec3(0.2,0.75,0.95);
            alpha += (1.0-alpha)*a2;
            continue;
          }
          float mixing = source > 0.015 ? smoothstep(0.015,0.08,source) : 0.0;
          float lit = 1.0, diffuse = 0.5;
          if (solid > 0.01) {
            // Self shadow toward the light and a slope term, as in the cotton lab.
            vec3 toLight = normalize(vec3(0.45,0.7,0.55));
            float sh = 0.0;
            // Cheap lighting from the raw density (no second evaluation of the cotton noise: that made the shader
            // so large that the browser spent minutes compiling it).
            for (int k = 1; k <= 3; k++) { vec3 q3 = p+toLight*uRadius*0.12*float(k); if (wet(q3)) sh += texture(uDense,uvw(q3)).r; }
            lit = exp(-sh*0.55);
            diffuse = clamp(0.5-(texture(uDense,uvw(p+toLight*uRadius*0.07)).r-field.r)*1.2,0.0,1.0);
          }
          // Fine solid shed by the cotton tints the water: bluish white, built up gently.
          float smokeValue = texture(uHaze,grid).r;
          float tintValue = texture(uTint,grid).r;
          float smokeDensity = 0.0, ribbon = 0.0;
          if (uSmokeOn > 0.5 && smokeValue > 0.0004) {
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
          // The smoke layer is switched off by default (customer request); the fine solid stays in the mass balance.
          if (uCloudOn > 0.5 && smokeValue > 0.0005) {
            // Fine suspended AgCl: a volume of scattering particles (extinction = kappa * concentration), modulated by
            // a warped noise so that the cloud has ragged, heterogeneous density instead of a smooth blob.
            vec3 cq = vec3(p.x,p.y-uBottom,p.z)/uRadius;
            vec3 cw = vec3(noise3(cq*1.7+vec3(1.0,4.0,2.0)),noise3(cq*1.7+vec3(7.0,2.0,5.0)),noise3(cq*1.7+vec3(3.0,8.0,6.0)))-0.5;
            float cn = fbm3(cq*vec3(3.2,2.4,3.2)+cw*1.5+vec3(0.0,uTime*0.01,0.0));
            float c = smokeValue*pow(clamp(cn*1.9,0.0,1.6),2.2);
            float a3 = 1.0-exp(-uCloudK*c*stepLength/uRadius);
            float inScatter = 0.78+0.22*clamp(1.0-smokeValue*0.4,0.0,1.0);
            accumulated += (1.0-alpha)*a3*vec3(0.95,0.96,0.98)*inScatter;
            alpha += (1.0-alpha)*a3;
          }
          float hazeAlpha = uSmokeOn * (1.0-exp(-(smokeDensity*uHazeStrength+tintValue*uTintStrength)*stepLength/uRadius));
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
