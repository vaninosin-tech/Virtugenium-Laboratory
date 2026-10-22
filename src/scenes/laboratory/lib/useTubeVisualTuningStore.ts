import { create } from "zustand";

// Preview state is deliberately transient and never writes reaction progress.
export const useTubeVisualTuningStore = create<{
  enabled: boolean;
  progress: number;
  rate: number;
  temperature: number;
  /** Independent of chemistry override; null follows the real clamp. Degrees. */
  tiltDegrees: number | null;
  setEnabled: (enabled: boolean) => void;
  setProgress: (progress: number) => void;
}>((set) => ({
  enabled: false,
  progress: 0,
  rate: 0.5,
  temperature: 0.5,
  tiltDegrees: null,
  setEnabled: (enabled) => set({ enabled }),
  setProgress: (progress) => set({ progress: Math.max(0, Math.min(1, progress)) }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __tubeVisualTuningStore?: unknown }).__tubeVisualTuningStore = useTubeVisualTuningStore;
}
