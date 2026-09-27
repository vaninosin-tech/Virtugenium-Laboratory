import * as THREE from "three";

/** Matte wall paint: keep diffuse illumination and shadows, suppress glossy light patches. */
export function createWallLightingMaterial(source: THREE.MeshStandardMaterial) {
  const material = source.clone();
  material.roughness = 1;
  material.metalness = 0;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `// Wall paint has no visible mirror reflection of studio/ceiling panels.
outgoingLight = totalDiffuse + totalEmissiveRadiance;
#include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => "laboratory-matte-wall-lighting-v1";
  return material;
}
