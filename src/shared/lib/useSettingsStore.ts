import { create } from "zustand";

interface SettingsState {
  readonly volume: number;
  readonly muted: boolean;
  setVolume: (volume: number) => void;
  toggleMuted: () => void;
}

/**
 * App-wide audio preferences. Deliberately outside `useLaboratoryStore` —
 * volume/mute aren't part of the lab session domain, and this state should
 * survive `resetAttempt`/`resetLaboratory` calls rather than being wiped by
 * them.
 *
 * Read by the procedural lab sound (`scenes/laboratory/lib/labAudio.ts`),
 * which scales its master gain by `volume` and silences on `muted`.
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  volume: 70,
  muted: false,

  setVolume: (volume) => set({ volume: Math.min(100, Math.max(0, volume)) }),

  toggleMuted: () => set((state) => ({ muted: !state.muted })),
}));
