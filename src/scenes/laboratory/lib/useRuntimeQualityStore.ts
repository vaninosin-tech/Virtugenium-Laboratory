import { create } from "zustand";

export type RuntimeQuality = "LOW" | "MEDIUM" | "HIGH" | "ULTRA";
export type QualityMode = RuntimeQuality | "AUTO";
const KEY = "virtugenium.runtime-quality.v1";
const order: RuntimeQuality[] = ["LOW", "MEDIUM", "HIGH", "ULTRA"];
function read(): QualityMode {
  if (!import.meta.env.DEV) return "AUTO";
  try { const value = localStorage.getItem(KEY); return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "ULTRA" || value === "AUTO" ? value : "AUTO"; } catch { return "AUTO"; }
}
export const useRuntimeQualityStore = create<{
  mode: QualityMode;
  quality: RuntimeQuality;
  setMode: (mode: QualityMode) => void;
  downgrade: () => void;
}>((set) => ({
  mode: read(), quality: "HIGH",
  setMode: (mode) => { try { localStorage.setItem(KEY, mode); } catch { /* optional */ } set({ mode, quality: mode === "AUTO" ? "HIGH" : mode }); },
  downgrade: () => set((state) => {
    if (state.mode !== "AUTO") return state;
    const i = order.indexOf(state.quality);
    return { quality: order[Math.max(0, i - 1)] };
  }),
}));

/**
 * `multisampling` used to be 0 on LOW/MEDIUM — cheap on the GPU, but
 * `EffectComposer` renders into its own offscreen target, which bypasses the
 * canvas's own `gl={{ antialias: true }}` entirely (that flag only affects
 * rendering straight to the screen). With 0 multisampling there, every edge
 * in the scene came out visibly jagged/aliased at those tiers — reads as
 * "pixelated", not just "slightly less pretty". MSAA is comparatively cheap
 * next to AO/bloom, so LOW and MEDIUM now keep a small amount (2x) instead of
 * none, while still skipping the actually expensive effects (AO, the higher
 * noise/distortion terms) that `RuntimeQuality`'s auto-downgrade exists for.
 */
export const QUALITY_LEVELS: Record<RuntimeQuality, { noise: number; distortion: number; composer: boolean; multisampling: number }> = {
  LOW: { noise: 0, distortion: 0, composer: false, multisampling: 2 },
  MEDIUM: { noise: 0.55, distortion: 0.35, composer: true, multisampling: 2 },
  HIGH: { noise: 1, distortion: 0.7, composer: true, multisampling: 2 },
  ULTRA: { noise: 1.2, distortion: 1, composer: true, multisampling: 4 },
};
