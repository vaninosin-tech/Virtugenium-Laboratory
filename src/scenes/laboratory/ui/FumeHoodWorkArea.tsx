import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { applyErrorRule } from "../../../features/tablet/lib/penalties";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { EQUIPMENT, type Position3 } from "../lib/layout";
import { tryAddToTube, tryPourBetweenTubes } from "../lib/pourIntoTube";
import {
  TUBE_RING_INSERT_DEPTH,
  TUBE_RING_LOCAL_OFFSET,
  useBunsenStandStorageStore,
} from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { FLAME_HALF_WIDTH, crackSpotForZone, useHeatingStore } from "../lib/useHeatingStore";
import { useLabNoticeStore } from "../lib/useLabNoticeStore";
import { TUBE_FOCUS, useTubeCloseUpStore } from "../lib/useTubeCloseUpStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { ROOM_TEMPERATURE_CHEMISTRY, advanceChemistry, useTubeReactionStore } from "../lib/tubeReactions";
import {
  computeTubeSlotLocalOffset,
  useTestTubeStorageStore,
  type StoredTestTube,
} from "../lib/useTestTubeStorageStore";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { LabTestTubeRackInstance } from "./LabTestTubeRackInstance";
import { ReagentStaticDisplay } from "./ReagentStaticDisplay";
import { SpiritBurner } from "./SpiritBurner";

const STAND_MODEL_PATH = "/assets/models/BunsenStand.glb";

const DEF = EQUIPMENT.find((equipment) => equipment.id === "fume-hood")!;

/**
 * Placement of everything carried into the hood, in the hood model's OWN
 * local space — its worktop surface sits at local Y 0.9 (measured in
 * `FumeHood_Modern_MASTER.blend`, see `FumeHood.tsx`'s sash derivation, and
 * unchanged by the Z-up -> Y-up export since a height stays a height).
 *
 * First-pass X/Z values: the vertical placement is anchored to a measured
 * surface, but how the three groups are spread ACROSS that surface was not
 * measured against the interior walls. Nudge these three entries if anything
 * clips the sash or the side panels.
 */
const WORKTOP_Y = 0.9;
const RACK_LOCAL: Position3 = [-0.26, WORKTOP_Y, 0.02];
const STAND_LOCAL: Position3 = [0.1, WORKTOP_Y, 0.02];
const BOTTLES_LOCAL: Position3 = [0.34, WORKTOP_Y, 0.02];
const BOTTLE_SPACING_X = 0.13;

/**
 * The stand's ring arm points along the model's +X, i.e. sideways across
 * the hood, so the clamped tube hid beside the rod. A quarter turn points
 * the arm at the sash — at the camera — with the tube in front of the rod,
 * and turns the heating sweep (the tube's local Z) into left-right motion on
 * screen, the same axis as the knob's track.
 */
const STAND_ROTATION_Y = -Math.PI / 2;

/**
 * Heating tilts the tube instead of sliding it: the tube stays clamped in the
 * ring, the knob on the clamp boss turns, and the whole clamp arm rotates
 * about its own long axis (model X, at the boss's height), swinging the
 * hanging tube's bottom through the flame. At full knob throw the bottom,
 * `TUBE_RING_INSERT_DEPTH` below the ring, moves about ±3.5 cm sideways —
 * the same reach the old slide had, now as an arc from a fixed clamp.
 */
const MAX_TILT = Math.asin(0.035 / TUBE_RING_INSERT_DEPTH);
/** The knob turns further than the arm it drives, so its motion reads as turning a knob. */
const KNOB_TURNS_PER_TILT = 3;
/** Height of the clamp arm's axis in the stand model (`ClampJoint` / `ClampNeck`). */
const CLAMP_AXIS_Y = 0.22;
/** Centre of `JointKnob` along the arm axis — measured, see `tests/measure-model.mjs`. */
const JOINT_KNOB_X = -0.022;
/** The parts that swing with the clamp arm. `ClampJoint` (the boss on the rod) stays put. */
const CLAMP_ARM_NODES = ["ClampNeck", "TubeRingJoint", "TubeRing"];

