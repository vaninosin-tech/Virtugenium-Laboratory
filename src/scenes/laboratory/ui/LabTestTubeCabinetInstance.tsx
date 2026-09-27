import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { getCabinetParallelTrayYaw, type HotspotTargetId, type Position3 } from "../lib/layout";
import { prepareTestTube } from "../lib/testTubeMaterials";
import { useNavButtonCalibrationStore } from "../lib/useNavButtonCalibrationStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import {
  computeTubeSlotPosition,
  TEST_TUBE_TRAY_CAPACITY,
  TRAY_RACK_ANCHOR,
  useTestTubeStorageStore,
} from "../lib/useTestTubeStorageStore";
import { LabTestTubeInstance } from "./LabTestTubeInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";

const MODEL_PATH = "/assets/models/LabTestTube.glb";
let takenTubeSequence = 0;
/**
 * Tubes not yet committed to `useTestTubeStorageStore` (still mid-flight) but
 * already promised a tray slot — shared across every `LabTestTubeCabinetInstance`
 * so two tubes clicked in quick succession (before either lands) still get
 * distinct, correctly-ordered rack slots instead of both aiming at the same
 * one. Incremented at click time, decremented once that flight commits.
 */
let pendingFlightCount = 0;

/** Shelf → tray-slot flight duration, seconds — same fixed-duration deterministic tween as `ReagentContainerInstance`'s own "takeMove" (not damping, for the same reason: damping-then-snap reads as a shrink/pop, see its doc). */
const FLIGHT_DURATION_S = 0.32;
/**
 * Final vertical-drop leg, straight down into the rack's insert collar — the
 * literal "insertion" motion the player asked to have back, distinct from the
 * cross-room leg above it so the tube visibly plugs into its hole instead of
 * arriving on a single straight line that could clip through the rack's rim.
 */
const INSERT_DURATION_S = 0.16;
/** How far above the target hole the flight aims before the final straight-down insert — scaled by the tray's own live scale so it stays proportional whether the tray is held close or calibrated smaller/larger. */
const INSERT_APPROACH_HEIGHT = 0.05;

type Phase = "atRest" | "flight" | "insert";

/**
 * One stocked tube in the glassware cabinet. Clicking it flies a transient
 * visual copy from the shelf to its assigned hole in the tray's rack, ending
 * with a short straight drop that plugs it into the collar — only then is it
 * added to `useTestTubeStorageStore`, handing off to the permanent tray copy
 * (`LabTrayInstance`) with no visible pop, since both compute the exact same
 * end pose (see `handleClick`'s tray-anchor math, mirrored from
 * `ReagentContainerInstance`'s own take-flight). The shelf original itself
 * never moves or hides — glassware is an infinite dispenser (see
 * `useTestTubeStorageStore`'s doc), so all 16 stocked positions stay visibly
 * filled while the cabinet is open; only the flying clone disappears once it
 * lands.
 */
