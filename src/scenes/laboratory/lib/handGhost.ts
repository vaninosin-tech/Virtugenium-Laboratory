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
};

/** The container itself — glass and cap — as opposed to what is in it or on it. */
const OUTLINED = /^(Bottle_Glass|Jar_Glass|Tube_Glass|Cap)\d*$/;

const inverse = new THREE.Matrix4();

export type GhostShape = { readonly geometry: THREE.BufferGeometry; readonly matrix: THREE.Matrix4 }[];

/** The shape of the item standing at `root` (at rest, now), relative to its origin; null — nothing to outline. */
export function extractGhostShape(root: THREE.Object3D): GhostShape | null {
  root.updateWorldMatrix(true, true);
  inverse.copy(root.matrixWorld).invert();
  const shape: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || !OUTLINED.test(object.name)) return;
    shape.push({ geometry: object.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld) });
  });
  return shape.length > 0 ? shape : null;
}

/** Takes the shape of the item standing at `root` (at rest, now). */
export function publishGhostShape(root: THREE.Object3D): void {
  HAND_GHOST.shape = extractGhostShape(root);
  HAND_GHOST.from.copy(root.matrixWorld);
  HAND_GHOST.version += 1;
}

export function clearGhostShape(): void {
  HAND_GHOST.shape = null;
  HAND_GHOST.version += 1;
}

export type GhostTone = "from" | "place" | "now" | "use";

const TONES: Record<GhostTone, { readonly color: string; readonly opacity: number }> = {
  from: { color: "#e2e8f0", opacity: 1.1 },
  place: { color: "#60a5fa", opacity: 0.9 },
  now: { color: "#3b82f6", opacity: 2.6 },
  /** A hover preview of where the item is USED (`ItemPreviewLayer`): warmer than the blue «put here». */
  use: { color: "#34d399", opacity: 1.8 },
};

/**
 * Edges only: a narrow Fresnel band where the surface turns away from the
 * eye — the outline of the shape, its face left clear.
 */
export function createGhostMaterial(tone: GhostTone): THREE.ShaderMaterial {
  const { color, opacity } = TONES[tone];
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color).multiplyScalar(2) }, opacity: { value: opacity } },
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
