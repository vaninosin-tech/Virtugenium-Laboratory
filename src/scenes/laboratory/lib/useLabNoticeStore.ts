import { create } from "zustand";

export type LabNoticeTone = "info" | "refusal" | "error";

export interface LabNotice {
  readonly id: number;
  readonly text: string;
  readonly tone: LabNoticeTone;
  readonly shownAt: number;
}

/** How long a notice stays on screen. */
export const NOTICE_SECONDS = 3.2;

interface LabNoticeState {
  readonly notice: LabNotice | null;
  /**
   * Shows `text` at the top of the screen. Repeating the text that is
   * already up only keeps it alive — the workbench fills tubes by proximity
   * every frame, so a refused pour there asks for the same notice sixty
   * times a second.
   */
  show: (text: string, tone: LabNoticeTone) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useLabNoticeStore = create<LabNoticeState>((set, get) => ({
  notice: null,

  show: (text, tone) => {
    const current = get().notice;
    const now = Date.now();
    if (current && current.text === text) {
      set({ notice: { ...current, shownAt: now } });
      return;
    }
    set({ notice: { id: nextId++, text, tone, shownAt: now } });
  },

  dismiss: (id) => {
    if (get().notice?.id === id) set({ notice: null });
  },
}));
