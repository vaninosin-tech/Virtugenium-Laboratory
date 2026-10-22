import * as THREE from "three";
import { deferDispose } from "./deferredDispose";
import { createExteriorGlassGeometry } from "./reagentMaterials";

function createGlassBackdropMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: "#ffffff", roughness: 0, metalness: 0, ior: 1.47,
    transmission: 1, thickness: 0.001, depthWrite: false, side: THREE.FrontSide,
  });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
vec2 glassUv = gl_FragCoord.xy / transmissionSamplerSize;
vec2 glassBend = vec2(vNormal.x * 4.0, 0.0) / transmissionSamplerSize;
vec3 glassBackground = texture2D(transmissionSamplerMap,
  clamp(glassUv + glassBend, vec2(0.001), vec2(0.999))).rgb * 1.32;
gl_FragColor = vec4(glassBackground, 1.0);`);
  };
  material.customProgramCacheKey = () => "tube-glass-backdrop-v1";
  return material;
}

/** Thin clear glass needs a readable silhouette even against a pale shelf. */
function createTestTubeGlass(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const material = new THREE.MeshPhysicalMaterial({
    name: "TestTubeClearGlass",
    color: "#ffffff", metalness: 0, roughness: 0.025, ior: 1.47,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    envMapIntensity: 0.8,
  });
  // CrackSpot: local-Z side (-1..1), full-tube height (0..1); -1 means intact.
  material.userData.crackSpot = { value: new THREE.Vector2(0, -1) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTubeCrackSpot = material.userData.crackSpot;
    shader.uniforms.uTubeCenter = { value: new THREE.Vector2(
      (bounds.min.x + bounds.max.x) * 0.5, (bounds.min.z + bounds.max.z) * 0.5,
    ) };
    shader.uniforms.uTubeRadius = {
      value: Math.max((bounds.max.x - bounds.min.x + bounds.max.z - bounds.min.z) * 0.25, 0.0001),
    };
    shader.uniforms.uTubeBottom = { value: bounds.min.y };
    shader.uniforms.uTubeHeight = { value: Math.max(bounds.max.y - bounds.min.y, 0.001) };
    shader.vertexShader = `uniform float uTubeBottom;
uniform float uTubeHeight;
varying float vTubeHeight;
varying vec3 vTubePosition;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vTubePosition = position;
vTubeHeight = (position.y - uTubeBottom) / uTubeHeight;`);
    shader.fragmentShader = `uniform vec2 uTubeCrackSpot;
uniform vec2 uTubeCenter;
uniform float uTubeRadius;
uniform float uTubeHeight;
varying vec3 vTubePosition;
varying float vTubeHeight;
float tubeCrackSegment(vec2 p, vec2 a, vec2 b) {
  vec2 edge = b - a;
  return length(p - a - edge * clamp(dot(p - a, edge) / dot(edge, edge), 0.0, 1.0));
}
float tubeCrackRay(vec2 p, vec2 a, vec2 b, vec2 c) {
  return min(tubeCrackSegment(p, vec2(0.0), a),
    min(tubeCrackSegment(p, a, b), tubeCrackSegment(p, b, c)));
}
${shader.fragmentShader}`.replace("#include <opaque_fragment>", `
// Keep the face see-through; concentrate contrast at grazing angles and
// at the thicker rolled lip/rounded base. This is surface colour, not emission.
float tubeEdge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
float tubeLip = smoothstep(0.955, 0.99, vTubeHeight);
float tubeBase = 1.0 - smoothstep(0.025, 0.10, vTubeHeight);
float tubeThickness = max(tubeLip, tubeBase);
float tubeRim = smoothstep(0.80, 0.94, 1.0 - abs(dot(normal, normalize(vViewPosition))));
vec2 tubeRadialOffset = vTubePosition.xz - uTubeCenter;
vec2 tubeRadialLine = tubeRadialOffset / max(length(tubeRadialOffset), 0.0001);
float tubeStripe = exp(-pow((tubeRadialLine.y - 0.38) / 0.075, 2.0))
  * smoothstep(0.07, 0.18, vTubeHeight) * (1.0 - smoothstep(0.91, 0.97, vTubeHeight));
float tubeLipLine = smoothstep(0.965, 0.982, vTubeHeight) * (1.0 - smoothstep(0.994, 1.0, vTubeHeight));
float tubeBaseLine = (1.0 - smoothstep(0.06, 0.12, vTubeHeight)) * tubeRim;
diffuseColor.a = clamp(0.08 + 0.47 * tubeEdge + 0.24 * tubeThickness
  + 0.19 * tubeRim + 0.18 * tubeStripe + 0.16 * max(tubeLipLine, tubeBaseLine), 0.08, 0.88);
vec3 tubeTint = mix(vec3(0.78, 0.88, 0.92), vec3(0.13, 0.24, 0.29),
  clamp(tubeEdge * 0.85 + tubeThickness * 0.35, 0.0, 1.0));
