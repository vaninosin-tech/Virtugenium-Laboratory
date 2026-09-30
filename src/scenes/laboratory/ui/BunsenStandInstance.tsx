import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { useBunsenStandScene } from "../lib/bunsenStandAssembly";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { getCabinetParallelTrayYaw, type HotspotTargetId, type Position3 } from "../lib/layout";
import { useNavButtonCalibrationStore } from "../lib/useNavButtonCalibrationStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import {
  BUNSEN_STAND_TRAY_REST_POSITION,
  STAND_BASE_BOTTOM_OFFSET,
  useBunsenStandStorageStore,
} from "../lib/useBunsenStandStorageStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { ReagentHoverRim } from "./ReagentHoverRim";


/** Deterministic shelf -> held-tray flight, same tween shape as `ReagentContainerInstance`'s own "takeMove" (see its doc for why a fixed-duration lerp/slerp, not damping-then-snap). */
const TAKE_DURATION_S = 0.36;
/** True/real-world size while riding the tray — there's only one stand, so unlike reagents (`heldTray.reagentScale`) this has no dev-tunable slider of its own. */
const TRAY_WORLD_SCALE = 1;

type Phase = "atRest" | "flight" | "returnFlight";

/**
 * Retort/Bunsen stand — heavy round base, rod, sliding test-tube ring and
 * burner support ring. Shelf copy for `cabinet-lab-equipment`: sits at
 * `position` until clicked, then flies to the held tray's own dedicated spot
 * (`BUNSEN_STAND_TRAY_ANCHOR` — not the 4x2 reagent grid or the glued-in
 * test-tube rack, see that constant's doc) and hands off to
 * `BunsenStandTrayDisplay`, the static copy `LabTrayInstance` renders as a
 * child of the tray's own group (so it inherits the tray's live held/return
 * transform "for free", same as `ReagentStaticDisplay`). Only one stand
 * exists — `useBunsenStandStorageStore` is a plain on/off flag, not a
 * per-instance list like the reagent/test-tube stores.
 */
