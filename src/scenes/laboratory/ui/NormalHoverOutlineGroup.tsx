import { useState, type ReactNode } from "react";
import type * as THREE from "three";

import { useNormalHoverOutline } from "./NormalHoverOutline";

/**
 * For an object with no model root of its own at hand (a tube drawn by
 * `LabTestTubeInstance` inside a list): outlines what it wraps. An
 * untransformed group — it moves nothing.
 */
export function NormalHoverOutline({
  active,
  parts,
  children,
}: {
  readonly active: boolean;
  readonly parts?: RegExp;
  readonly children: ReactNode;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  useNormalHoverOutline({ root: group, active, parts });
  return <group ref={setGroup}>{children}</group>;
}
