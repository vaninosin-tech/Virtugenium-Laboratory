import { create } from "zustand";

import type { HintSubject } from "./hoverInfo";
import type { StandTarget } from "./standTableActions";

/**
 * The table object under the cursor whose click is a stand action — see
 * `standTableActions`. Holds the TARGET, not a caption: the caption is
 * recomputed from the live scene by `StandActionHint` every frame, so it is
 * right the moment a click changes what the next click would do (clamp a
 * tube and the same tube's caption flips to «вернуть»).
 */
interface StandHintState {
  readonly target: StandTarget | null;
  /** Identity of whoever set `target`, so a late `pointerout` from one object can't clear another's hint. */
  readonly owner: string | null;
  /**
   * A plain caption instead of a stand action — e.g. «Поставить на стол» over
   * something on the tray. Empty: the object is only named (its place and
   * state), no click does anything.
   */
  readonly label: string | null;
  /** What the cursor is over, named in the caption's first lines; for a stand target it follows from the target. */
  readonly subject: HintSubject | null;
  show: (owner: string, target: StandTarget) => void;
  showLabel: (owner: string, label: string, subject?: HintSubject) => void;
  hide: (owner: string) => void;
}

export const useStandHintStore = create<StandHintState>((set) => ({
  target: null,
  owner: null,
  label: null,
  subject: null,
  show: (owner, target) => set({ owner, target, label: null, subject: null }),
  showLabel: (owner, label, subject) => set({ owner, label, target: null, subject: subject ?? null }),
  hide: (owner) =>
    set((state) => (state.owner === owner ? { owner: null, target: null, label: null, subject: null } : state)),
}));
