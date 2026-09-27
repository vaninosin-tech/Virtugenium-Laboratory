import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DepthOfFieldEffect, MaskFunction } from "postprocessing";
import { Vector3 } from "three";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { TUBE_FOCUS, useTubeCloseUpStore } from "../lib/useTubeCloseUpStore";
import { useRuntimeQualityStore } from "../lib/useRuntimeQualityStore";

class InspectionBlurEffect extends DepthOfFieldEffect {
  active = false;
  private warmed = false;

  override update(...args: Parameters<DepthOfFieldEffect["update"]>) {
    // Compile/upload once during scene startup. Outside inspection the
    // blend opacity is zero and none of the internal blur passes run.
    if (!this.active && this.warmed) return;
    super.update(...args);
    this.warmed = true;
  }
}

/** Keep the composer and its shader programs stable across open/close. */
export function InspectionDepthOfField() {
  const camera = useThree(state => state.camera);
  const effect = useMemo(() => {
    const blur = new InspectionBlurEffect(camera, { focusRange: 0.7, bokehScale: 3 });
    blur.target = new Vector3();
    blur.maskFunction = MaskFunction.MULTIPLY_RGB_SET_ALPHA;
    blur.blendMode.opacity.value = 0;
    return blur;
  }, [camera]);

  useFrame(() => {
    const inspection = useReagentInspectionStore.getState();
    // A "holder" (the workbench test tube rack) is much wider than a round
    // bottle and, since the click-to-inspect fix, sits at a fixed tilt — a
    // single focus point + `focusRange: 0.7` (tuned for a small bottle that
    // sits basically AT that point) left the spread-out, angled tube grid
    // partly outside the sharp band, reading as "the tubes are blurry" even
    // though nothing else moved. The whole point of picking it up is to
    // read the tube grid clearly, so it skips the cinematic DoF entirely
    // instead of chasing a focus distance that would only work for one
    // specific tilt/scale.
    const inspectingJar = inspection.inspectedId !== null && inspection.kind !== "holder";
    // The tube close-up (looking at it, or heating it) gets the same
    // treatment: the bottles right in front of the camera and the hood's
    // walls go soft, the reaction stays sharp.
    const tubeCloseUp =
      TUBE_FOCUS.valid && (useTubeCloseUpStore.getState().viewing || useHeatingStore.getState().active);
    effect.active = (inspectingJar || tubeCloseUp) && useRuntimeQualityStore.getState().quality !== "LOW";
    effect.blendMode.opacity.value = effect.active ? 1 : 0;
    if (effect.active) {
      if (inspectingJar) effect.target!.fromArray(inspection.stagePosition);
      else effect.target!.copy(TUBE_FOCUS.point);
    }
  });
  useEffect(() => {
    cancelDeferredDispose(effect);
    return () => deferDispose(effect, () => effect.dispose());
  }, [effect]);

  return <primitive object={effect} />;
}
