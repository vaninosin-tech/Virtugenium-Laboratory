import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";

import { applyErrorRule } from "../../../features/tablet/lib/penalties";
import { TUBE_CLAMP_MODEL_PATH } from "../lib/bunsenStandAssembly";
import { CLAMP_TUBE_AXIS_X } from "../lib/bunsenStandGeometry";
import { heldClampPose } from "../lib/heldClampPose";
import type { Position3 } from "../lib/layout";
import { TUBE_RING_INSERT_DEPTH, TUBE_RING_LOCAL_OFFSET } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { bottomInFlame, crackSpotForZone, useHeatingStore } from "../lib/useHeatingStore";
import { useLabNoticeStore } from "../lib/useLabNoticeStore";
import { useStandStationStore } from "../lib/useStandStationStore";
import { TUBE_FOCUS } from "../lib/useTubeCloseUpStore";
import { ROOM_TEMPERATURE_CHEMISTRY, advanceChemistry, useTubeReactionStore } from "../lib/tubeReactions";
import type { StoredTestTube } from "../lib/useTestTubeStorageStore";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { FLAME_BASE_Y, FLAME_HEIGHT, SpiritBurner } from "./SpiritBurner";

/**
 * Everything that makes the stand a working station, wherever the stand is —
 * on the workbench or inside the fume hood: the removable clamp with its
 * tube (`HeldClampRig`), the spirit lamp, the tube's chemistry, the heating
 * mini-game's clock and the close-up camera's focus point. The stand model
 * itself is drawn by its owner (it is dragged on the table, fixed in the
 * hood), which hides the model's own clamp: this station draws the clamp so
 * it can take it off the boss.
 *
 * All coordinates are in the stand's own local space.
 */

/**
 * How far to the player's right of the clamp's resting spot the lamp stands.
 * On the V's left arm the held tube leans its mouth up-left, towards the
 * stand's rod; this much room keeps the glass off the rod.
 */
const LAMP_ASIDE = 0.13;
/** Seconds to take the clamp off the boss and bring the tube to the flame, and back. */
const CLAMP_MOVE_SECONDS = 0.7;
/** How high the clamp lifts clear of the boss on its way. */
const CLAMP_MOVE_LIFT = 0.03;
/**
 * Height above the tube's base that the close-up camera aims at: the middle
 * of the 15 cm tube. Lower cut off the gas leaving the mouth — the one sign
 * experiment 1 hinges on — at the top of the frame.
 */
const TUBE_FOCUS_HEIGHT = 0.08;
/** Experiment 1's «пробирка нагрета без предварительного прогрева» — what a crack costs. */
const HEAT_ERROR_RULE_ID = "error-1-heat";

const UP = new THREE.Vector3(0, 1, 0);

/** Where the lamp stands and where its flame is hottest, for a player looking along `away`. */
export function lampLayout(away: THREE.Vector3): { readonly lamp: Position3; readonly hotSpot: THREE.Vector3 } {
  const right = new THREE.Vector3().crossVectors(away, UP).normalize();
  const lamp: Position3 = [
    TUBE_RING_LOCAL_OFFSET[0] + right.x * LAMP_ASIDE,
    0,
    TUBE_RING_LOCAL_OFFSET[2] + right.z * LAMP_ASIDE,
  ];
  return { lamp, hotSpot: new THREE.Vector3(lamp[0], FLAME_BASE_Y + FLAME_HEIGHT * 0.7, lamp[2]) };
}

/**
 * Drives the heating mini-game's clock and charges the crack. The penalty is
 * raised here, on the phase EDGE, rather than inside `useHeatingStore`: the
 * store stays a pure model of glass and flame that tests can drive without a
 * running experiment.
 */
