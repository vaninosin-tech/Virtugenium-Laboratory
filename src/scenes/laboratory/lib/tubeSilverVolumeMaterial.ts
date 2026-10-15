import * as THREE from "three";

/** One bounded ray-marched volume for the conserved dense field and its source. */
export function makeSilverVolumeMaterial(radius: number, bottom: number, height: number,
  dense?: THREE.Data3DTexture, overlap?: THREE.Data3DTexture) {
  const camera = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uCameraLocal: camera, uRadius: { value: radius },
      uBottom: { value: bottom }, uHeight: { value: height }, uLevel: { value: bottom },
      uDense: { value: dense }, uOverlap: { value: overlap },
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
      uniform sampler3D uDense, uOverlap;
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
      float gShade = 1.0;
      float cotton(vec4 field, vec3 grid, vec3 position) {
        if (field.r <= 0.0) return 0.0;
        // Current physical coordinates keep every octave isotropic. Transported
        // birth coordinates only bend the broad clumps, with bounded stretch.
        // Birth coordinates vary cell by cell where the mass is dilute and printed
        // a lattice; the shift is therefore faded in only inside solid cores.
        vec3 materialShift = clamp((field.gba-grid)*vec3(2.0,uHeight/uRadius,2.0),
          vec3(-0.12),vec3(0.12))*smoothstep(0.6,2.5,field.r);
        vec3 q = vec3(position.x,position.y-uBottom,position.z)/uRadius;
        vec3 broad = q + materialShift;
        vec3 warp = vec3(noise3(broad*1.25+vec3(3.1,7.2,1.7)),
          noise3(broad*1.35+vec3(9.7,2.3,5.1)),
          noise3(broad*1.18+vec3(4.8,8.4,2.7)))-0.5;
        broad += warp*0.32;
        float lobe = noise3(broad*1.05);
        float fold = noise3(broad*2.5+vec3(4.0,1.0,8.0));
        vec3 fibre = q + warp*0.07;
        float shred = noise3(fibre*7.0+vec3(8.0,3.0,5.0));
        float hair = noise3(fibre*17.0+vec3(1.0,6.0,9.0));
        float concentration = field.r/(field.r+0.23);
        // Broad gaps persist even when the field contains conserved dilute
        // material. Folds and fine erosion never align to the grid axes.
        float massive = noise3(broad*0.55+vec3(2.0,5.0,7.0));
        float height = 0.50*lobe+0.22*fold+0.28*massive+0.14*concentration;
        // Same broad field one step toward the light: its slope lights folds.
        vec3 toLight = vec3(0.42,0.78,0.36)*0.22;
        float heightLit = 0.50*noise3((broad+toLight)*1.05)+0.22*noise3((broad+toLight)*2.5+vec3(4.0,1.0,8.0))
          +0.28*noise3((broad+toLight)*0.55+vec3(2.0,5.0,7.0))+0.14*concentration;
        gShade = clamp(0.55+(height-heightLit)*5.0,0.0,1.0);
        float clump = smoothstep(0.50,0.63,height);
        float torn = smoothstep(0.30,0.66,
          0.46*fold+0.34*shred+0.20*hair);
        float core = smoothstep(0.12,0.45,concentration);
        // Erosion acts on the rim only: dense cores stay solid.
        float rimWeight = 1.0-smoothstep(0.30,0.80,concentration+0.25*lobe);
        return smoothstep(0.07,0.26,field.r)*clump
          * mix(1.0,torn,rimWeight)*(0.62+0.38*core);
      }
      vec3 uvw(vec3 p) { return vec3(p.x/(2.0*uRadius)+0.5,
        (p.y-uBottom)/uHeight, p.z/(2.0*uRadius)+0.5); }
      bool wet(vec3 p) {
        float radial = length(p.xz);
        float bowl = uBottom+uRadius-sqrt(max(0.0,uRadius*uRadius-radial*radial));
        return radial < uRadius*0.985 && p.y >= bowl && dot(uUp,p) <= uLevel;
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
          float shadow = 0.0;
          if (solid > 0.003) {
            for (int lightStep = 1; lightStep <= 3; lightStep++) {
              vec3 lit = p + vec3(0.42,0.78,0.36)*float(lightStep)*uRadius*0.18;
              if (wet(lit)) shadow += texture(uDense,uvw(lit)).r;
            }
          }
          float localAlpha = 1.0-exp(-(solid*30.0+mixing*0.012)*stepLength/uRadius);
          vec3 color = mix(vec3(0.91,0.93,0.91),
            vec3(1.0,0.998,0.99)*clamp(1.0-shadow*0.34,0.58,1.0)*(0.66+0.34*gShade),
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