/** Current tilt of the clamp arm, radians — shared by the stand model and the clamped tube. */
const clampTilt = () => useHeatingStore.getState().sweep * MAX_TILT;
/** Experiment 1's «пробирка нагрета без предварительного прогрева» — what a crack costs. */
const HEAT_ERROR_RULE_ID = "error-1-heat";
const HOLDER_ITEM_ID = "equipment-holder";

const reagentConfig = (id: string): ReagentContainerConfig | undefined =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

function StandInFumeHood({ onActivate }: { readonly onActivate: () => void }) {
  const { scene } = useGLTF(STAND_MODEL_PATH);
  const { instance, armPivot, knobPivot } = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    // Re-parent the swinging parts under pivots on the arm's axis. `attach`
    // keeps their world transforms, so at zero tilt the model is unchanged.
    const root = clone.getObjectByName("BunsenStand") ?? clone;
    const makePivot = (x: number, names: readonly string[]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, CLAMP_AXIS_Y, 0);
      root.add(pivot);
      clone.updateMatrixWorld(true);
      for (const name of names) {
        const node = clone.getObjectByName(name);
        if (node) pivot.attach(node);
      }
      return pivot;
    };
    return {
      instance: clone,
      armPivot: makePivot(0, CLAMP_ARM_NODES),
      knobPivot: makePivot(JOINT_KNOB_X, ["JointKnob"]),
    };
  }, [scene]);

  useFrame(() => {
    const tilt = clampTilt();
    armPivot.rotation.x = tilt;
    knobPivot.rotation.x = tilt * KNOB_TURNS_PER_TILT;
  });

  return (
    <primitive
      object={instance}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        document.body.style.cursor = "auto";
      }}
    />
  );
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
 * are in the flame whenever the burner is lit and the tube hangs over it:
 * that is a fact about where the tube is, not about the heating panel being
 * open, so a tube left over the flame keeps heating after «Отойти от штатива».
 * `started` keeps an untouched stand (knob at rest, never grabbed) cold.
 */
function TubeReactionRuntime({ tube }: { readonly tube: StoredTestTube | undefined }) {
  useFrame((_, delta) => {
    if (!tube) return;
    const heating = useHeatingStore.getState();
    const inFlame =
      useBurnerStore.getState().lit &&
      heating.started &&
      heating.phase !== "cracked" &&
      Math.abs(heating.sweep) < FLAME_HALF_WIDTH;
    const reactions = useTubeReactionStore.getState();
    const current = reactions.chemistryById[tube.instanceId] ?? ROOM_TEMPERATURE_CHEMISTRY;
    reactions.setChemistry(
      tube.instanceId,
      advanceChemistry(tube.contents, current, Math.min(delta, 0.1), inFlame),
    );
  });

  return null;
}

/**
 * Holds the clamped tube in the ring and tilts it with the clamp arm — the
 * same pivot and angle `StandInFumeHood` gives the arm itself, so the tube
 * never slips relative to its ring. Set per frame on the object rather than
 * through React state: the knob can move every frame while heating.
 */
function ClampTiltGroup({ children }: { readonly children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.x = clampTilt();
  });
  return (
    <group ref={ref} position={[TUBE_RING_LOCAL_OFFSET[0], CLAMP_AXIS_Y, TUBE_RING_LOCAL_OFFSET[2]]}>
      {children}
    </group>
  );
}

/**
 * Height above the tube's base that the close-up camera aims at: the middle
 * of the 15 cm tube. Lower cut off the gas leaving the mouth — the one sign
 * experiment 1 hinges on — at the top of the frame.
 */
const TUBE_FOCUS_HEIGHT = 0.08;

