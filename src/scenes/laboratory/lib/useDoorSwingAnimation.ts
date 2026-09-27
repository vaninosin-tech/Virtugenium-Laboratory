import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** One door/panel node to swing open around its own local Y axis (its origin is assumed to already sit on the real hinge line, same convention `useCabinetDoorAnimation` verified for the reagent cabinets). */
export interface DoorSwingSpec {
  readonly nodeName: string;
  /** Signed target rotation (degrees) at fully open — sign controls swing direction, e.g. a left/right door pair uses opposite signs so they swing apart. */
  readonly openAngleDeg: number;
}

const DEFAULT_DURATION_MS = 900;

function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - (-2 * t + 2) ** 5 / 2;
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

interface DoorRigEntry {
  readonly node: THREE.Object3D;
  readonly openAngleRad: number;
}

/**
 * Minimal door/sash-free counterpart to `useCabinetDoorAnimation` — just
 * eases one or more named nodes' Y rotation between 0 (closed) and their own
 * signed open angle, with no shutter/control-panel-screen machinery (`FumeHood`
 * and `PPECabinet` have neither). Used by both, each with its own door list.
 */
export function useDoorSwingAnimation(
  instance: THREE.Object3D,
  isOpen: boolean,
  doors: readonly DoorSwingSpec[],
  durationMs: number = DEFAULT_DURATION_MS,
): void {
  const rig = useRef<readonly DoorRigEntry[]>([]);
  const progress = useRef(0);

  useEffect(() => {
    rig.current = doors
      .map((door) => {
        const node = findByName(instance, door.nodeName);
        return node ? { node, openAngleRad: THREE.MathUtils.degToRad(door.openAngleDeg) } : null;
      })
      .filter((entry): entry is DoorRigEntry => entry !== null);
    progress.current = 0;
    // `doors` is a module-level constant array passed by each caller (not
    // recreated per render), so only `instance` needs to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  useFrame((_, delta) => {
    if (rig.current.length === 0) return;
    const rate = 1000 / durationMs;
    const direction = isOpen ? 1 : -1;
    progress.current = THREE.MathUtils.clamp(progress.current + direction * rate * delta, 0, 1);
    const eased = easeInOutQuint(progress.current);
    for (const { node, openAngleRad } of rig.current) {
      node.rotation.set(0, eased * openAngleRad, 0);
    }
  });
}
