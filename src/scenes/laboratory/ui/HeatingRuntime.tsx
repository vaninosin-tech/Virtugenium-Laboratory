import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { applyErrorRule } from "../../../features/tablet/lib/penalties";
import { heldClampPose } from "../lib/heldClampPose";
import { LAMP_FLAME } from "../lib/lampFlame";
import { ROOM_TEMPERATURE_CHEMISTRY, advanceChemistry, useTubeReactionStore } from "../lib/tubeReactions";
import { useBurnerStore } from "../lib/useBurnerStore";
import { bottomInFlame, crackSpotForZone, useHeatingStore } from "../lib/useHeatingStore";
import { useLabNoticeStore } from "../lib/useLabNoticeStore";
import { useTestTubeStorageStore, type StoredTestTube } from "../lib/useTestTubeStorageStore";
import { LabTestTubeInstance } from "./LabTestTubeInstance";

/** Experiment 1's «пробирка нагрета без предварительного прогрева» — what a crack costs. */
const HEAT_ERROR_RULE_ID = "error-1-heat";

/**
 * Drives the heating mini-game's clock and charges the crack — for the clamp
 * and for a tube in the hand alike, so it lives in the scene, not in the
 * stand (VL-020: the lamp heats without the stand). The penalty is raised
 * here, on the phase EDGE, rather than inside `useHeatingStore`: the store
 * stays a pure model of glass and flame that tests can drive without a
 * running experiment.
 */
export function HeatingRuntime() {
  const tick = useHeatingStore((state) => state.tick);

  // The lamp is lit only for the heating (VL-020): when the clamp goes back
  // or the tube is put down, the cap goes back on and the flame dies.
  useEffect(
    () =>
      useHeatingStore.subscribe((state, previous) => {
        if (previous.active && !state.active && useBurnerStore.getState().lit) useBurnerStore.getState().setLit(false);
      }),
    [],
  );

  useFrame((_, delta) => {
    const before = useHeatingStore.getState().phase;
    // Clamped so a stalled frame (tab switch, shader compile) can't jump
    // the glass straight past the crack threshold.
    tick(Math.min(delta, 0.1), useBurnerStore.getState().lit);
    if (before !== "cracked" && useHeatingStore.getState().phase === "cracked") {
      const penalty = applyErrorRule(HEAT_ERROR_RULE_ID, "safety-violation");
      const points = penalty?.charged ? ` (${penalty.rule.points})` : "";
      useLabNoticeStore.getState().show(`Ошибка: пробирка лопнула от неравномерного нагрева${points}`, "error");
    }
  });

  return null;
}

/**
 * A tube heated in the hand (VL-020), drawn in the flame for as long as it is
 * heated — the rack hides its own copy meanwhile. Same V and the same lean as
 * the clamp's (`heldClampPose`), only with no clamp: the hand holds the glass.
 */
export function HandHeatRig() {
  const target = useHeatingStore((state) => (state.active && state.target.mode === "hand" ? state.target : null));
  const tube = useTestTubeStorageStore((state) => {
    if (!target) return undefined;
    const list = target.location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
    return list[target.index];
  });
  const crackZone = useHeatingStore((state) => (state.phase === "cracked" ? state.crackZone : null));

  if (!target || !tube || tube.instanceId !== target.instanceId) return null;
  return <TubeInFlame tube={tube} crackZone={crackZone} />;
}

function TubeInFlame({ tube, crackZone }: { readonly tube: StoredTestTube; readonly crackZone: number | null }) {
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  // Away from the player, level — the V's lean is across the screen, as with the clamp.
  const away = useMemo(() => {
    const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0);
    return forward.lengthSq() > 1e-6 ? forward.normalize() : new THREE.Vector3(0, 0, -1);
  }, [camera]);

  useFrame((_, delta) => {
    const group = ref.current;
    if (!group || !LAMP_FLAME.valid) return;
    const heating = useHeatingStore.getState();
    const pose = heldClampPose(heating.sweep, LAMP_FLAME.point, away, 0);
    group.position.copy(pose.bottom);
    group.quaternion.copy(pose.quaternion);

    // The contents heat only with the bottom in the flame; the rest of the V warms the glass.
    const inFlame =
      useBurnerStore.getState().lit && heating.started && heating.phase !== "cracked" && bottomInFlame(heating.sweep);
    const reactions = useTubeReactionStore.getState();
    const current = reactions.chemistryById[tube.instanceId] ?? ROOM_TEMPERATURE_CHEMISTRY;
    reactions.setChemistry(tube.instanceId, advanceChemistry(tube.contents, current, Math.min(delta, 0.1), inFlame));
  });

  return (
    <group ref={ref}>
      <LabTestTubeInstance
        contents={tube.contents}
        chemistryId={tube.instanceId}
        crackSpot={crackZone === null ? null : crackSpotForZone(crackZone)}
        inStand
      />
    </group>
  );
}
