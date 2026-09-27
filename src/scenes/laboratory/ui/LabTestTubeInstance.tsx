import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import { fillTestTubeContents, resolveTubeContents } from "../lib/testTubeContents";
import { prepareTestTube } from "../lib/testTubeMaterials";
import { createTubeReactionVisuals } from "../lib/tubeReactionVisuals";
import { reactionKindFor } from "../lib/tubeReactions";
import { useRuntimeQualityStore } from "../lib/useRuntimeQualityStore";
import { useTubeVisualTuningStore } from "../lib/useTubeVisualTuningStore";
import { useLabNoticeStore } from "../lib/useLabNoticeStore";
import { useHeatingStore } from "../lib/useHeatingStore";

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
  reactionProgress = 0,
  inStand = false,
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
   * which reaction it is comes from `reactionKindFor(contents)`. May
   * change every frame, so it must never rebuild the contents binding.
   */
  readonly reactionProgress?: number;
  readonly inStand?: boolean;
}) {
  const { scene } = useGLTF(MODEL_PATH);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    return clone;
  }, [scene]);

  useEffect(() => prepareTestTube(instance), [instance]);

  const visuals = useRef<ReturnType<typeof createTubeReactionVisuals>>(null);
  const splashStart = useRef(-Infinity);
  useEffect(() => {
    if (!inStand) return;
    return useLabNoticeStore.subscribe((state, previous) => {
      const notice = state.notice;
      if (notice && notice.id !== previous.notice?.id && notice.tone === "error" &&
          notice.text.startsWith("Ошибка: нарушен порядок смешивания")) {
        splashStart.current = performance.now() / 1000;
      }
    });
  }, [inStand]);

  useEffect(() => {
    const configs = resolveTubeContents(contents);
    const binding = fillTestTubeContents(instance, configs);
    const kind = reactionKindFor(contents ?? []);
    visuals.current = kind || inStand ? createTubeReactionVisuals(instance, kind) : null;
    return () => {
      visuals.current?.dispose();
      visuals.current = null;
      binding.dispose();
    };
  }, [instance, contents, inStand]);

  const groupRef = useRef<THREE.Group>(null);
  const parentWorldScale = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const tuning = useTubeVisualTuningStore.getState();
    const progress = import.meta.env.DEV && inStand && tuning.enabled ? tuning.progress : reactionProgress;
    visuals.current?.update(progress, clock.elapsedTime, useRuntimeQualityStore.getState().quality,
      performance.now() / 1000 - splashStart.current);
    const cracked = inStand && useHeatingStore.getState().phase === "cracked";
    instance.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name.startsWith("Tube_Glass")) {
        const material = object.material as THREE.Material;
        if (material.userData.cracked) material.userData.cracked.value = cracked ? 1 : 0;
      }
    });
    if (worldScale === undefined) return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;
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