outgoingLight = totalDiffuse * tubeTint + totalSpecular / max(diffuseColor.a, 0.10);
outgoingLight += vec3(0.52, 0.67, 0.71) * (0.44 * tubeRim + 0.58 * tubeStripe
  + 0.32 * max(tubeLipLine, tubeBaseLine));
// The hood/stand rotations put the close-up on local +X. asin(side)
// anchors z = side * surfaceRadius, x = +sqrt(radius^2 - z^2), including
// the narrower rounded base. Signed angular distance avoids a mirrored
// mark on the rear wall; the finite paths never encircle the tube.
float crack = 0.0;
if (uTubeCrackSpot.y >= 0.0) {
vec2 tubeRadial = vTubePosition.xz - uTubeCenter;
float angle = atan(tubeRadial.y, tubeRadial.x);
float crackAngle = asin(clamp(uTubeCrackSpot.x, -1.0, 1.0));
float angleDelta = atan(sin(angle - crackAngle), cos(angle - crackAngle));
vec2 crackPoint = vec2(angleDelta,
  (vTubeHeight - uTubeCrackSpot.y) * uTubeHeight / uTubeRadius);
// Coordinates are in tube radii: a small six-point star feeding irregular,
// connected zigzags, with two finer forks branching off existing junctions.
float crackDistance = tubeCrackRay(crackPoint,
  vec2(0.10, 0.19), vec2(0.02, 0.59), vec2(0.29, 1.42));
crackDistance = min(crackDistance, tubeCrackRay(crackPoint,
  vec2(-0.16, 0.13), vec2(-0.42, 0.31), vec2(-0.68, 0.78)));
crackDistance = min(crackDistance, tubeCrackRay(crackPoint,
  vec2(0.18, 0.02), vec2(0.41, 0.22), vec2(0.76, 0.12)));
crackDistance = min(crackDistance, tubeCrackRay(crackPoint,
  vec2(0.09, -0.16), vec2(0.30, -0.33), vec2(0.23, -0.81)));
crackDistance = min(crackDistance, tubeCrackRay(crackPoint,
  vec2(-0.11, -0.19), vec2(-0.08, -0.43), vec2(-0.36, -0.98)));
crackDistance = min(crackDistance, tubeCrackRay(crackPoint,
  vec2(-0.20, -0.02), vec2(-0.38, -0.19), vec2(-0.66, -0.15)));
float forkDistance = min(
  tubeCrackSegment(crackPoint, vec2(0.02, 0.59), vec2(-0.18, 0.80)),
  tubeCrackSegment(crackPoint, vec2(-0.18, 0.80), vec2(-0.12, 1.10)));
forkDistance = min(forkDistance, min(
  tubeCrackSegment(crackPoint, vec2(0.30, -0.33), vec2(0.49, -0.42)),
  tubeCrackSegment(crackPoint, vec2(0.49, -0.42), vec2(0.57, -0.65))));
float crackAA = max(fwidth(crackDistance), 0.004);
float forkAA = max(fwidth(forkDistance), 0.004);
float mainCrack = 1.0 - smoothstep(0.012, 0.012 + crackAA, crackDistance);
float fork = 1.0 - smoothstep(0.007, 0.007 + forkAA, forkDistance);
crack = max(mainCrack, fork * 0.8);
// Bound even derivative-based antialiasing to a single patch at silhouettes.
crack *= 1.0 - smoothstep(0.85, 1.0, abs(angleDelta));
}
outgoingLight = mix(outgoingLight, vec3(0.07, 0.13, 0.16), crack);
diffuseColor.a = max(diffuseColor.a, crack * 0.95);
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => "test-tube-clear-contour-crack-v4";
  return material;
}

/** Clear walls with reflective edges, including through other transparent glass. */
export function prepareTestTube(scene: THREE.Object3D, withBackdrop = false) {
  const materials: THREE.Material[] = [];
  const backdropGeometry: THREE.BufferGeometry[] = [];
  const backdrops: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.name.startsWith("ContentsVolume")) {
      object.visible = false;
      return;
    }
    if (!object.name.startsWith("Tube_Glass")) return;
    const glass = createTestTubeGlass(object.geometry);
    object.material = glass;
    if (withBackdrop) {
      const geometry = createExteriorGlassGeometry(object.geometry);
      const backdrop = new THREE.Mesh(geometry, createGlassBackdropMaterial());
      backdrop.name = "TubeGlassRefractedBackdrop";
      backdrop.visible = false;
      backdrop.renderOrder = -1;
      backdrop.raycast = () => {};
      object.add(backdrop);
      backdrops.push(backdrop);
      backdropGeometry.push(geometry);
      materials.push(backdrop.material);
    }
    // Shadow maps treat transparent meshes as opaque silhouettes.
    object.castShadow = false;
    object.receiveShadow = false;
    materials.push(glass);
  });
  return () => {
    backdrops.forEach(mesh => mesh.removeFromParent());
    materials.forEach(material => deferDispose(material, () => material.dispose()));
    backdropGeometry.forEach(geometry => deferDispose(geometry, () => geometry.dispose()));
  };
}
