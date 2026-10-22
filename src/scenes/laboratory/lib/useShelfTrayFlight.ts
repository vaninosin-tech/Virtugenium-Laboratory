import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { getCabinetParallelTrayYaw, type HotspotTargetId, type Position3 } from "./layout";
import { useNavButtonCalibrationStore } from "./useNavButtonCalibrationStore";

/** Deterministic shelf -> held-tray flight, same tween shape as `ReagentContainerInstance`'s own "takeMove" (see its doc for why a fixed-duration lerp/slerp, not damping-then-snap). */
const TAKE_DURATION_S = 0.36;
/** How high over its tray place the flight arcs (tray-local metres) — over the bottles and the other equipment. */
const TRAY_ARC_HEIGHT = 0.36;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

type Phase = "atRest" | "flight" | "returnFlight";

/** Captured world pose of a tray copy clicked back to its shelf — "hand off exactly where it visually was". */
export interface ShelfReturnRequest {
  readonly worldPos: Position3;
  readonly worldQuat: readonly [number, number, number, number];
  readonly worldScale: number;
}

/**
 * The flight of a single piece of equipment (the stand, the spirit lamp)
 * between its cabinet shelf and its own spot on the held tray, and back.
 * The shelf copy calls `beginTake()` on click; at the end of the flight
 * `onArrived` hands it over to the tray copy. A `returnRequest` from the tray
 * copy flies it home from wherever the tray copy was.
 *
 * Extracted from `BunsenStandInstance` when the lamp became its own item.
 *
 * @param home the resting pose on the shelf, in the parent's local space
 * @param trayRestPosition the item's spot in the tray's local space
 * @param trayWorldScale real-world size while on the tray
 */
export function useShelfTrayFlight({
  cabinetId,
  home,
  rotationY,
  trayRestPosition,
  trayWorldScale = 1,
  returnRequest,
  onArrived,
  onReturnHandled,
}: {
  readonly cabinetId: HotspotTargetId;
  readonly home: Position3;
  readonly rotationY: number;
  readonly trayRestPosition: Position3;
  readonly trayWorldScale?: number;
  readonly returnRequest: ShelfReturnRequest | null;
  readonly onArrived: () => void;
  readonly onReturnHandled: () => void;
}) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const phaseRef = useRef<Phase>("atRest");
  const elapsedRef = useRef(0);
  const startPosRef = useRef(new THREE.Vector3());
  const startQuatRef = useRef(new THREE.Quaternion());
  const endPosRef = useRef(new THREE.Vector3());
  /** The arc's control point: high over the tray place — down into it on the way there, up out of it on the way back. */
  const arcRef = useRef(new THREE.Vector3());
  const endQuatRef = useRef(new THREE.Quaternion());
  const flightWorldPosRef = useRef(new THREE.Vector3());
  const flightWorldQuatRef = useRef(new THREE.Quaternion());
  const flightParentQuatRef = useRef(new THREE.Quaternion());
  const flightStartScaleRef = useRef(1);
  const flightEndScaleRef = useRef(1);

  const homePosition = useMemo(() => new THREE.Vector3(...home), [home]);
  const homeQuaternion = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    [rotationY],
  );

  /** Starts the flight to the tray. False if it is already moving. */
  const beginTake = (): boolean => {
    if (phaseRef.current !== "atRest") return false;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return false;

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
    const slotOffsetWorld = new THREE.Vector3(...trayRestPosition)
      .multiplyScalar(heldTray.scale)
      .applyQuaternion(trayWorldQuat);
    endPosRef.current.copy(trayAnchorWorld).add(slotOffsetWorld);
    arcRef.current.copy(endPosRef.current).addScaledVector(WORLD_UP, TRAY_ARC_HEIGHT * heldTray.scale);
    endQuatRef.current.copy(trayWorldQuat);

    const parentWorldScale = new THREE.Vector3();
    parent.getWorldScale(parentWorldScale);
    flightStartScaleRef.current = 1;
    flightEndScaleRef.current = trayWorldScale / parentWorldScale.x;

    elapsedRef.current = 0;
    phaseRef.current = "flight";
    return true;
  };

  // The tray copy captured its world pose and asked to go back; the shelf
  // copy renders again in the same store update. Snap it to that pose, then
  // fly it home with the same tween as the take.
  useEffect(() => {
    if (!returnRequest) return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;

    startPosRef.current.set(...returnRequest.worldPos);
    arcRef.current
      .copy(startPosRef.current)
      .addScaledVector(WORLD_UP, TRAY_ARC_HEIGHT * useNavButtonCalibrationStore.getState().heldTray.scale);
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
    onReturnHandled();
  }, [returnRequest, homePosition, homeQuaternion, onReturnHandled]);

  useFrame((_, delta) => {
    const phase = phaseRef.current;
    if (phase !== "flight" && phase !== "returnFlight") return;
    const group = groupRef.current;
    const parent = group?.parent;
    if (!group || !parent) return;

    elapsedRef.current += delta;
    const t = THREE.MathUtils.clamp(elapsedRef.current / TAKE_DURATION_S, 0, 1);
    const ease = t * t * (3 - 2 * t);
    // A quadratic arc through the point over the tray place.
    const u = 1 - ease;
    const worldPos = flightWorldPosRef.current
      .copy(startPosRef.current)
      .multiplyScalar(u * u)
      .addScaledVector(arcRef.current, 2 * u * ease)
      .addScaledVector(endPosRef.current, ease * ease);
    const worldQuat = flightWorldQuatRef.current.copy(startQuatRef.current).slerp(endQuatRef.current, ease);
    group.position.copy(parent.worldToLocal(worldPos.clone()));
    const parentWorldQuat = parent.getWorldQuaternion(flightParentQuatRef.current);
    group.quaternion.copy(parentWorldQuat.clone().invert().multiply(worldQuat));
    group.scale.setScalar(THREE.MathUtils.lerp(flightStartScaleRef.current, flightEndScaleRef.current, ease));

    if (t >= 1) {
      if (phase === "flight") {
        onArrived();
      } else {
        group.position.copy(homePosition);
        group.quaternion.copy(homeQuaternion);
        group.scale.setScalar(1);
      }
      phaseRef.current = "atRest";
    }
  });

  return { groupRef, beginTake, isMoving: () => phaseRef.current !== "atRest" };
}
