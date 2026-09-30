import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { applyErrorRule } from "../../../features/tablet/lib/penalties";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { TUBE_CLAMP_MODEL_PATH, TUBE_CLAMP_PIVOT, useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { CLAMP_TUBE_AXIS_X } from "../lib/bunsenStandGeometry";
import { heldClampPose } from "../lib/heldClampPose";
import { EQUIPMENT, type Position3 } from "../lib/layout";
import { tryAddToTube, tryPourBetweenTubes } from "../lib/pourIntoTube";
import {
  TUBE_RING_INSERT_DEPTH,
  TUBE_RING_LOCAL_OFFSET,
  useBunsenStandStorageStore,
} from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { bottomInFlame, crackSpotForZone, useHeatingStore } from "../lib/useHeatingStore";
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
import { FLAME_BASE_Y, FLAME_HEIGHT, SpiritBurner } from "./SpiritBurner";

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
 * A dead-on quarter turn put the rod exactly behind the tube: the metal
 * showed through the liquid and the whole column read as a steel rod. This
 * much off the camera axis moves the rod beside the tube while the tube
 * still faces the camera.
 */
const STAND_TURN_ASIDE = 0.5;

/**
 * The stand's ring arm points along the model's +X, i.e. sideways across
 * the hood, so the clamped tube hid beside the rod. A quarter turn points
 * the arm at the sash — at the camera — with the tube in front of the rod,
 * and turns the heating sweep (the tube's local Z) into left-right motion on
 * screen, the same axis as the knob's track.
 */
const STAND_ROTATION_Y = -Math.PI / 2 + STAND_TURN_ASIDE;

/** "Away from the player" (the hood's back wall, hood -Z) in the stand's own turned space. */
const AWAY_FROM_PLAYER = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -STAND_ROTATION_Y);
/** The player's right in the stand's own turned space. */
const PLAYER_RIGHT = new THREE.Vector3().crossVectors(AWAY_FROM_PLAYER, new THREE.Vector3(0, 1, 0)).normalize();
/**
 * How far to the player's right of the clamp's resting spot the lamp stands.
 * On the V's left arm the held tube leans its mouth up-left, towards the
 * stand's rod; this much room keeps the glass off the rod.
 */
const LAMP_ASIDE = 0.08;
const LAMP_LOCAL: Position3 = [
  TUBE_RING_LOCAL_OFFSET[0] + PLAYER_RIGHT.x * LAMP_ASIDE,
  0,
  TUBE_RING_LOCAL_OFFSET[2] + PLAYER_RIGHT.z * LAMP_ASIDE,
];
/** The flame's hot zone — its upper third (flame logic, section 3) — in the stand's space. */
const FLAME_HOT_SPOT = new THREE.Vector3(LAMP_LOCAL[0], FLAME_BASE_Y + FLAME_HEIGHT * 0.7, LAMP_LOCAL[2]);
/** Seconds to take the clamp off the boss and bring the tube to the flame, and back. */
const CLAMP_MOVE_SECONDS = 0.7;
/** How high the clamp lifts clear of the boss on its way. */
const CLAMP_MOVE_LIFT = 0.03;

/** Experiment 1's «пробирка нагрета без предварительного прогрева» — what a crack costs. */
const HEAT_ERROR_RULE_ID = "error-1-heat";
const HOLDER_ITEM_ID = "equipment-holder";

const reagentConfig = (id: string): ReagentContainerConfig | undefined =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

function StandInFumeHood({ onActivate }: { readonly onActivate: () => void }) {
  const scene = useBunsenStandScene();
  const { instance } = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    // The clamp is drawn by `HeldClampRig`, which can take it off the boss.
    const clampPivot = clone.getObjectByName(TUBE_CLAMP_PIVOT);
    if (clampPivot) clampPivot.visible = false;
    return { instance: clone };
  }, [scene]);

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
function HeldClampRig({ children }: { readonly children: ReactNode }) {
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
    const pose = heldClampPose(heating.sweep, FLAME_HOT_SPOT, AWAY_FROM_PLAYER, TUBE_RING_INSERT_DEPTH);
    rig.position.lerpVectors(restJaws, pose.jaws, k);
    rig.position.y += CLAMP_MOVE_LIFT * Math.sin(Math.PI * k);
    rig.quaternion.slerpQuaternions(restQuaternion, pose.quaternion, k);

    const focus = focusRef.current;
    if (focus) {
      // Halfway up the hanging tube at rest; just above the flame while
      // heating — steadier than following every move of the ellipse.
      focus.position.set(restJaws.x, restJaws.y - TUBE_RING_INSERT_DEPTH + TUBE_FOCUS_HEIGHT, restJaws.z);
      focus.position.lerp(HEATING_FOCUS, k);
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

/**
 * Height above the tube's base that the close-up camera aims at: the middle
 * of the 15 cm tube. Lower cut off the gas leaving the mouth — the one sign
 * experiment 1 hinges on — at the top of the frame.
 */
const TUBE_FOCUS_HEIGHT = 0.08;
/** Close-up focus while heating: a little above the flame, where the tube passes through it. */
const HEATING_FOCUS = FLAME_HOT_SPOT.clone().setY(FLAME_HOT_SPOT.y + 0.03);

/** Publishes the tube's focus point for `CameraRig`'s close-up — see `TUBE_FOCUS`. Positioned by its owner. */
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
          <SpiritBurner position={LAMP_LOCAL} />
          <HeatingRuntime />
          <TubeReactionRuntime tube={clampedIndex === null ? undefined : hoodTubes[clampedIndex]} />
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
            <HeldClampRig>
            <LabTestTubeInstance
              contents={hoodTubes[clampedIndex].contents}
              key={hoodTubes[clampedIndex].instanceId}
              chemistryId={hoodTubes[clampedIndex].instanceId}
              crackSpot={crackZone === null ? null : crackSpotForZone(crackZone)}
              inStand
            />
            </HeldClampRig>
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

