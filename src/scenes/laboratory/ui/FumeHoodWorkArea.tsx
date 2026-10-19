import { type ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { TUBE_CLAMP_PIVOT, useBunsenStandScene } from "../lib/bunsenStandAssembly";
import { EQUIPMENT, type Position3 } from "../lib/layout";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useStandHintStore } from "../lib/useStandHintStore";
import { useFurniturePositionStore } from "../lib/useFurniturePositionStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { computeTubeSlotLocalOffset, useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { TUBE_OUTLINE_PARTS } from "./NormalHoverOutline";
import { NormalHoverOutline } from "./NormalHoverOutlineGroup";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { LabTestTubeRackInstance } from "./LabTestTubeRackInstance";
import { ReagentStaticDisplay } from "./ReagentStaticDisplay";
import { SpiritBurner } from "./SpiritBurner";
import { StandStation } from "./StandStation";
import { HOOD_AWAY_FROM_PLAYER, HOOD_LONE_LAMP_POSITION, HOOD_STAND_ROTATION_Y } from "./equipmentPlaces";
import { HOOD_RACK_LOCAL, HOOD_STAND_LOCAL, hoodBottleLocal } from "../lib/hoodLayout";
import { takeTargetEvents } from "./standTargetEvents";
import { useHandStore } from "../lib/useHandStore";
import { ArrivalFlight, GlassRim, PourMotion } from "./StandMotion";
import { POUR_POINT_HEIGHT, useStandMotionStore } from "../lib/useStandMotionStore";

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
const RACK_LOCAL: Position3 = HOOD_RACK_LOCAL;
const STAND_LOCAL: Position3 = HOOD_STAND_LOCAL;

// The stand's turn, its "away" and the lamp's own spot in the hood (`equipmentPlaces`).
const STAND_ROTATION_Y = HOOD_STAND_ROTATION_Y;
const AWAY_FROM_PLAYER = HOOD_AWAY_FROM_PLAYER;
const LONE_LAMP_POSITION = HOOD_LONE_LAMP_POSITION;

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
    />
  );
}

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
  const crackZone = useHeatingStore((state) => (state.phase === "cracked" ? state.crackZone : null));
  // A tube heated in the hand is drawn over the lamp meanwhile (`HandHeatRig`, VL-020).
  const heatedInHandId = useHeatingStore((state) =>
    state.active && state.target.mode === "hand" && state.target.location === "fumeHood" ? state.target.instanceId : null,
  );
  const lampInHood = useBurnerStore((state) => state.place === "fumeHood");
  const heldId = useHandStore((state) => state.held?.instanceId ?? null);
  const hintOwner = useStandHintStore((state) => state.owner);
  const standArrival = useStandMotionStore((state) => (state.equipmentArrival?.what === "stand" ? state.equipmentArrival : null));
  const lampArrival = useStandMotionStore((state) => (state.equipmentArrival?.what === "lamp" ? state.equipmentArrival : null));
  const rackArrival = useStandMotionStore((state) => (state.rackArrival?.location === "fumeHood" ? state.rackArrival : null));

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
                      {/* Hovered (its caption up): the silhouette outline. */}
                      <NormalHoverOutline active={hintOwner === tube.instanceId && heldId !== tube.instanceId} parts={TUBE_OUTLINE_PARTS}>
                        {/* Back from the clamp: seen flying home to its slot. */}
                        <ArrivalFlight arrival={rackArrival?.index === index ? rackArrival : null}>
                          <LabTestTubeInstance contents={tube.contents} />
                        </ArrivalFlight>
                      </NormalHoverOutline>
                    </GlassRim>
                  </PourMotion>
                </group>
              </group>
            ),
          )}
        </LabTestTubeRackInstance>
      )}

      {standInHood && (
        <group position={STAND_LOCAL} rotation={[0, STAND_ROTATION_Y, 0]}>
          {/* Set down off the tray: seen going from the hand into its place. */}
          <ArrivalFlight arrival={standArrival} fromFirstFrame>
            <StandInFumeHood />
            <StandStation
              location="fumeHood"
              away={AWAY_FROM_PLAYER}
              tube={clampedIndex === null ? undefined : hoodTubes[clampedIndex]}
              crackZone={crackZone}
            />
          </ArrivalFlight>
        </group>
      )}

      {/* In its own place beside the stand's, with the stand or without it (VL-020). */}
      {lampInHood && (
        <group position={STAND_LOCAL} rotation={[0, STAND_ROTATION_Y, 0]}>
          <group position={LONE_LAMP_POSITION}>
            <ArrivalFlight arrival={lampArrival} fromFirstFrame>
              <SpiritBurner position={[0, 0, 0]} place="fumeHood" />
            </ArrivalFlight>
          </group>
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
              pourSource={{ reagentId: item.reagentId, location: "fumeHood" }}
              position={hoodBottleLocal(index)}
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

