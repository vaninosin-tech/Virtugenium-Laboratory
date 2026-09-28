import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { Position3 } from "../lib/layout";
import { fillTestTubeContents, resolveTubeContents } from "../lib/testTubeContents";
import { prepareTestTube } from "../lib/testTubeMaterials";
import { createTubeReactionVisuals } from "../lib/tubeReactionVisuals";
import { ROOM_TEMPERATURE_CHEMISTRY, reactionKindFor, useTubeReactionStore } from "../lib/tubeReactions";
import { useRuntimeQualityStore } from "../lib/useRuntimeQualityStore";
import { useTubeVisualTuningStore } from "../lib/useTubeVisualTuningStore";
import { useLabNoticeStore } from "../lib/useLabNoticeStore";
import type { CrackSpot } from "../lib/useHeatingStore";

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
  chemistryId,
  crackSpot = null,
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
   * Key into `useTubeReactionStore` for this tube's chemistry — progress,
   * rate and temperature (`TubeChemistry`). Read every frame inside
   * `useFrame` rather than passed as values: they change every frame, and as
   * props they would re-render the whole fume hood with them. Which reaction
   * it is comes from `reactionKindFor(contents)`.
   */
  readonly chemistryId?: string;
  /** Where the glass cracked (`crackSpotForZone`), or null while intact. */
  readonly crackSpot?: CrackSpot | null;
  readonly inStand?: boolean;
}) {
  const { scene } = useGLTF(MODEL_PATH);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    return clone;
  }, [scene]);

  const crackUniforms = useRef<THREE.IUniform<THREE.Vector2>[]>([]);
  useEffect(() => {
    const dispose = prepareTestTube(instance);
    // Only the clamped tube reads heating state; cache its newly owned glass.
    if (inStand) instance.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name.startsWith("Tube_Glass")) {
        const material = object.material as THREE.Material;
        if (material.userData.crackSpot) crackUniforms.current.push(material.userData.crackSpot);
      }
    });
    return () => { crackUniforms.current = []; dispose(); };
  }, [instance, inStand]);

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
    visuals.current = configs.length || inStand
      ? createTubeReactionVisuals(instance, kind, {
        activeSurface: inStand && !(import.meta.env.DEV && import.meta.env.VITE_TUBE_WAVES === "0"),
        pour: inStand && configs.length > 0,
      }) : null;
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
    const group = groupRef.current;
    const parent = group?.parent;
    if (group && parent) {
      if (worldScale !== undefined) {
        parent.getWorldScale(parentWorldScale);
        group.scale.setScalar(worldScale / parentWorldScale.x);
      }
      const correction = import.meta.env.DEV && inStand && tuning.tiltDegrees !== null
        ? THREE.MathUtils.degToRad(THREE.MathUtils.clamp(tuning.tiltDegrees, -20, 20)) - parent.rotation.x : 0;
      group.rotation.x = correction;
      group.position.set(position[0], position[1] * Math.cos(correction) - position[2] * Math.sin(correction),
        position[1] * Math.sin(correction) + position[2] * Math.cos(correction));
      group.updateWorldMatrix(true, true);
    }
    const chemistry =
      (chemistryId && useTubeReactionStore.getState().chemistryById[chemistryId]) || ROOM_TEMPERATURE_CHEMISTRY;
    const visualChemistry = import.meta.env.DEV && inStand && tuning.enabled ? tuning : chemistry;
    visuals.current?.update(visualChemistry, clock.elapsedTime, useRuntimeQualityStore.getState().quality,
      performance.now() / 1000 - splashStart.current);
    if (inStand) {
      for (const uniform of crackUniforms.current) uniform.value.set(crackSpot?.side ?? 0, crackSpot?.height ?? -1);
    }
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
