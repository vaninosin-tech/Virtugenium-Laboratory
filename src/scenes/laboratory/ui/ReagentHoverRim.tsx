import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

// Same blue as the shared cabinet Outline (`Laboratory.tsx`), scaled up
// since AdditiveBlending needs real punch to read against bright white lab
// geometry — this IS the whole hover cue for reagents now (postprocessing
// `Outline`/`Select` proved too fragile: transparent-glass depth-write
// quirks, pixelated at low intensity, garish at high intensity, and hard to
// verify live at all given this session's environment issues). A simple
// on-object glow has none of those dependencies — it just renders.
const HOVER_RIM_COLOR = new THREE.Color("#1D4ED8").multiplyScalar(3);
const REFUSED_RIM_COLOR = new THREE.Color("#DC2626").multiplyScalar(3);

/** Local-space transform of `node` relative to `root`, from each ancestor's own `.matrix` — same technique as `HoverFresnelRim`. */
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

const DEFAULT_RIM_OPACITY = 2.2;

/** Builds one rim `ShaderMaterial` at the given peak opacity — factored out of the module-level default so a single caller can ask for a dimmer (or brighter) rim via `ReagentHoverRim`'s `opacity` prop without touching the shared material every other caller still renders with. */
function createRimMaterial(opacity: number, color: THREE.Color = HOVER_RIM_COLOR): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // Pure Fresnel edge glow — no flat fill across the face. Lower power than
    // the original (3.0 → 1.5) widens the glowing band near the silhouette,
    // and the brightness bump is mostly in `HOVER_RIM_COLOR`/`opacity`.
    uniforms: { color: { value: color }, opacity: { value: opacity } },
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
        float fresnel = pow(1.0 - clamp(dot(vNormalView, vViewDir), 0.0, 1.0), 1.5);
        gl_FragColor = vec4(color, fresnel * opacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

const rimMaterial = createRimMaterial(DEFAULT_RIM_OPACITY);

/**
 * Same non-destructive Fresnel-rim technique as `HoverFresnelRim`, but for a
 * reagent container: every VISIBLE mesh in the instance joins the rim
 * (glass, cap, label, and contents when shown) so hover reads as one
 * unified silhouette around the whole bottle/jar, not a per-part effect —
 * unlike the cabinet rim, there's no structural-shell name filter here
 * because a reagent container has no "internal" parts to exclude by name.
 * Invisible meshes ARE skipped though: this component is shared with test
 * tubes (`LabTestTubeCabinetInstance`), whose `ContentsVolume` is hidden by
 * `prepareTestTube` while empty — without this check that hidden liquid
 * mesh still rendered its own glowing rim on hover.
 */
/** A reagent container's glass — the bottle itself, as opposed to what is in it or on it. */
const CONTAINER_GLASS = /^(Bottle_Glass|Jar_Glass)\d*$/;
const CONTAINER_CAP = /^Cap\d*$/;

export function ReagentHoverRim({
  object,
  active,
  opacity,
  tone = "normal",
  containerOnly = false,
}: {
  readonly object: THREE.Object3D | null;
  readonly active: boolean;
  /** Overrides the default peak Fresnel opacity (2.2) for THIS instance only — every other `ReagentHoverRim` keeps sharing the one default `rimMaterial`. */
  readonly opacity?: number;
  /** "refused" — red: what the player is aiming at cannot be done (VL-015). */
  readonly tone?: "normal" | "refused";
  /**
   * A reagent bottle or jar (VL-018): outline only its glass — not the liquid
   * or powder in it — and its cap only while the cap is on it (taken off to
   * pour, it stands aside on the table and is not outlined).
   */
  readonly containerOnly?: boolean;
}) {
  const material = useMemo(
    () =>
      opacity === undefined && tone === "normal"
        ? rimMaterial
        : createRimMaterial(opacity ?? DEFAULT_RIM_OPACITY, tone === "refused" ? REFUSED_RIM_COLOR : HOVER_RIM_COLOR),
    [opacity, tone],
  );
  useEffect(() => {
    if (material === rimMaterial) return;
    return () => material.dispose();
  }, [material]);

  const { group, caps } = useMemo(() => {
    const caps: { cap: THREE.Object3D; seat: THREE.Vector3; rim: THREE.Mesh }[] = [];
    if (!object) return { group: null, caps };
    const g = new THREE.Group();
    // `object` (the container clone) is itself recentered off local origin —
    // see `ReagentContainerInstance`'s bbox-centering fix, which shifts
    // `clone.position.x/z` so the VISUAL center lands on the wrapping
    // group's origin. This rim group is rendered as `object`'s SIBLING (not
    // its child), so without copying that same offset here, every rim mesh
    // — each already positioned relative to `object`, via `relativeMatrix`
    // below — would be missing `object`'s own offset and float away from
    // the actual bottle by exactly that amount.
    g.position.copy(object.position);
    g.quaternion.copy(object.quaternion);
    g.scale.copy(object.scale);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    object.traverse((child) => {
      // Skip meshes hidden by their own material/content logic (e.g. an
      // empty test tube's `ContentsVolume`, hidden by `prepareTestTube`) —
      // an invisible mesh shouldn't still glow as part of the hover rim.
      // Also skip `InstancedMesh` (e.g. `createCopperPile`'s granule
      // batches): `THREE.Mesh` has no per-instance transform, so cloning
      // its shared base geometry into a plain rim mesh drops `instanceMatrix`
      // entirely and renders one mis-placed granule silhouette per batch
      // instead of a clean container outline.
      if (containerOnly && child instanceof THREE.Mesh && CONTAINER_CAP.test(child.name)) {
        // The cap moves (`PourMotion`): its rim rides on it, shown only while it sits on the bottle.
        const rim = new THREE.Mesh(child.geometry, material);
        rim.renderOrder = 10;
        rim.raycast = () => {};
        caps.push({ cap: child, seat: child.position.clone(), rim });
        return;
      }
      if (containerOnly && !CONTAINER_GLASS.test(child.name)) return;
      if (child instanceof THREE.Mesh && child.visible && !(child instanceof THREE.InstancedMesh)) {
        // The caller's material (opacity, tone) — this used to be the shared
        // default regardless, so `opacity` never took effect.
        const rim = new THREE.Mesh(child.geometry, material);
        relativeMatrix(child, object).decompose(pos, quat, scale);
        rim.position.copy(pos);
        rim.quaternion.copy(quat);
        rim.scale.copy(scale);
        rim.renderOrder = 10;
        // Purely visual — never meant to be interactive, and left
        // raycastable it could occasionally out-compete the reagent's own
        // invisible hover hitbox (nearly coincident with the real surface)
        // as "nearest hit", reintroducing the same flicker the hitbox
        // exists to prevent.
        rim.raycast = () => {};
        g.add(rim);
      }
    });
    return { group: g, caps };
  }, [object, material, containerOnly]);

  useEffect(() => {
    for (const { cap, rim } of caps) cap.add(rim);
    return () => {
      for (const { cap, rim } of caps) cap.remove(rim);
    };
  }, [caps]);
  useFrame(() => {
    for (const { cap, seat, rim } of caps) rim.visible = active && cap.position.distanceToSquared(seat) < 1e-8;
  });

  if (!group) return null;
  group.visible = active;
  return <primitive object={group} />;
}