export function LabTestTubeCabinetInstance({
  id,
  cabinetId,
  position = [0, 0, 0],
  rotationY = 0,
}: {
  readonly id: string;
  /** Which cabinet this shelf slot belongs to — needed to match the held tray's yaw (see `getCabinetParallelTrayYaw`). */
  readonly cabinetId: HotspotTargetId;
  readonly position?: Position3;
  readonly rotationY?: number;
}) {
  const { scene } = useGLTF(MODEL_PATH);
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);
  const [isFlying, setIsFlying] = useState(false);
  const storedTubeCount = useTestTubeStorageStore(
    (state) => state.trayTestTubes.length + state.workbenchTestTubes.length,
  );
  const isCabinetInspectable = useSceneInteractionStore(
    (state) => state.focusedCabinetId === "cabinet-glassware" && state.cabinetPhase === "inspecting",
  );
  const canTake = isCabinetInspectable && storedTubeCount < TEST_TUBE_TRAY_CAPACITY;

  const instance = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => prepareTestTube(instance), [instance]);

  const shelfGroupRef = useRef<THREE.Group>(null);
  const flightGroupRef = useRef<THREE.Group>(null);

  const phaseRef = useRef<Phase>("atRest");
  const elapsedRef = useRef(0);
  const startPosRef = useRef(new THREE.Vector3());
  const startQuatRef = useRef(new THREE.Quaternion());
  const approachPosRef = useRef(new THREE.Vector3());
  const endPosRef = useRef(new THREE.Vector3());
  const endQuatRef = useRef(new THREE.Quaternion());
  const flightWorldPosRef = useRef(new THREE.Vector3());
  const flightWorldQuatRef = useRef(new THREE.Quaternion());
  const flightParentQuatRef = useRef(new THREE.Quaternion());
  const flightStartScaleRef = useRef(1);
  const flightEndScaleRef = useRef(1);
  const pendingInstanceIdRef = useRef<string | null>(null);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!canTake || phaseRef.current !== "atRest") return;
    const shelfGroup = shelfGroupRef.current;
    if (!shelfGroup) return;
    const storedNow = useTestTubeStorageStore.getState().trayTestTubes.length +
      useTestTubeStorageStore.getState().workbenchTestTubes.length +
      pendingFlightCount;
    if (storedNow >= TEST_TUBE_TRAY_CAPACITY) return;

    takenTubeSequence += 1;
    pendingInstanceIdRef.current = `${id}-taken-${Date.now()}-${takenTubeSequence}`;

    // START: the shelf slot's own (never-moving) world pose.
    shelfGroup.getWorldPosition(startPosRef.current);
    shelfGroup.getWorldQuaternion(startQuatRef.current);
    const parentWorldScale = new THREE.Vector3();
    shelfGroup.getWorldScale(parentWorldScale);
    flightStartScaleRef.current = 1;

    // END: the exact final held-tray rack-hole WORLD pose — same camera-relative
    // anchor + cabinet-parallel yaw + local rotation offsets `LabTrayInstance`
    // and `ReagentContainerInstance` already use, so the hand-off to the
    // permanent tray copy lands exactly here with no pop.
    const heldTray = useNavButtonCalibrationStore.getState().heldTray;
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const trayAnchorWorld = camera.position
      .clone()
      .addScaledVector(cameraRight, heldTray.x)
      .addScaledVector(cameraUp, heldTray.y)
      .addScaledVector(cameraForward, heldTray.z);
    const trayWorldQuat = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), getCabinetParallelTrayYaw(cabinetId))
      .multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(heldTray.rotX, heldTray.rotY, heldTray.rotZ, "YXZ"),
        ),
      );
    const slotIndex = useTestTubeStorageStore.getState().trayTestTubes.length + pendingFlightCount;
    pendingFlightCount += 1;
    const slotLocal = computeTubeSlotPosition(TRAY_RACK_ANCHOR, slotIndex);
    const slotOffsetWorld = new THREE.Vector3(...slotLocal)
      .multiplyScalar(heldTray.scale)
      .applyQuaternion(trayWorldQuat);
    endPosRef.current.copy(trayAnchorWorld).add(slotOffsetWorld);
    endQuatRef.current.copy(trayWorldQuat);
    flightEndScaleRef.current = heldTray.scale / parentWorldScale.x;

    // Approach point: straight above the hole, along the tray's own (possibly
    // slightly tilted) up axis — the flight heads here first, then the
    // "insert" phase drops straight down into the collar.
    const trayUpWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(trayWorldQuat);
    approachPosRef.current
      .copy(endPosRef.current)
      .addScaledVector(trayUpWorld, INSERT_APPROACH_HEIGHT * heldTray.scale);

    elapsedRef.current = 0;
    phaseRef.current = "flight";
    setIsFlying(true);
  };

  const finishFlight = () => {
    phaseRef.current = "atRest";
    setIsFlying(false);
    pendingFlightCount = Math.max(0, pendingFlightCount - 1);
    const instanceId = pendingInstanceIdRef.current;
    pendingInstanceIdRef.current = null;
    if (instanceId) {
      useTestTubeStorageStore.getState().takeTestTube({ instanceId, contents: [] });
    }
  };

  useFrame((_, delta) => {
    const phase = phaseRef.current;
    if (phase === "atRest") return;
    const group = flightGroupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;

    if (phase === "flight") {
      elapsedRef.current += delta;
      const t = THREE.MathUtils.clamp(elapsedRef.current / FLIGHT_DURATION_S, 0, 1);
      const ease = t * t * (3 - 2 * t);
      const worldPos = flightWorldPosRef.current.lerpVectors(startPosRef.current, approachPosRef.current, ease);
      const worldQuat = flightWorldQuatRef.current.copy(startQuatRef.current).slerp(endQuatRef.current, ease);
      group.position.copy(parent.worldToLocal(worldPos.clone()));
      const parentWorldQuat = parent.getWorldQuaternion(flightParentQuatRef.current);
      group.quaternion.copy(parentWorldQuat.clone().invert().multiply(worldQuat));
      group.scale.setScalar(THREE.MathUtils.lerp(flightStartScaleRef.current, flightEndScaleRef.current, ease));
      if (t >= 1) {
        elapsedRef.current = 0;
        phaseRef.current = "insert";
      }
      return;
    }

    // phase === "insert": short straight drop from just above the rack hole
    // into the collar — the literal insertion motion.
    elapsedRef.current += delta;
    const t = THREE.MathUtils.clamp(elapsedRef.current / INSERT_DURATION_S, 0, 1);
    const ease = t * t;
    const worldPos = flightWorldPosRef.current.lerpVectors(approachPosRef.current, endPosRef.current, ease);
    group.position.copy(parent.worldToLocal(worldPos.clone()));
    const parentWorldQuat = parent.getWorldQuaternion(flightParentQuatRef.current);
    group.quaternion.copy(parentWorldQuat.clone().invert().multiply(endQuatRef.current));
    group.scale.setScalar(flightEndScaleRef.current);
    if (t >= 1) finishFlight();
  });

  return (
    <group
      ref={shelfGroupRef}
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        if (canTake) setHovered(true);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(false);
      }}
    >
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={hovered && canTake} />
      {isFlying && (
        <group ref={flightGroupRef}>
          <LabTestTubeInstance />
        </group>
      )}
    </group>
  );
}

useGLTF.preload(MODEL_PATH);