/** Publishes the clamped tube's rest position for `CameraRig`'s close-up — see `TUBE_FOCUS`. */
function TubeFocusAnchor({ position }: { readonly position: Position3 }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.getWorldPosition(TUBE_FOCUS.point);
    TUBE_FOCUS.valid = true;
  });
  useEffect(
    () => () => {
      TUBE_FOCUS.valid = false;
    },
    [],
  );
  return <group ref={ref} position={position} />;
}

/**
 * TEMP sandbox: all nine bottles along the back wall — see
 * `sandbox/setupSandbox.ts`. Split around the stand (hood-local X 0.04..0.25)
 * rather than one even row: a bottle standing behind the stand puts its
 * click hitbox in front of the stand's own and swallows the click that
 * should start heating.
 */
const SANDBOX_BOTTLE_Z = -0.17;
const SANDBOX_BOTTLE_X = [-0.58, -0.47, -0.36, -0.25, -0.14, -0.03, 0.33, 0.44, 0.55];
const sandboxBottlePosition = (index: number): Position3 => [
  SANDBOX_BOTTLE_X[index] ?? 0.55,
  WORKTOP_Y,
  SANDBOX_BOTTLE_Z,
];

/**
 * Everything the player carried in through «Перенести», rendered inside the
 * fume hood. Mounted as its own group at the hood's furniture transform
 * rather than as a child of `FumeHood`'s cloned GLB, so moving furniture in
 * the dev panel keeps both in step without this content inheriting the
 * sash's own animated nodes.
 */
