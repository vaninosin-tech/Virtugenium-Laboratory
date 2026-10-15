import { useThree } from "@react-three/fiber";
import { Outline } from "@react-three/postprocessing";
import { KernelSize, type OutlineEffect } from "postprocessing";
import { useEffect, useState } from "react";

import { letOutlineSeeThrough } from "./outlineSeeThrough";

/**
 * The scene's one hover outline pass — the furniture (`<Select>`) and every
 * other object (`NormalHoverOutline`). Mounted inside `<EffectComposer>`.
 *
 * Visible parts only (`xRay={false}`), but seen through glass
 * (`letOutlineSeeThrough`). A full-resolution mask; the smallest blur only
 * thickens the line to a couple of pixels and a high strength keeps it
 * solid — a crisp blue frame, not a glow.
 */
export function HoverOutline() {
  const scene = useThree((state) => state.scene);
  const [effect, setEffect] = useState<OutlineEffect | null>(null);
  useEffect(() => (effect ? letOutlineSeeThrough(effect, scene) : undefined), [effect, scene]);
  return (
    <Outline
      ref={setEffect}
      visibleEdgeColor={0x1d4ed8}
      hiddenEdgeColor={0x1d4ed8}
      edgeStrength={10}
      pulseSpeed={0}
      resolutionScale={1}
      blur
      kernelSize={KernelSize.VERY_SMALL}
      xRay={false}
    />
  );
}
