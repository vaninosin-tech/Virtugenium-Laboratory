import { create } from "zustand";

// Preview state is deliberately transient and never writes reaction progress.
export const useTubeVisualTuningStore = create<{
  enabled: boolean;
  progress: number;
  setEnabled: (enabled: boolean) => void;
  setProgress: (progress: number) => void;
}>((set) => ({
  enabled: false,
  progress: 0,
  setEnabled: (enabled) => set({ enabled }),
  setProgress: (progress) => set({ progress: Math.max(0, Math.min(1, progress)) }),
}));
