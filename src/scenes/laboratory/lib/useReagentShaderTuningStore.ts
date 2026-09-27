import { create } from "zustand";
import { GLASS_DEFAULTS } from "./reagentMaterials";

export const SHADER_TUNING_DEFAULTS = {
  ...GLASS_DEFAULTS, opacity: 0.35, depthStrength: 0.45, fresnelLiquid: 0.28,
  distortionStrength: 0.012, turbulenceStrength: 0.015,
  cloudiness: 0, reactionMix: 0, reactionColor: "#2696ae",
};
export type ShaderTuning = typeof SHADER_TUNING_DEFAULTS;
const KEY = "virtugenium.reagent-shaders.v1";
function read(): ShaderTuning {
  const values = { ...SHADER_TUNING_DEFAULTS };
  if (import.meta.env.DEV) {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      for (const key of Object.keys(values) as (keyof ShaderTuning)[]) {
        const value = stored[key];
        if (typeof values[key] === "number" && typeof value === "number" && Number.isFinite(value)) {
          Object.assign(values, { [key]: Math.max(0, Math.min(key === "fresnelPower" ? 8 : 1, value)) });
        } else if (typeof values[key] === "string" && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
          Object.assign(values, { [key]: value });
        }
      }
    } catch { /* Storage may be disabled in a WebView. */ }
  }
  return values;
}
export const useReagentShaderTuningStore = create<{
  enabled: boolean;
  values: ShaderTuning;
  setEnabled: (enabled: boolean) => void;
  setValue: <K extends keyof ShaderTuning>(key: K, value: ShaderTuning[K]) => void;
  reset: () => void;
}>((set) => ({
  enabled: false,
  values: read(),
  setEnabled: (enabled) => set({ enabled }),
  setValue: (key, value) => set((state) => {
    const values = { ...state.values, [key]: value };
    if (import.meta.env.DEV) {
      try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* optional */ }
    }
    return { values };
  }),
  reset: () => {
    try { if (import.meta.env.DEV) localStorage.removeItem(KEY); } catch { /* optional */ }
    set({ enabled: false, values: { ...SHADER_TUNING_DEFAULTS } });
  },
}));
