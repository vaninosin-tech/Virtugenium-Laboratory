import { RoundedBox } from "@react-three/drei";
import { forwardRef } from "react";
import type * as THREE from "three";

import type { Position3 } from "../lib/layout";

/**
 * Simple rectangular cork/stopper holder — a runtime primitive prop (no
 * Blender asset), per the task's own explicit fallback: a clean rounded
 * block, no modeled stopper-slot detail. Neutral lab-gray material matches
 * the project's furniture-body palette. Two scene instances share this
 * component (workbench + tray) with independent transforms; neither owns
 * geometry the other could mutate, since each render call creates its own
 * mesh. Forwards its root group ref so callers can register it as a dev-menu
 * click-to-select target (see `useReagentPickablesStore`).
 */
export const LabStopperHolder = forwardRef<THREE.Group, {
  readonly position?: Position3;
  readonly rotation?: readonly [number, number, number];
  readonly scale?: number;
}>(function LabStopperHolder({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }, ref) {
  return (
    <group ref={ref} position={position} rotation={rotation} scale={scale}>
      <RoundedBox args={[0.14, 0.035, 0.12]} radius={0.006} smoothness={2} castShadow receiveShadow>
        <meshStandardMaterial color="#d0d4d2" roughness={0.55} metalness={0.05} />
      </RoundedBox>
    </group>
  );
});
