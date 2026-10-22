import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const DEFAULT_DURATION_MS = 700;

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

/**
 * Eases one named node's local Y position between its own authored
 * (closed) value and that value plus `openOffsetY` — pure vertical
 * translation, no rotation/scale, same progress/easing shape as
 * `useDoorSwingAnimation` but for a sliding sash rather than a hinged door.
 * The node's own children (glass/frame/handle, all parented under it in
 * the source blend) move with it as one rigid group for free.
 */
export function useSashSlideAnimation(
  instance: THREE.Object3D,
  nodeName: string,
  isOpen: boolean,
  openOffsetY: number,
  durationMs: number = DEFAULT_DURATION_MS,
): void {
  const node = useRef<THREE.Object3D | null>(null);
  const closedY = useRef(0);
  const progress = useRef(0);

  useEffect(() => {
    const found = findByName(instance, nodeName);
    node.current = found;
    closedY.current = found ? found.position.y : 0;
    progress.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  useFrame((_, delta) => {
    if (!node.current) return;
    const rate = 1000 / durationMs;
    const direction = isOpen ? 1 : -1;
    progress.current = THREE.MathUtils.clamp(progress.current + direction * rate * delta, 0, 1);
    const eased = easeInOutQuint(progress.current);
    node.current.position.y = closedY.current + eased * openOffsetY;
  });
}
