import { useMemo } from "react";
import * as THREE from "three";

const HOVER_RIM_COLOR = new THREE.Color("#2F80ED");

/** Only the cabinet's outer carcass/shell gets the rim — doors, frames, glass, handles, hinges, labels, and the control panel are deliberately excluded so hover reads as one soft highlight, not a per-part effect. */
const STRUCTURAL_SHELL_NAMES = new Set([
  "Cabinet_Body",
  "SidePost_Left",
  "SidePost_Right",
  "ServiceColumn",
  "ColumnTop_Closure",
  "ShelfTop_Closure",
  "UpperLower_Separator",
]);

/** Local-space transform of `node` relative to `root`, from each ancestor's own `.matrix` — correct immediately on mount regardless of scene-graph commit order. */
function relativeMatrix(node: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 {
  const chain: THREE.Matrix4[] = [];
  for (let current: THREE.Object3D | null = node; current && current !== root; current = current.parent) {
    chain.push(current.matrix);
  }
  const result = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    result.multiply(chain[i]);
  }
  return result;
}

const rimMaterial = new THREE.ShaderMaterial({
  uniforms: { color: { value: HOVER_RIM_COLOR }, opacity: { value: 0.8 } },
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
      float fresnel = pow(1.0 - clamp(dot(vNormalView, vViewDir), 0.0, 1.0), 3.0);
      gl_FragColor = vec4(color, fresnel * opacity);
    }
  `,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
  side: THREE.FrontSide,
});

/**
 * Non-destructive hover rim: a duplicate mesh per structural-shell surface
 * (original GLTF material/mesh untouched), rendered with a soft
 * view-angle Fresnel shader in the hover color, additive + depth-tested (no
 * x-ray — real geometry still occludes it normally). Only visible while
 * `active`; the soft *outer* halo is the separate Selection/Outline
 * postprocessing pass in Laboratory.tsx — this is just the on-surface half.
 */
export function HoverFresnelRim({ object, active }: { readonly object: THREE.Object3D | null; readonly active: boolean }) {
  const group = useMemo(() => {
    if (!object) return null;
    const g = new THREE.Group();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    object.traverse((child) => {
      if (child instanceof THREE.Mesh && STRUCTURAL_SHELL_NAMES.has(child.name)) {
        const rim = new THREE.Mesh(child.geometry, rimMaterial);
        relativeMatrix(child, object).decompose(pos, quat, scale);
        rim.position.copy(pos);
        rim.quaternion.copy(quat);
        rim.scale.copy(scale);
        rim.renderOrder = 10;
        g.add(rim);
      }
    });
    return g;
  }, [object]);

  if (!group) return null;
  group.visible = active;
  return <primitive object={group} />;
}