function HeatingRuntime() {
  const tick = useHeatingStore((state) => state.tick);

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
 * Runs the clamped tube's chemistry — see `advanceChemistry`. The contents
 * are in the flame only while the player holds the clamp with the tube's
 * bottom in it: back on the stand the tube hangs well above the flame.
 */
function TubeReactionRuntime({ tube }: { readonly tube: StoredTestTube | undefined }) {
  useFrame((_, delta) => {
    if (!tube) return;
    const heating = useHeatingStore.getState();
    const inFlame =
      useBurnerStore.getState().lit &&
      heating.started &&
      heating.active &&
      heating.phase !== "cracked" &&
      // The contents heat only with the bottom in the flame; the rest of the
      // V warms the glass, not the liquid.
      bottomInFlame(heating.sweep);
    const reactions = useTubeReactionStore.getState();
    const current = reactions.chemistryById[tube.instanceId] ?? ROOM_TEMPERATURE_CHEMISTRY;
    reactions.setChemistry(
      tube.instanceId,
      advanceChemistry(tube.contents, current, Math.min(delta, 0.1), inFlame),
    );
  });

  return null;
}

/** Publishes the station's focus point for `CameraRig`'s close-up — see `TUBE_FOCUS`. Positioned by its owner. */
function TubeFocusAnchor({ anchorRef }: { readonly anchorRef: RefObject<THREE.Group | null> }) {
  useFrame(() => {
    if (!anchorRef.current) return;
    anchorRef.current.getWorldPosition(TUBE_FOCUS.point);
    TUBE_FOCUS.valid = true;
  });
  useEffect(
    () => () => {
      TUBE_FOCUS.valid = false;
    },
    [],
  );
  return <group ref={anchorRef} />;
}

/**
 * The removable clamp with its tube. At rest it sits in the boss exactly
 * where the stand model has it; while heating it comes off, lifts clear and
 * holds the tube in the lamp's still flame at the spot the ellipse on the V
 * picks (`heldClampPose`), then goes back. Driven per frame on the object
 * rather than through React state: the ellipse can move every frame.
 *
 * Also publishes the camera's close-up focus, which follows the tube down to
 * the flame and back.
 */
function HeldClampRig({
  away,
  hotSpot,
  children,
}: {
  readonly away: THREE.Vector3;
  readonly hotSpot: THREE.Vector3;
  readonly children: ReactNode;
}) {
  const { scene } = useGLTF(TUBE_CLAMP_MODEL_PATH);
  const clamp = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  const rigRef = useRef<THREE.Group>(null);
  const focusRef = useRef<THREE.Group>(null);
  const held = useRef(0);
  const restJaws = useMemo(() => new THREE.Vector3(...TUBE_RING_LOCAL_OFFSET), []);
  const restQuaternion = useMemo(() => new THREE.Quaternion(), []);
  // Close-up focus while heating: a little above the flame, where the tube passes through it.
  const heatingFocus = useMemo(() => hotSpot.clone().setY(hotSpot.y + 0.03), [hotSpot]);

  useFrame((_, rawDelta) => {
    const rig = rigRef.current;
    if (!rig) return;
    const heating = useHeatingStore.getState();
    const target = heating.active ? 1 : 0;
    held.current = THREE.MathUtils.clamp(
      held.current + Math.sign(target - held.current) * (Math.min(rawDelta, 0.1) / CLAMP_MOVE_SECONDS),
      0,
      1,
    );
    const k = THREE.MathUtils.smoothstep(held.current, 0, 1);
    const pose = heldClampPose(heating.sweep, hotSpot, away, TUBE_RING_INSERT_DEPTH);
    rig.position.lerpVectors(restJaws, pose.jaws, k);
    rig.position.y += CLAMP_MOVE_LIFT * Math.sin(Math.PI * k);
    rig.quaternion.slerpQuaternions(restQuaternion, pose.quaternion, k);

    const focus = focusRef.current;
    if (focus) {
      // Halfway up the hanging tube at rest; just above the flame while
      // heating — steadier than following every move of the ellipse.
      focus.position.set(restJaws.x, restJaws.y - TUBE_RING_INSERT_DEPTH + TUBE_FOCUS_HEIGHT, restJaws.z);
      focus.position.lerp(heatingFocus, k);
    }
  });

  return (
    <>
      <group ref={rigRef}>
        <primitive object={clamp} position={[-CLAMP_TUBE_AXIS_X, 0, 0]} />
        <group position={[0, -TUBE_RING_INSERT_DEPTH, 0]}>{children}</group>
      </group>
      <TubeFocusAnchor anchorRef={focusRef} />
    </>
  );
}

const cursor = (value: string) => (event: ThreeEvent<PointerEvent>) => {
  event.stopPropagation();
  document.body.style.cursor = value;
};

/**
 * @param away horizontal direction away from the player, in the stand's space
 * @param tube the tube in the clamp, if any
 * @param crackZone where the glass cracked, while it is cracked
 */
export function StandStation({
  away,
  tube,
  crackZone,
}: {
  readonly away: THREE.Vector3;
  readonly tube: StoredTestTube | undefined;
  readonly crackZone: number | null;
}) {
  const { lamp, hotSpot } = useMemo(() => lampLayout(away), [away]);
  const openStation = useStandStationStore((state) => state.open);

  return (
    <>
      <SpiritBurner position={lamp} />
      <HeatingRuntime />
      <TubeReactionRuntime tube={tube} />
      <HeldClampRig away={away} hotSpot={hotSpot}>
        {tube && (
          <group
            onClick={(event: ThreeEvent<MouseEvent>) => {
              // The tube stands in front of the stand's rod, so this must
              // not fall through to the stand's own click.
              event.stopPropagation();
              if (!useHeatingStore.getState().active) openStation();
            }}
            onPointerOver={cursor("zoom-in")}
            onPointerOut={cursor("auto")}
          >
            <LabTestTubeInstance
              contents={tube.contents}
              key={tube.instanceId}
              chemistryId={tube.instanceId}
              crackSpot={crackZone === null ? null : crackSpotForZone(crackZone)}
              inStand
            />
          </group>
        )}
      </HeldClampRig>
    </>
  );
}