export function FumeHoodWorkArea() {
  const override = useFurniturePositionStore((state) => state.getOverride(DEF.id));
  const [x, y, z] = override.position;
  const rotationY = override.rotationY ?? DEF.rotationY;

  const hoodTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const hoodItems = useReagentStorageStore((state) => state.fumeHoodItems);
  const standInHood = useBunsenStandStorageStore((state) => state.onFumeHood);
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);
  const enterHeating = useHeatingStore((state) => state.enter);
  const burnerLit = useBurnerStore((state) => state.lit);
  const hasHolder = useLaboratoryStore((state) => state.inventoryItemIds.includes(HOLDER_ITEM_ID));
  const sandbox = useLaboratoryStore((state) => state.mode === "sandbox");
  const crackZone = useHeatingStore((state) => (state.phase === "cracked" ? state.crackZone : null));

  const clampedIndex = standInHood ? attachedTubeSlotIndex : null;
  const hasContent = hoodTubes.length > 0 || hoodItems.length > 0 || standInHood;

  // Nothing to heat, or nothing to heat it with — clicking the stand then
  // has no mini-game to start, so it stays inert rather than opening an
  // empty crank. Heating without the holder is not a penalised mistake but
  // an impossible one: the game simply does not let the tube near the flame.
  const handleStandClick = () => {
    if (!burnerLit) return;
    if (clampedIndex === null || !hoodTubes[clampedIndex]) return;
    if (!hasHolder) {
      useLabNoticeStore.getState().show("Без держателя для пробирок нагревать нельзя", "refusal");
      return;
    }
    enterHeating();
  };

  // Clicking a bottle pours it into whatever is clamped in the stand. A
  // click rather than a drag: the tube is fixed in the ring, so there is
  // exactly one possible destination and nothing to aim at. The ORDER of
  // these clicks is what the mixing-order rules read.
  const pourIntoClampedTube = (reagentId: string) => {
    if (clampedIndex === null || !hoodTubes[clampedIndex]) return;
    tryAddToTube("fumeHood", clampedIndex, reagentId);
  };

  const canPourFrom = (index: number) =>
    clampedIndex !== null && index !== clampedIndex && (hoodTubes[index]?.contents.length ?? 0) > 0;

  // The ToR's own procedure: the acid is prepared in a second tube and
  // poured onto the copper, not tipped straight out of the bottle.
  const pourTubeIntoClamped = (index: number) => {
    if (clampedIndex === null || !canPourFrom(index)) return;
    tryPourBetweenTubes("fumeHood", index, clampedIndex);
  };

  if (!hasContent) return null;

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {/* Only when something stands in it: the clamped tube is drawn in the stand, and an empty rack just hides the bottles behind it. */}
      {hoodTubes.some((_, index) => index !== clampedIndex) && (
        <LabTestTubeRackInstance position={RACK_LOCAL}>
          {hoodTubes.map((tube, index) =>
            // The clamped tube is drawn in the stand's ring instead.
            index === clampedIndex ? null : (
              <group
                key={tube.instanceId}
                onClick={(event: ThreeEvent<MouseEvent>) => {
                  event.stopPropagation();
                  pourTubeIntoClamped(index);
                }}
                onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                  event.stopPropagation();
                  if (!canPourFrom(index)) return;
                  document.body.style.cursor = "pointer";
                }}
                onPointerOut={(event: ThreeEvent<PointerEvent>) => {
                  event.stopPropagation();
                  document.body.style.cursor = "auto";
                }}
              >
                <LabTestTubeInstance
                  position={computeTubeSlotLocalOffset(index)}
                  contents={tube.contents}
                />
              </group>
            ),
          )}
        </LabTestTubeRackInstance>
      )}

      {standInHood && (
        <group position={STAND_LOCAL} rotation={[0, STAND_ROTATION_Y, 0]}>
          <StandInFumeHood onActivate={handleStandClick} />
          <SpiritBurner />
          <HeatingRuntime />
          <TubeReactionRuntime tube={clampedIndex === null ? undefined : hoodTubes[clampedIndex]} />
          {clampedIndex !== null && hoodTubes[clampedIndex] && (
            <TubeFocusAnchor
              position={[
                TUBE_RING_LOCAL_OFFSET[0],
                TUBE_RING_LOCAL_OFFSET[1] - TUBE_RING_INSERT_DEPTH + TUBE_FOCUS_HEIGHT,
                TUBE_RING_LOCAL_OFFSET[2],
              ]}
            />
          )}
          {clampedIndex !== null && hoodTubes[clampedIndex] && (
            <group
              onClick={(event: ThreeEvent<MouseEvent>) => {
                // The tube stands in front of the stand's rod, so this must
                // not fall through to the stand's own click (heating).
                event.stopPropagation();
                if (!useHeatingStore.getState().active) useTubeCloseUpStore.getState().setViewing(true);
              }}
              onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                document.body.style.cursor = "zoom-in";
              }}
              onPointerOut={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                document.body.style.cursor = "auto";
              }}
            >
            <ClampTiltGroup>
            <LabTestTubeInstance
              position={[0, -TUBE_RING_INSERT_DEPTH, 0]}
              contents={hoodTubes[clampedIndex].contents}
              key={hoodTubes[clampedIndex].instanceId}
              chemistryId={hoodTubes[clampedIndex].instanceId}
              crackSpot={crackZone === null ? null : crackSpotForZone(crackZone)}
              inStand
            />
            </ClampTiltGroup>
            </group>
          )}
        </group>
      )}

      {hoodItems.map((item, index) => {
        const reagent = reagentConfig(item.reagentId);
        if (!reagent) return null;
        return (
          <group
            key={item.instanceId}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              event.stopPropagation();
              pourIntoClampedTube(item.reagentId);
            }}
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              if (clampedIndex === null) return;
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              document.body.style.cursor = "auto";
            }}
          >
            <ReagentStaticDisplay
              // Without `hoverable` the display renders no hitbox, and every
              // one of its own meshes has raycasting disabled — the click
              // handler on the wrapping group above could never fire.
              hoverable={clampedIndex !== null}
              reagent={reagent}
              position={
                sandbox
                  ? sandboxBottlePosition(index)
                  :[BOTTLES_LOCAL[0] + index * BOTTLE_SPACING_X, BOTTLES_LOCAL[1], BOTTLES_LOCAL[2]]
              }
            />
          </group>
        );
      })}
    </group>
  );
}

useGLTF.preload(STAND_MODEL_PATH);
