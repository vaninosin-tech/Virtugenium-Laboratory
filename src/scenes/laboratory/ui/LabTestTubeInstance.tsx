import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import { fillTestTubeContents, resolveTubeContents } from "../lib/testTubeContents";
import { prepareTestTube } from "../lib/testTubeMaterials";

const MODEL_PATH = "/assets/models/LabTestTube.glb";

/**
 * Non-interactive display of a `LabTestTube` — used both as loose
 * decorative glassware (workbench cluster, plain `scale`) and as a taken
 * item resting in a tray slot or on the workbench (`worldScale`, same
 * "fixed absolute world size regardless of the parent tray's own live
 * scale" convention as `ReagentStaticDisplay` — see its doc). Deep-clones
 * the whole exported hierarchy (`Tube_Glass` + `ContentsVolume`) per
 * instance, same "clone from a shared loaded scene" convention every other
 * prop in this file uses, so multiple tubes never share mutable state.
 */
export function LabTestTubeInstance({
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
  worldScale,
  contents,
}: {
  readonly position?: Position3;
  readonly rotationY?: number;
  /** Plain local scale — ignored when `worldScale` is set. */
  readonly scale?: number;
  /** Fixed absolute WORLD size that must hold regardless of this group's parent's own scale (compensated live, every frame, since the parent tray can be animating its own scale independently). */
  readonly worldScale?: number;
  /** Reagent ids in the tube, in pouring order. Omitted for the decorative/empty copies. */
  readonly contents?: readonly string[];
  /**
   * 0..1, how far the contents' reaction has gone (`useTubeReactionStore`);
   * which reaction it is comes from `reactionKindFor(contents)`. Not drawn
   * yet — the reaction visuals are `docs/codex/01-reaction-visuals.md`. May
   * change every frame, so it must never rebuild the contents binding.
   */
  readonly reactionProgress?: number;
}) {
  const { scene } = useGLTF(MODEL_PATH);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    return clone;
  }, [scene]);

  useEffect(() => prepareTestTube(instance), [instance]);

  useEffect(() => {
    const configs = resolveTubeContents(contents);
    if (configs.length === 0) return;
    const binding = fillTestTubeContents(instance, configs);
    return () => binding.dispose();
  }, [instance, contents]);

  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (worldScale === undefined) return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
    const parentWorldScale = new THREE.Vector3();
    parent.getWorldScale(parentWorldScale);
    group.scale.setScalar(worldScale / parentWorldScale.x);
  });

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, rotationY, 0]}
      {...(worldScale === undefined ? { scale } : {})}
    >
      <primitive object={instance} />
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
