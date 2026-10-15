import * as THREE from "three";

/**
 * Outlines of a carried item (VL-018) — only its edges, nothing filled in:
 * where it was taken from, every place it may be set down, and, brighter,
 * where it will be if let go now (`HandGhosts`). The item publishes its own
 * shape when taken (`PourMotion`): its glass and cap — not what is in it —
 * relative to its own origin, and where that origin stood.
 */
export const HAND_GHOST = {
  /** The item's meshes, relative to its origin; null — nothing to outline. */
  shape: null as { readonly geometry: THREE.BufferGeometry; readonly matrix: THREE.Matrix4 }[] | null,
  /** Where its origin stood when it was taken (world). */
  from: new THREE.Matrix4(),
  /** Bumped whenever `shape` changes. */
  version: 0,
  /**
   * Where its origin will be, and how it will be turned, pouring into the
   * clamped tube (tipped over its mouth) — published every frame while
   * carried by the item itself (`PourMotion`), from the same `pourPose` its
   * pour runs on. Not valid for an item with no such motion.
   */
  pourPosition: new THREE.Vector3(),
  pourQuaternion: new THREE.Quaternion(),
  posesValid: false,
};

/** The container itself — glass and cap — as opposed to what is in it or on it. */
const OUTLINED = /^(Bottle_Glass|Jar_Glass|Tube_Glass|Cap)\d*$/;
/** A helper mesh (a hover rim) riding inside a model — never part of its shape (`NormalHoverOutline`). */
const NOT_SHAPE = "noOutline";

const inverse = new THREE.Matrix4();

/** Takes the shape of the item standing at `root` (at rest, now). */
export type GhostShape = readonly { readonly geometry: THREE.BufferGeometry; readonly matrix: THREE.Matrix4 }[];

/**
 * The outline shape of the thing at `root` (now), relative to `root`: a
 * container by its glass and cap; anything else (the stand, the lamp) by all
 * it is made of. Null — nothing to outline.
 *
 * @param withoutCap a bottle as it pours: its cap is off, standing aside
 * @param whole all it is made of even if it holds a container (the clamp with its tube)
 */
export function ghostShapeOf(
  root: THREE.Object3D,
  { withoutCap = false, whole: everything = false }: { readonly withoutCap?: boolean; readonly whole?: boolean } = {},
): GhostShape | null {
  root.updateWorldMatrix(true, true);
  inverse.copy(root.matrixWorld).invert();
  const container: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
  const whole: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object.userData[NOT_SHAPE]) return;
    if (withoutCap && /^Cap\d*$/.test(object.name)) return;
    // Not what is never drawn: a hitbox (its material hidden) would outline as a box.
    const material = object.material as THREE.Material | THREE.Material[];
    if (!Array.isArray(material) && !material.visible) return;
    const part = { geometry: object.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld) };
    if (OUTLINED.test(object.name)) container.push(part);
    else if (object.visible) whole.push(part);
  });
  const shape = everything ? [...whole, ...container] : container.length > 0 ? container : whole;
  return shape.length > 0 ? shape : null;
}

export function publishGhostShape(root: THREE.Object3D, options?: { readonly whole?: boolean }): void {
  HAND_GHOST.shape = ghostShapeOf(root, options) as { readonly geometry: THREE.BufferGeometry; readonly matrix: THREE.Matrix4 }[] | null;
  HAND_GHOST.posesValid = false;
  HAND_GHOST.from.copy(root.matrixWorld);
  HAND_GHOST.version += 1;
}

export function clearGhostShape(): void {
  HAND_GHOST.shape = null;
  HAND_GHOST.posesValid = false;
  HAND_GHOST.version += 1;
}

/**
 * Edges only: a narrow Fresnel band where the surface turns away from the
 * eye — the outline of the shape, its face left clear.
 */
export function createGhostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // Set per outline, per frame, by `HandGhosts` (its colour, its brightness).
    uniforms: { color: { value: new THREE.Color() }, opacity: { value: 1 } },
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        float edge = pow(1.0 - clamp(abs(dot(vNormalView, vViewDir)), 0.0, 1.0), 4.0);
        gl_FragColor = vec4(color, edge * opacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
