import { type ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { TUBE_CLAMP_PIVOT, useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { EQUIPMENT, type Position3 } from "../lib/layout";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useStandHintStore } from "../lib/useStandHintStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { computeTubeSlotLocalOffset, useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { LabTestTubeRackInstance } from "./LabTestTubeRackInstance";
import { ReagentStaticDisplay } from "./ReagentStaticDisplay";
import { DEFAULT_HOOD_STAND, hoodLampDefault, takeEquipment, useEquipmentPlacementStore } from "../lib/equipmentPlacement";
import { pressToTake } from "../lib/pressToTake";
import { EquipmentCarrier } from "./EquipmentCarrier";
import { SpiritBurner } from "./SpiritBurner";
import { StandStation, lampLayout } from "./StandStation";
import { HOOD_RACK_LOCAL, HOOD_STAND_LOCAL, HOOD_WORKTOP_Y, hoodBottleLocal } from "../lib/hoodLayout";
import { takeTargetEvents } from "./standTargetEvents";
import { useHandStore } from "../lib/useHandStore";
import { ArrivalFlight, GlassRim, PourMotion } from "./StandMotion";
import { POUR_POINT_HEIGHT, rackArrivalFor, useStandMotionStore } from "../lib/useStandMotionStore";

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
// The left part of the worktop is the carried tray's (VL-017) — see `hoodLayout.ts`.
const WORKTOP_Y = HOOD_WORKTOP_Y;
const RACK_LOCAL: Position3 = HOOD_RACK_LOCAL;
const STAND_LOCAL: Position3 = HOOD_STAND_LOCAL;

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

/** The lamp's own spot in the hood (VL-020) — where it used to stand beside the stand, in the stand's frame. */
const LONE_LAMP_POSITION = lampLayout(AWAY_FROM_PLAYER).lamp;
/** …and in the hood's own space, where the player may set it elsewhere (`useEquipmentPlacementStore`). */
const DEFAULT_HOOD_LAMP = hoodLampDefault(STAND_LOCAL, STAND_ROTATION_Y, LONE_LAMP_POSITION);
/** Half the width of the stand's base / the 7.6 cm lamp — how far a carried one is kept off other things. */
const STAND_BASE_RADIUS = 0.06;
const LAMP_RADIUS = 0.038;

/** A tube's mouth above its base — the 15 cm `LabTestTube.glb`. */
const TUBE_MOUTH_HEIGHT = 0.15;

const reagentConfig = (id: string): ReagentContainerConfig | undefined =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

/** The stand itself does nothing on a click — there is no close-up of it any more (VL-020). */
function StandInFumeHood() {
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
      // Still swallows the click, so it never falls through to what stands behind the stand.
      onClick={(event: ThreeEvent<MouseEvent>) => event.stopPropagation()}
      // The right button takes it into the hand (VL-018).
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        if (event.button !== 2) return;
        event.stopPropagation();
        pressToTake(event.nativeEvent, () => takeEquipment("stand", "fumeHood"));
      }}
      // Named on hover — where it stands and what is in its clamp.
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        useStandHintStore.getState().showLabel("stand-hood", "", { kind: "stand", place: "fumeHood" });
      }}
      onPointerOut={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        useStandHintStore.getState().hide("stand-hood");
      }}
    />
  );
}

/**
 * TEMP sandbox: all nine bottles along the back wall — see
 * `sandbox/setupSandbox.ts`. Split around the stand (hood-local X 0.18..0.42)
 * rather than one even row: a bottle standing behind the stand puts its
 * click hitbox in front of the stand's own and swallows the click that
 * should start heating.
 */
