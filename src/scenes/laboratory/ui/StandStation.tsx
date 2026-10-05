import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
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
import { TUBE_FOCUS } from "../lib/useTubeCloseUpStore";
import { ROOM_TEMPERATURE_CHEMISTRY, advanceChemistry, useTubeReactionStore } from "../lib/tubeReactions";
import type { StoredTestTube, TubeLocation } from "../lib/useTestTubeStorageStore";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { FLAME_BASE_Y, FLAME_HEIGHT, SpiritBurner } from "./SpiritBurner";
import { standTargetEvents } from "./standTargetEvents";
import { ArrivalFlight, GlassRim } from "./StandMotion";
import { ReagentHoverRim } from "./ReagentHoverRim";
import { useHandStore } from "../lib/useHandStore";
import { CLAMP_TUBE_MOUTH, useStandMotionStore } from "../lib/useStandMotionStore";
import { registerWorktopObstacle, shownInWorld, useCircleObstacle } from "../lib/worktopBounds";

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
  // Beside the clamp on whichever side (as the player sees it) is farther
  // from the rod — the stand stands turned differently in the hood and on
  // the table, and the lamp must never land on the stand's own base.
  const at = (side: number): Position3 => [
    TUBE_RING_LOCAL_OFFSET[0] + right.x * LAMP_ASIDE * side,
    0,
    TUBE_RING_LOCAL_OFFSET[2] + right.z * LAMP_ASIDE * side,
  ];
  const reach = (p: Position3) => Math.hypot(p[0], p[2]);
  const lamp = reach(at(1)) >= reach(at(-1)) ? at(1) : at(-1);
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

/** The 15 cm tube's mouth above its base — `LabTestTube.glb`'s height (`tests/measure-model.mjs`). */
const TUBE_MOUTH_HEIGHT = 0.15;

/** `BunsenStand.glb`'s base: a 12 cm disc round the rod. */
const STAND_BASE_RADIUS = 0.06;
/** The tube in the clamp, kept clear of a held bottle (VL-018) — the 2.2 cm glass. */
const CLAMPED_TUBE_RADIUS = 0.012;

/**
 * Publishes the stand's rod base for a pouring bottle — see `CLAMP_TUBE_MOUTH`. At the stand's own origin.
 * Also keeps held items off the stand's base and the tube in its clamp (VL-018).
 */
function RodAnchor({ tubeClamped }: { readonly tubeClamped: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.getWorldPosition(CLAMP_TUBE_MOUTH.rod);
  });
  useCircleObstacle("stand-base", ref, STAND_BASE_RADIUS);
  useEffect(() => {
    if (!tubeClamped) return;
    return registerWorktopObstacle("clamped-tube", {
      get: () =>
        CLAMP_TUBE_MOUTH.valid && ref.current && shownInWorld(ref.current)
          ? [{ kind: "circle", x: CLAMP_TUBE_MOUTH.point.x, z: CLAMP_TUBE_MOUTH.point.z, r: CLAMPED_TUBE_RADIUS }]
          : [],
    });
  }, [tubeClamped]);
  return <group ref={ref} />;
}

/** Publishes the clamped tube's mouth for a pouring bottle — see `CLAMP_TUBE_MOUTH`. */
function TubeMouthAnchor() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.getWorldPosition(CLAMP_TUBE_MOUTH.point);
    CLAMP_TUBE_MOUTH.valid = true;
  });
  useEffect(
    () => () => {
      CLAMP_TUBE_MOUTH.valid = false;
    },
    [],
  );
  return <group ref={ref} position={[0, TUBE_MOUTH_HEIGHT, 0]} />;
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
  const aim = useHandStore((state) => state.aim);
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
        <group position={[-CLAMP_TUBE_AXIS_X, 0, 0]}>
          <primitive object={clamp} />
          {/* Lit while a tube in the hand is brought to the empty clamp (VL-015). */}
          <ReagentHoverRim object={clamp} active={aim?.part === "clamp"} tone={aim?.refused ? "refused" : "normal"} />
        </group>
        <group position={[0, -TUBE_RING_INSERT_DEPTH, 0]}>
          {children}
          <TubeMouthAnchor />
        </group>
      </group>
      <TubeFocusAnchor anchorRef={focusRef} />
    </>
  );
}

/**
 * @param location where the stand is; the lamp stands beside it only if it is there too
 * @param away horizontal direction away from the player, in the stand's space
 * @param tube the tube in the clamp, if any
 * @param crackZone where the glass cracked, while it is cracked
 */
export function StandStation({
  location,
  away,
  tube,
  crackZone,
}: {
  readonly location: TubeLocation;
  readonly away: THREE.Vector3;
  readonly tube: StoredTestTube | undefined;
  readonly crackZone: number | null;
}) {
  const { lamp, hotSpot } = useMemo(() => lampLayout(away), [away]);
  // The lamp is its own item (VL-014): it may still be in the cabinet, or
  // left behind on the table when the stand went into the hood.
  const lampHere = useBurnerStore((state) => state.place === location);
  const clampArrival = useStandMotionStore((state) => state.clampArrival);
  const aim = useHandStore((state) => state.aim);

  return (
    <>
      {lampHere && <SpiritBurner position={lamp} />}
      <RodAnchor tubeClamped={!!tube} />
      <HeatingRuntime />
      <TubeReactionRuntime tube={tube} />
      <HeldClampRig away={away} hotSpot={hotSpot}>
        {tube && (
          // The tube stands in front of the stand's rod: its handlers stop
          // the event, so a click here never falls through to the stand's.
          // Lamp lit — heat it; otherwise — back to the rack (VL-014).
          <group {...standTargetEvents(`clamped:${tube.instanceId}`, { kind: "clamped-tube" })}>
            {/* Lit while a bottle (or a tube to pour) is brought to it (VL-015). */}
            <GlassRim active={aim?.part === "tube"} tone={aim?.refused ? "refused" : "normal"}>
              <ArrivalFlight arrival={clampArrival}>
                <LabTestTubeInstance
                  contents={tube.contents}
                  key={tube.instanceId}
                  chemistryId={tube.instanceId}
                  crackSpot={crackZone === null ? null : crackSpotForZone(crackZone)}
                  inStand
                />
              </ArrivalFlight>
            </GlassRim>
          </group>
        )}
      </HeldClampRig>
    </>
  );
}
