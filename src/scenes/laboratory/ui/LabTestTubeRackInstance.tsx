import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { forwardRef, useEffect, useId, useMemo, type ReactNode } from "react";
import * as THREE from "three";

import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import type { Position3 } from "../lib/layout";
import { createHoverHitboxGeometry, disableRaycast } from "./ReagentContainerInstance";
import { useNormalHoverOutline } from "./NormalHoverOutline";
import { useBoxObstacle } from "../lib/worktopBounds";

const MODEL_PATH = "/assets/models/LabTestTubeRack.glb";
const RACK_FOOTPRINT = { minX: -0.185, maxX: 0.185, minZ: -0.0935, maxZ: 0.0935 } as const;

/**
 * Modeled 16-tube rack (2 rows of 8) — feet, bottom rail, top rail, two side
 * supports, and 16 blue-silicone tube-insert collars — replacing the earlier
 * flat `LabStopperHolder` box that stood in for it. Same forwardRef
 * position/rotation/scale prop shape as `LabStopperHolder`, so it's a
 * drop-in replacement at both scene instances (workbench + tray) and keeps
 * reading the same `useStopperHolderStore` placement config — see
 * `useTestTubeStorageStore.ts`'s `computeTubeSlotPosition` for the matching
 * hole-grid math (X/Z offsets and base Y were taken directly from this
 * model's own exported node positions, not eyeballed).
 *
 * Optional `onClick`/`onPointerOver`/`onPointerOut`/`onPointerDown` +
 * `hoverActive` turn the rack into a clickable object using the exact same
 * single-hitbox hover/click technique `ReagentContainerInstance` uses for
 * reagent jars (`createHoverHitboxGeometry`/`disableRaycast`/`ReagentHoverRim`,
 * reused directly from there rather than duplicated). Omitted by the
 * cabinet-shelf placement (`ReagentCabinetInstance`), which still renders a
 * purely decorative, non-interactive copy.
 */
export const LabTestTubeRackInstance = forwardRef<THREE.Group, {
  readonly position?: Position3;
  readonly rotation?: readonly [number, number, number];
  readonly scale?: number;
  readonly onClick?: (event: ThreeEvent<MouseEvent>) => void;
  readonly onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  readonly onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
  readonly onPointerOut?: (event: ThreeEvent<PointerEvent>) => void;
  readonly hoverActive?: boolean;
  /** Rendered inside the SAME animated group as the rack model — e.g. `WorkbenchTestTubeRackInstance`'s `InspectableTestTubeSlot`s, so the tubes standing in the rack travel with it (pick-up/inspect/return) instead of being separately-positioned siblings. */
  readonly children?: ReactNode;
}>(function LabTestTubeRackInstance(
  { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, onClick, onPointerDown, onPointerOver, onPointerOut, hoverActive = false, children },
  ref,
) {
  const { scene } = useGLTF(MODEL_PATH);
  const interactive = Boolean(onClick || onPointerDown || onPointerOver || onPointerOut);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  useEffect(() => {
    if (interactive) disableRaycast(instance);
  }, [instance, interactive]);

  // In the way of whatever is carried over the worktop (VL-018) — the rack's
  // 37 × 18.7 cm footprint (`LabTestTubeRack.glb`).
  const obstacleId = useId();
  const instanceRef = useMemo(() => ({ current: instance }), [instance]);
  useBoxObstacle(`rack${obstacleId}`, instanceRef, RACK_FOOTPRINT, "rack");

  // Hover: the silhouette outline (`NormalHoverOutline`).
  useNormalHoverOutline({ root: instance, active: interactive && hoverActive });

  const hoverHitboxGeometry = useMemo(
    () => (interactive ? createHoverHitboxGeometry(instance) : null),
    [instance, interactive],
  );

  useEffect(() => {
    cancelDeferredDispose(instance);
    return () => deferDispose(instance, () => {});
  }, [instance]);

  useEffect(() => {
    if (!hoverHitboxGeometry) return;
    cancelDeferredDispose(hoverHitboxGeometry);
    return () => deferDispose(hoverHitboxGeometry, () => hoverHitboxGeometry.dispose());
  }, [hoverHitboxGeometry]);

  return (
    <group
      ref={ref}
      position={position}
      rotation={rotation}
      scale={scale}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <primitive object={instance} />
      {interactive && hoverHitboxGeometry && (
        <>
          {/* The ONLY raycast target while interactive (see `createHoverHitboxGeometry`'s
              doc) — `instance`'s own meshes had raycasting disabled above. */}
          <mesh geometry={hoverHitboxGeometry}>
            <meshBasicMaterial visible={false} />
          </mesh>
        </>
      )}
      {children}
    </group>
  );
});

useGLTF.preload(MODEL_PATH);
