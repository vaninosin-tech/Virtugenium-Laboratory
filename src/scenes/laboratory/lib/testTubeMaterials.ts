import * as THREE from "three";
import { deferDispose } from "./deferredDispose";

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
  material.userData.cracked = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTubeCracked = material.userData.cracked;
    shader.uniforms.uTubeBottom = { value: bounds.min.y };
    shader.uniforms.uTubeHeight = { value: Math.max(bounds.max.y - bounds.min.y, 0.001) };
    shader.vertexShader = `uniform float uTubeBottom;
uniform float uTubeHeight;
varying float vTubeHeight;
varying vec3 vTubePosition;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vTubePosition = position;
vTubeHeight = (position.y - uTubeBottom) / uTubeHeight;`);
    shader.fragmentShader = `uniform float uTubeCracked;
varying vec3 vTubePosition;
varying float vTubeHeight;
${shader.fragmentShader}`.replace("#include <opaque_fragment>", `
// Keep the face see-through; concentrate contrast at grazing angles and
// at the thicker rolled lip/rounded base. This is surface colour, not emission.
float tubeEdge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
float tubeLip = smoothstep(0.955, 0.99, vTubeHeight);
float tubeBase = 1.0 - smoothstep(0.025, 0.10, vTubeHeight);
float tubeThickness = max(tubeLip, tubeBase);
diffuseColor.a = clamp(0.10 + 0.66 * tubeEdge + 0.24 * tubeThickness, 0.10, 0.86);
vec3 tubeTint = mix(vec3(0.78, 0.88, 0.92), vec3(0.13, 0.24, 0.29),
  clamp(tubeEdge * 0.85 + tubeThickness * 0.35, 0.0, 1.0));
outgoingLight = totalDiffuse * tubeTint + totalSpecular / max(diffuseColor.a, 0.10);
// Wrap the path around the wall so it survives changes in viewing angle.
float angle = atan(vTubePosition.z, vTubePosition.x);
float jag = abs(fract(angle * 2.2 + 0.5) - 0.5);
float path = vTubeHeight - (0.29 + 0.15 * jag + 0.025 * sin(angle * 13.0));
float lineWidth = max(fwidth(path), 0.0018);
float mainCrack = 1.0 - smoothstep(lineWidth, lineWidth * 2.5, abs(path));
float branchPath = angle - 0.8 - (vTubeHeight - 0.35) * 5.0 - 0.06 * sin(vTubeHeight * 100.0);
float branch = (1.0 - smoothstep(0.015, 0.04, abs(branchPath))) *
  smoothstep(0.3, 0.35, vTubeHeight) * (1.0 - smoothstep(0.52, 0.56, vTubeHeight));
float crack = max(mainCrack, branch) * uTubeCracked;
outgoingLight = mix(outgoingLight, vec3(0.07, 0.13, 0.16), crack);
diffuseColor.a = max(diffuseColor.a, crack * 0.95);
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => "test-tube-clear-contour-crack-v2";
  return material;
}

/** Clear walls with reflective edges, including through other transparent glass. */
export function prepareTestTube(scene: THREE.Object3D) {
  const materials: THREE.Material[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.name.startsWith("ContentsVolume")) {
      object.visible = false;
      return;
    }
    if (!object.name.startsWith("Tube_Glass")) return;
    const glass = createTestTubeGlass(object.geometry);
    object.material = glass;
    // Shadow maps treat transparent meshes as opaque silhouettes.
    object.castShadow = false;
    object.receiveShadow = false;
    materials.push(glass);
  });
  return () => materials.forEach((material) => deferDispose(material, () => material.dispose()));
}