export function BunsenStandInstance({
  cabinetId,
  position = [0, 0, 0],
  rotationY = 0,
}: {
  readonly cabinetId: HotspotTargetId;
  readonly position?: Position3;
  readonly rotationY?: number;
}) {
  const scene = useBunsenStandScene();
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);

  const onTray = useBunsenStandStorageStore((state) => state.onTray);
  const onWorkbench = useBunsenStandStorageStore((state) => state.onWorkbench);
  const isCabinetInspectable = useSceneInteractionStore(
    (state) => state.focusedCabinetId === cabinetId && state.cabinetPhase === "inspecting",
  );
  // Same "one free hand" rule `ReagentContainerInstance`/the workbench jar
  // and rack interactions already enforce — leaving the table with a tube
  // still held (nothing drops it on the way out, see `Laboratory.tsx`'s
  // `returnToOverview`) must not let the player also take the stand.
  const tubeHeld = useTestTubeDragStore((state) => state.heldInstanceId !== null);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    disableRaycast(clone);
    return clone;
  }, [scene]);

  const hoverHitboxGeometry = useMemo(() => createHoverHitboxGeometry(instance), [instance]);

  useEffect(() => {
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, () => {});
  }, [instance]);
  useEffect(() => {
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  const groupRef = useRef<THREE.Group>(null);
  const phaseRef = useRef<Phase>("atRest");
  const elapsedRef = useRef(0);
  const startPosRef = useRef(new THREE.Vector3());
  const startQuatRef = useRef(new THREE.Quaternion());
  const endPosRef = useRef(new THREE.Vector3());
  const endQuatRef = useRef(new THREE.Quaternion());
  const flightWorldPosRef = useRef(new THREE.Vector3());
  const flightWorldQuatRef = useRef(new THREE.Quaternion());
  const flightParentQuatRef = useRef(new THREE.Quaternion());
  const flightStartScaleRef = useRef(1);
  const flightEndScaleRef = useRef(1);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!isCabinetInspectable || onTray || phaseRef.current !== "atRest" || tubeHeld) return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;

    group.getWorldPosition(startPosRef.current);
    group.getWorldQuaternion(startQuatRef.current);

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
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(heldTray.rotX, heldTray.rotY, heldTray.rotZ, "YXZ")));
    const slotOffsetWorld = new THREE.Vector3(...BUNSEN_STAND_TRAY_REST_POSITION)
      .multiplyScalar(heldTray.scale)
      .applyQuaternion(trayWorldQuat);
    endPosRef.current.copy(trayAnchorWorld).add(slotOffsetWorld);
    endQuatRef.current.copy(trayWorldQuat);

    const parentWorldScale = new THREE.Vector3();
    parent.getWorldScale(parentWorldScale);
    flightStartScaleRef.current = 1;
    flightEndScaleRef.current = TRAY_WORLD_SCALE / parentWorldScale.x;

    elapsedRef.current = 0;
    phaseRef.current = "flight";
  };

  // `position` is the shelf SURFACE height; the model's own root origin sits
  // level with `StandBase`'s TOP, not its bottom (see `STAND_BASE_BOTTOM_OFFSET`'s
  // doc), so resting it directly at `position` sank the base 12mm into the
  // shelf.
  const homePosition = useMemo(
    () => new THREE.Vector3(position[0], position[1] + STAND_BASE_BOTTOM_OFFSET, position[2]),
    [position],
  );
  const positionArray = useMemo(
    () => [homePosition.x, homePosition.y, homePosition.z] as const,
    [homePosition],
  );
  const homeQuaternion = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    [rotationY],
  );

  // A click on the tray copy (`BunsenStandTrayDisplay`) captured its exact
  // world pose and asked for it back — `onTray` already went false in the
  // same store update, so this shelf original is about to render again.
  // Snap it to that captured pose first, then fly it home to `position`
  // reusing the same deterministic tween as the outbound take (mirrors
  // `ReagentContainerInstance`'s own `returnRequest` effect).
  const returnRequest = useBunsenStandStorageStore((state) => state.returnRequest);
  useEffect(() => {
    if (!returnRequest) return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;

    startPosRef.current.set(...returnRequest.worldPos);
    startQuatRef.current.set(...returnRequest.worldQuat);
    const parentWorldQuat = new THREE.Quaternion();
    parent.getWorldQuaternion(parentWorldQuat);
    group.position.copy(parent.worldToLocal(startPosRef.current.clone()));
    group.quaternion.copy(parentWorldQuat.clone().invert().multiply(startQuatRef.current));
    const parentWorldScale = new THREE.Vector3();
    parent.getWorldScale(parentWorldScale);
    flightStartScaleRef.current = returnRequest.worldScale / parentWorldScale.x;
    flightEndScaleRef.current = 1;
    group.scale.setScalar(flightStartScaleRef.current);

    endPosRef.current.copy(parent.localToWorld(homePosition.clone()));
    endQuatRef.current.copy(parentWorldQuat).multiply(homeQuaternion);

    elapsedRef.current = 0;
    phaseRef.current = "returnFlight";
    useBunsenStandStorageStore.getState().clearReturnRequest();
  }, [returnRequest, homePosition, homeQuaternion]);

  useFrame((_, delta) => {
    const phase = phaseRef.current;
    if (phase !== "flight" && phase !== "returnFlight") return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;

    elapsedRef.current += delta;
    const t = THREE.MathUtils.clamp(elapsedRef.current / TAKE_DURATION_S, 0, 1);
    const ease = t * t * (3 - 2 * t);
    const worldPos = flightWorldPosRef.current.lerpVectors(startPosRef.current, endPosRef.current, ease);
    const worldQuat = flightWorldQuatRef.current.copy(startQuatRef.current).slerp(endQuatRef.current, ease);
    group.position.copy(parent.worldToLocal(worldPos.clone()));
    const parentWorldQuat = parent.getWorldQuaternion(flightParentQuatRef.current);
    group.quaternion.copy(parentWorldQuat.clone().invert().multiply(worldQuat));
    group.scale.setScalar(THREE.MathUtils.lerp(flightStartScaleRef.current, flightEndScaleRef.current, ease));

    if (t >= 1) {
      if (phase === "flight") {
        useBunsenStandStorageStore.getState().take();
      } else {
        group.position.copy(homePosition);
        group.quaternion.copy(homeQuaternion);
        group.scale.setScalar(1);
      }
      phaseRef.current = "atRest";
    }
  });

  if (onTray || onWorkbench) return null;

  return (
    <group
      ref={groupRef}
      position={positionArray}
      rotation={[0, rotationY, 0]}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        if (isCabinetInspectable && !tubeHeld) setHovered(true);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(false);
      }}
    >
      <primitive object={instance} />
      <ReagentHoverRim object={instance} active={hovered && isCabinetInspectable} />
      <mesh geometry={hoverHitboxGeometry}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

