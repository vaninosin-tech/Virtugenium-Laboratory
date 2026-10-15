import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { HAND_GHOST, createGhostMaterial, ghostShapeOf, type GhostShape } from "../lib/handGhost";
import { useHandStore } from "../lib/useHandStore";
import { GHOST_COLOR, type GhostState } from "./dragHighlightStyle";
import { ghostCandidates, ghostState } from "./placementGhosts";

/** How many outlines at most: its own place, a couple of others, the stand and the lamp. */
const SLOTS = 6;

/** Edge strength: white is where it goes if let go now; a use that letting go now does is brighter than the rest. */
const BRIGHTNESS: Record<GhostState, number> = { blue: 1.6, white: 2.8, green: 1.8, red: 1.8 };
const AIMED = 2.8;

/**
 * The carried item's outlines (VL-018) — only its edges, in its own shape —
 * wherever it could end up (`placementGhosts`): blue where it may be set
 * down, white where it goes if let go now, green where it can be used now,
 * red where it is used but not now. Mounted once in the canvas, by
 * `HandController`.
 */
export function HandGhosts() {
  const held = useHandStore((state) => state.held);
  const camera = useThree((state) => state.camera);
  const slots = useMemo(
    () =>
      Array.from({ length: SLOTS }, () => {
        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.visible = false;
        group.renderOrder = 12;
        return { group, material: createGhostMaterial() };
      }),
    [],
  );
  // The outline of another actor (a bottle pouring into the held tube) — its own shape.
  const actor = useMemo(() => {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.visible = false;
    group.renderOrder = 12;
    return { group, material: createGhostMaterial(), source: null as THREE.Object3D | null };
  }, []);
  useEffect(() => () => slots.forEach(({ material }) => material.dispose()), [slots]);
  useEffect(() => () => actor.material.dispose(), [actor]);

  const s = useMemo(() => ({ version: -1 }), []);

  useFrame(() => {
    if (s.version !== HAND_GHOST.version) {
      // A new item: its shape into every slot.
      s.version = HAND_GHOST.version;
      for (const { group, material } of slots) fillWithShape(group, HAND_GHOST.shape, material);
    }
    for (const { group } of slots) group.visible = false;
    actor.group.visible = false;
    if (!held || !HAND_GHOST.shape) return;

    const candidates = ghostCandidates(held, camera);
    let slot = 0;
    candidates.forEach((candidate) => {
      let target: { group: THREE.Group; material: THREE.ShaderMaterial };
      if (candidate.ghostSource) {
        if (actor.source !== candidate.ghostSource) {
          actor.source = candidate.ghostSource;
          fillWithShape(actor.group, ghostShapeFor(candidate.ghostSource), actor.material);
        }
        target = actor;
      } else {
        if (slot >= SLOTS) return;
        target = slots[slot];
        slot += 1;
      }
      const { group, material } = target;
      const state = ghostState(candidate);
      group.matrix.copy(candidate.matrix);
      group.matrixWorldNeedsUpdate = true;
      group.visible = true;
      material.uniforms.color.value.set(GHOST_COLOR[state]).multiplyScalar(2);
      material.uniforms.opacity.value =
        candidate.kind === "interaction" && candidate.isActiveReleaseTarget ? AIMED : BRIGHTNESS[state];
    });
  });

  return (
    <>
      {slots.map(({ group }) => (
        <primitive key={group.uuid} object={group} />
      ))}
      <primitive object={actor.group} />
    </>
  );
}

/** Each actor's outline shape, taken once — at rest, before it is ever shown. A bottle pours capless. */
const ACTOR_SHAPES = new WeakMap<THREE.Object3D, GhostShape | null>();
function ghostShapeFor(root: THREE.Object3D): GhostShape | null {
  if (!ACTOR_SHAPES.has(root)) ACTOR_SHAPES.set(root, ghostShapeOf(root, { withoutCap: true }));
  return ACTOR_SHAPES.get(root) ?? null;
}

/** `group` drawn as `shape`'s edges only. */
function fillWithShape(group: THREE.Group, shape: GhostShape | null, material: THREE.ShaderMaterial): void {
  group.clear();
  for (const part of shape ?? []) {
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(part.matrix);
    mesh.renderOrder = 12;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = () => {};
    group.add(mesh);
  }
}

