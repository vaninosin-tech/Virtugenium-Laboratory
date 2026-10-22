import * as THREE from "three";

/** Satin steel keeps the broad tray floor from washing out under room IBL. */
export function prepareTrayMaterials(root: THREE.Object3D) {
  const restore: (() => void)[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.name !== "Tray_Body") return;
    const original = object.material;
    const owned: THREE.Material[] = [];
    const tune = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const material = source.clone();
      material.color.multiplyScalar(0.28);
      material.metalness = 1;
      material.roughness = 0.64;
      material.envMapIntensity = 0.35;
      owned.push(material);
      return material;
    };
    object.material = Array.isArray(original) ? original.map(tune) : tune(original);
    restore.push(() => {
      object.material = original;
      owned.forEach((material) => material.dispose());
    });
  });
  return () => restore.forEach((cleanup) => cleanup());
}
