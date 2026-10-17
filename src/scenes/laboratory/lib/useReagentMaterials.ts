import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Quaternion, Vector3, type Object3D } from "three";
import { useReagentShaderTuningStore } from "./useReagentShaderTuningStore";
import type { ReagentMaterialBinding } from "./reagentMaterials";
import { QUALITY_LEVELS, useRuntimeQualityStore } from "./useRuntimeQualityStore";
import { cancelDeferredDispose, deferDispose } from "./deferredDispose";
import { CLAMP_TUBE_MOUTH, POUR_MS, simNowMs, useStandMotionStore } from "./useStandMotionStore";

/** Subscribe outside the frame loop; sliders do not rebuild bottles or shaders. */
export function useReagentMaterials(instance: Object3D) {
  const binding = instance.userData.reagentMaterials as ReagentMaterialBinding;
  const pourFill = useRef({ at: -1, base: binding.getFillLevel() });
  const position = useRef(new Vector3());
  const up = useRef(new Vector3());
  const orientation = useRef(new Quaternion());
  useFrame(({ clock }) => {
    if (binding.liquid) {
      binding.updateSurface();
      binding.liquid.uniforms.uTime.value = clock.elapsedTime;
      binding.liquid.uniforms.uQualityNoise.value = QUALITY_LEVELS[useRuntimeQualityStore.getState().quality].noise;
      const pour = useStandMotionStore.getState().pour;
      if (pour && CLAMP_TUBE_MOUTH.valid &&
          (pour.instanceId === binding.reagentId || pour.instanceId.endsWith(`-${binding.reagentId}`))) {
        instance.getWorldPosition(position.current);
        instance.getWorldQuaternion(orientation.current);
        up.current.set(0, 1, 0).applyQuaternion(orientation.current);
        // Only the bottle actually tipped at the clamp loses liquid. Shelf
        // copies of the same reagent keep their own independent fill.
        if (position.current.distanceTo(CLAMP_TUBE_MOUTH.point) < 0.32 &&
            Math.abs(up.current.y) < 0.94) {
          if (pourFill.current.at !== pour.at) {
            pourFill.current.at = pour.at;
            pourFill.current.base = binding.getFillLevel();
          }
          const phase = Math.max(0, Math.min(1, ((simNowMs() - pour.at) / POUR_MS - 0.35) / 0.39));
          binding.setFillLevel(Math.max(0.04, pourFill.current.base * (1 - 0.22 * phase)));
        }
      }
    }
  });
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Restore the exact pre-preview state, including future reaction values.
    let restore: (() => void) | undefined;
    const apply = () => {
      const { enabled, values: v } = useReagentShaderTuningStore.getState();
      if (!enabled) { restore?.(); restore = undefined; return; }
      if (!restore) {
        const glass = binding.glass.map((m) => ({ m, roughness: m.roughness,
          transparency: m.uniforms.uTransparency.value, strength: m.uniforms.uFresnelStrength.value,
          power: m.uniforms.uFresnelPower.value, absorption: m.uniforms.uAbsorption.value }));
        const u = binding.liquid?.uniforms;
        const liquid = u && { opacity: u.uOpacity.value, turbulence: u.uTurbulence.value,
          cloud: u.uCloudiness.value, progress: u.uReactionProgress.value, depth: u.uDepthStrength.value,
          fresnel: u.uFresnelStrength.value, distortion: u.uDistortionStrength.value, color: u.uReactionColor.value.clone() };
        restore = () => {
          glass.forEach(({ m, roughness, transparency, strength, power, absorption }) => {
            m.roughness = roughness;
            m.uniforms.uTransparency.value = transparency;
            m.uniforms.uFresnelStrength.value = strength;
            m.uniforms.uFresnelPower.value = power;
            m.uniforms.uAbsorption.value = absorption;
          });
          if (u && liquid) {
            u.uOpacity.value = liquid.opacity; u.uTurbulence.value = liquid.turbulence;
            u.uCloudiness.value = liquid.cloud; u.uReactionProgress.value = liquid.progress;
            u.uDepthStrength.value = liquid.depth; u.uFresnelStrength.value = liquid.fresnel; u.uDistortionStrength.value = liquid.distortion;
            u.uReactionColor.value.copy(liquid.color);
          }
        };
      }
      binding.glass.forEach((m) => {
        m.roughness = v.roughness;
        m.uniforms.uTransparency.value = v.transparency;
        m.uniforms.uFresnelStrength.value = v.fresnelStrength;
        m.uniforms.uFresnelPower.value = v.fresnelPower;
        if (m.variant === "amber") m.uniforms.uAbsorption.value = v.amberAbsorption;
      });
      const u = binding.liquid?.uniforms;
      if (u) {
        u.uOpacity.value = v.opacity; u.uTurbulence.value = v.turbulenceStrength;
        u.uCloudiness.value = v.cloudiness; u.uReactionProgress.value = v.reactionMix;
        u.uDepthStrength.value = v.depthStrength; u.uFresnelStrength.value = v.fresnelLiquid; u.uDistortionStrength.value = v.distortionStrength;
        u.uReactionColor.value.set(v.reactionColor);
      }
    };
    apply();
    const unsubscribe = useReagentShaderTuningStore.subscribe(apply);
    return () => { unsubscribe(); restore?.(); };
  }, [binding]);
  useEffect(() => {
    cancelDeferredDispose(binding);
    return () => deferDispose(binding, () => binding.dispose());
  }, [binding]);
}