const SANDBOX_BOTTLE_Z = -0.17;
const SANDBOX_BOTTLE_X = [-0.58, -0.47, -0.36, -0.25, -0.14, -0.03, 0.47, 0.575, 0.68];
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
  const sandbox = useLaboratoryStore((state) => state.mode === "sandbox");
  const crackZone = useHeatingStore((state) => (state.phase === "cracked" ? state.crackZone : null));
  // A tube heated in the hand is drawn over the lamp meanwhile (`HandHeatRig`, VL-020).
  const heatedInHandId = useHeatingStore((state) =>
    state.active && state.target.mode === "hand" && state.target.location === "fumeHood" ? state.target.instanceId : null,
  );
  const lampInHood = useBurnerStore((state) => state.place === "fumeHood");
  const standSpot = useEquipmentPlacementStore((state) => state.standHood) ?? DEFAULT_HOOD_STAND;
  const lampSpot = useEquipmentPlacementStore((state) => state.lampHood) ?? DEFAULT_HOOD_LAMP;
  const heldId = useHandStore((state) => state.held?.instanceId ?? null);
  const rackArrivals = useStandMotionStore((state) => state.rackArrivals);

  const clampedIndex = standInHood ? attachedTubeSlotIndex : null;
  const hasContent = hoodTubes.length > 0 || hoodItems.length > 0 || standInHood || lampInHood;

  if (!hasContent) return null;

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {/* Only when something stands in it: the clamped tube is drawn in the stand, and an empty rack just hides the bottles behind it. */}
      {hoodTubes.some((_, index) => index !== clampedIndex) && (
        <LabTestTubeRackInstance position={RACK_LOCAL}>
          {hoodTubes.map((tube, index) =>
            // The clamped tube is drawn in the stand's ring instead.
            index === clampedIndex || tube.instanceId === heatedInHandId ? null : (
              <group
                key={tube.instanceId}
                {...takeTargetEvents(
                  tube.instanceId,
                  { kind: "rack-tube", location: "fumeHood", index },
                  { kind: "tube", location: "fumeHood", index, instanceId: tube.instanceId },
                )}
              >
                <group position={computeTubeSlotLocalOffset(index)}>
                  {/* In the hand it follows it, outlined, and pours like a bottle (VL-015). */}
                  <PourMotion instanceId={tube.instanceId} pourPointHeight={TUBE_MOUTH_HEIGHT}>
                    <GlassRim active={heldId === tube.instanceId}>
                      {/* Back from the clamp: seen flying home to its slot. */}
                      <ArrivalFlight arrival={rackArrivalFor(rackArrivals, "fumeHood", index)}>
                        <LabTestTubeInstance contents={tube.contents} />
                      </ArrivalFlight>
                    </GlassRim>
                  </PourMotion>
                </group>
              </group>
            ),
          )}
        </LabTestTubeRackInstance>
      )}

      {standInHood && (
        <group position={[standSpot.x, STAND_LOCAL[1], standSpot.z]} rotation={[0, STAND_ROTATION_Y, 0]}>
          <EquipmentCarrier what="stand" location="fumeHood" radius={STAND_BASE_RADIUS}>
            <StandInFumeHood />
            <StandStation
              location="fumeHood"
              away={AWAY_FROM_PLAYER}
              tube={clampedIndex === null ? undefined : hoodTubes[clampedIndex]}
              crackZone={crackZone}
            />
          </EquipmentCarrier>
        </group>
      )}

      {/* In its own place beside the stand's, with the stand or without it (VL-020) — or where the player set it. */}
      {lampInHood && (
        <group position={[lampSpot.x, STAND_LOCAL[1], lampSpot.z]} rotation={[0, STAND_ROTATION_Y, 0]}>
          <EquipmentCarrier what="lamp" location="fumeHood" radius={LAMP_RADIUS}>
            <SpiritBurner position={[0, 0, 0]} place="fumeHood" />
          </EquipmentCarrier>
        </group>
      )}

      {hoodItems.map((item, index) => {
        const reagent = reagentConfig(item.reagentId);
        if (!reagent) return null;
        const target = { kind: "bottle", location: "fumeHood", reagentId: item.reagentId, instanceId: item.instanceId } as const;
        // Taken on the press — dragged or clicked (`pressToTake`, VL-018).
        const { onClick, onPointerDown } = takeTargetEvents(item.instanceId, target, {
          kind: "bottle",
          location: "fumeHood",
          instanceId: item.instanceId,
          reagentId: item.reagentId,
          containerType: reagent.containerType,
        });
        return (
          <group key={item.instanceId} onClick={onClick} onPointerDown={onPointerDown}>
            <PourMotion
              instanceId={item.instanceId}
              pourPointHeight={POUR_POINT_HEIGHT[reagent.containerType]}
              position={
                sandbox
                  ? sandboxBottlePosition(index)
                  : hoodBottleLocal(index)
              }
            >
              <ReagentStaticDisplay
                // Without `hoverable` the display renders no hitbox, and every
                // one of its own meshes has raycasting disabled — the click
                // handler on the wrapping group above could never fire. Always
                // on: a bottle that can't be poured yet still says why.
                hoverable
                highlighted={heldId === item.instanceId}
                onHoverChange={(hovered) =>
                  hovered
                    ? useStandHintStore.getState().show(item.instanceId, target)
                    : useStandHintStore.getState().hide(item.instanceId)
                }
                reagent={reagent}
              />
            </PourMotion>
          </group>
        );
      })}
    </group>
  );
}

