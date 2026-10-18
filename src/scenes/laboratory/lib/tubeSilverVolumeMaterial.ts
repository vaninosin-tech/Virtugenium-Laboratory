import * as THREE from "three";
import { SILVER_FINE_OPTICS as optics, SILVER_AGGREGATE_OPTICS as agg } from "./night/render/silverOpticsReference";

// GLSL needs float literals: a bare 5 would be an int and break float multiplication.
const glf = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

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
      uAggregate: { value: dense ?? emptyHaze() }, uSolidMode: { value: 0 },
      uHaze: { value: emptyHaze() }, uTint: { value: emptyHaze() }, uChip: { value: emptyHaze() }, uHazeStrength: { value: 9.0 }, uSteps: { value: optics.steps }, uNoise: { value: noiseVolume() },
      uTintStrength: { value: 6.0 }, uSmokeOn: { value: 0 }, uDiag: { value: 0 }, uCloudOn: { value: 0 },
      uCloudK: { value: optics.kappa }, uAlbedo: { value: optics.albedo },
      uLightDirection: { value: new THREE.Vector3(...optics.lightDirection).normalize() },
      uLightStrength: { value: optics.lightStrength }, uAmbient: { value: optics.ambient },
      uAmbientBoost: { value: optics.ambientBoost }, uAnisotropy: { value: optics.anisotropy },
      uOpticsMode: { value: 0 }, uFlocOn: { value: 1 }, uTime: { value: 0 },
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
      uniform sampler3D uDense, uOverlap, uHaze, uTint, uChip, uNoise, uAggregate;
      uniform float uHazeStrength, uTintStrength, uTime;
      uniform int uSteps;
      uniform float uSmokeOn, uDiag, uCloudOn, uCloudK, uFlocOn;
      uniform float uAlbedo, uLightStrength, uAmbient, uAmbientBoost, uAnisotropy;
      uniform vec3 uLightDirection;
      uniform int uOpticsMode, uSolidMode;
      in vec3 vPoint;
      out vec4 outColor;
      // Value noise from a periodic 64^3 texture (see noiseVolume): one tap per lookup.
      float noise3(vec3 p) { return texture(uNoise, p*(1.0/64.0)).r; }
      float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a*noise3(p); p = p*2.03+vec3(1.7,9.2,3.1); a *= 0.5; } return s; }
      float billow3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a*abs(2.0*noise3(p)-1.0); p = p*2.1+vec3(5.3,1.1,7.7); a *= 0.5; } return s; }
      // Fibre noise changes extinction by at most 8%; it never changes the field silhouette.
      float aggregateGrain(vec3 grid, vec4 field) {
        vec3 q = grid * vec3(textureSize(uAggregate,0));
        float phase = ${glf(agg.grainCyclesPerCell)} * 6.28318530718;
        float orientation = field.a;
        return 1.0 + ${glf(agg.grainAmount)} * field.g *
          sin(phase * dot(q,vec3(1.0,0.37+orientation*0.2,0.19))) *
          sin(phase * dot(q,vec3(0.23,-0.41,1.0)));
      }
      vec3 uvw(vec3 p) { return vec3(p.x/(2.0*uRadius)+0.5,
        (p.y-uBottom)/uHeight, p.z/(2.0*uRadius)+0.5); }
      bool wet(vec3 p) {
        float radial = length(p.xz);
        float bowl = uBottom+uRadius-sqrt(max(0.0,uRadius*uRadius-radial*radial));
        return radial < uRadius*0.985 && p.y >= bowl && dot(uUp,p) <= uLevel + 0.0035;
      }
      float cloudGrain(vec3 grid) {
        vec3 q = grid * vec3(textureSize(uHaze,0));
        float f = ${glf(optics.grainCyclesPerCell)} * 6.28318530718;
        return 1.0 + ${glf(optics.grainAmount)} * sin(f * dot(q,vec3(1.0,0.37,0.19)))
          * sin(f * dot(q,vec3(0.23,-0.41,1.0)));
      }
      float cloudSource(vec3 p, float c, vec3 towardCamera) {
        float lightDepth = 0.0;
        for (int k = 1; k <= ${optics.lightTaps}; k++) {
          vec3 q = p + uLightDirection * uRadius * ${glf(optics.lightTapDistance)} * float(k);
          if (wet(q)) lightDepth += texture(uHaze,uvw(q)).r * uCloudK * ${glf(optics.lightTapDistance)};
        }
        float angle = clamp(dot(uLightDirection,towardCamera),-1.0,1.0);
        float phase = ${glf(optics.isotropicFloor)} + ${glf(1 - optics.isotropicFloor)} *
          (1.0 + uAnisotropy * angle) / (1.0 + uAnisotropy);
        float localDepth = uCloudK * c * ${glf(optics.lightTapDistance)};
        float ambient = uAmbient + uAmbientBoost * (1.0-exp(-2.0*localDepth));
        return min(uLightStrength+uAmbient+uAmbientBoost,
          uAlbedo*(ambient+uLightStrength*phase*exp(-lightDepth)));
      }
      float aggregateSource(vec3 p, float c, vec3 towardCamera) {
        float depth = 0.0;
        for (int k = 1; k <= ${agg.lightTaps}; k++) {
          vec3 q = p + uLightDirection*uRadius*${glf(agg.lightTapDistance)}*float(k);
          if (wet(q)) depth += texture(uAggregate,uvw(q)).r*${glf(agg.kappa * agg.lightTapDistance)};
        }
        float angle = clamp(dot(uLightDirection,towardCamera),-1.0,1.0);
        float phase = ${glf(optics.isotropicFloor)} + ${glf(1 - optics.isotropicFloor)}*
          (1.0+uAnisotropy*angle)/(1.0+uAnisotropy);
        float ambient = uAmbient + uAmbientBoost*(1.0-exp(-2.0*c));
        float light = uLightStrength*phase*exp(-depth);
        float multiple = ${glf(agg.multipleScatter)}*uLightStrength*(1.0-exp(-depth));
        return min(uLightStrength+uAmbient+uAmbientBoost,
          ${glf(agg.albedo)}*(ambient+light+multiple));
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
        if (uSolidMode == 3) discard; // Sediment is the height-field mesh, never volume mass.
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
          vec4 field = uSolidMode != 1 && uFlocOn > 0.5 ? texture(uAggregate,grid) : vec4(0.0);
          float source = uDiag > 0.5 ? texture(uOverlap,grid).r : 0.0;
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
          // Fine solid shed by the cotton tints the water: bluish white, built up gently.
          float smokeValue = uSolidMode != 2 ? texture(uHaze,grid).r : 0.0;
          float tintValue = uSmokeOn > 0.5 ? texture(uTint,grid).r : 0.0;
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
          float chipValue = 0.0;
          if (uSmokeOn > 0.5 && uOpticsMode == 0) chipValue = texture(uChip,grid).r;
          if (uSmokeOn > 0.5 && uOpticsMode == 0 && chipValue > 0.0004) {
            // Irregular flakes: a warped, lower-frequency noise thresholded high so only a few survive.
            vec3 cq = vec3(p.x,p.y-uBottom,p.z)/uRadius*7.0;
            vec3 cw = vec3(noise3(cq*0.7+vec3(1.0,2.0,3.0)),noise3(cq*0.7+vec3(7.0,5.0,1.0)),noise3(cq*0.7+vec3(4.0,9.0,6.0)))-0.5;
            float speck = smoothstep(0.80,0.84,noise3(cq+cw*1.4+vec3(3.0,1.0,5.0)));
            float chipAlpha = 1.0-exp(-speck*smoothstep(0.004,0.03,chipValue)*40.0*stepLength/uRadius);
            accumulated += (1.0-alpha)*chipAlpha*vec3(0.96,0.97,0.98);
            alpha += (1.0-alpha)*chipAlpha;
          }
          // The two physical populations occupy the same step. Mix their source
          // radiances by optical depth before compositing, so opaque fine milk
          // cannot systematically hide a dense aggregate in that same voxel.
          float fineTau = 0.0, aggregateTau = 0.0;
          vec3 fineColor = vec3(0.0), aggregateColor = vec3(0.0);
          if (uSolidMode != 2 && uCloudOn > 0.5 && smokeValue > 0.0) {
            if (uOpticsMode == 1) {
              // Raw concentration colormap; no grain or light transport.
              fineTau = min(1.0,smokeValue)*${glf(optics.rawScale)}*stepLength/uRadius;
              fineColor = vec3(clamp(smokeValue,0.0,1.0),0.12,1.0-clamp(smokeValue,0.0,1.0));
            } else {
              float c = smokeValue*cloudGrain(grid);
              fineTau = uCloudK*c*stepLength/uRadius;
              float sourceLight = uOpticsMode == 2 ? ${glf(optics.extinctionGrey)} : cloudSource(p,c,-direction);
              fineColor = vec3(sourceLight);
            }
          }
          if (uSolidMode != 1 && uFlocOn > 0.5 && field.r > 0.0) {
            float porous = (1.0-${glf(agg.loosePorosity)}*clamp(field.g,0.0,1.0))
              * (0.85+0.15*clamp(field.b,0.0,1.0));
            float c = field.r*porous*aggregateGrain(grid,field);
            aggregateTau = ${glf(agg.kappa)}*c*stepLength/uRadius;
            if (uOpticsMode == 1) {
              float raw = clamp(field.r,0.0,1.0);
              aggregateTau = raw*${glf(optics.rawScale)}*stepLength/uRadius;
              aggregateColor = vec3(raw,0.12,1.0-raw);
            } else {
              float light = uOpticsMode == 2 ? ${glf(optics.extinctionGrey)} : aggregateSource(p,c,-direction);
              aggregateColor = vec3(light);
            }
          }
          float solidTau = fineTau + aggregateTau;
          if (solidTau > 0.0) {
            float solidAlpha = 1.0-exp(-solidTau);
            accumulated += (1.0-alpha)*solidAlpha*(fineTau*fineColor+aggregateTau*aggregateColor)/solidTau;
            alpha += (1.0-alpha)*solidAlpha;
          }
          if (uOpticsMode != 0) { if (alpha >= ${glf(optics.alphaStop)}) break; else continue; }
          float hazeAlpha = uSmokeOn * (1.0-exp(-(smokeDensity*uHazeStrength+tintValue*uTintStrength)*stepLength/uRadius));
          accumulated += (1.0-alpha)*hazeAlpha*mix(vec3(0.34,0.44,0.58),vec3(0.74,0.82,0.92),clamp(ribbon*3.0,0.0,1.0));
          alpha += (1.0-alpha)*hazeAlpha;
          if (alpha >= ${glf(optics.alphaStop)}) break;
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
