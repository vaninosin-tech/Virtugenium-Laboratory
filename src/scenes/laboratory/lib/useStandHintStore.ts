import { create } from "zustand";

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
  show: (owner: string, target: StandTarget) => void;
  hide: (owner: string) => void;
}

export const useStandHintStore = create<StandHintState>((set) => ({
  target: null,
  owner: null,
  show: (owner, target) => set({ owner, target }),
  hide: (owner) => set((state) => (state.owner === owner ? { owner: null, target: null } : state)),
}));
