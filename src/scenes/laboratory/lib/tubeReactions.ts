import { create } from "zustand";

export type ReactionKind = "copper-nitric" | "silver-chloride" | "barium-sulfate" | "permanganate-redox";

interface ReactionDef {
  readonly kind: ReactionKind;
  readonly reagents: readonly string[];
  /**
   * What drives the reaction forward. Copper and dilute nitric acid barely
   * react cold, which is the whole reason experiment 1 has a heating step;
   * the other three are ionic reactions that run the moment the solutions
   * meet.
   */
  readonly trigger: "heat" | "mix";
}

const REACTIONS: readonly ReactionDef[] = [
  { kind: "copper-nitric", reagents: ["cu", "hno3"], trigger: "heat" },
  { kind: "silver-chloride", reagents: ["agno3", "nacl"], trigger: "mix" },
  { kind: "barium-sulfate", reagents: ["bacl2", "k2so4"], trigger: "mix" },
  { kind: "permanganate-redox", reagents: ["kmno4", "h2so4", "na2so3"], trigger: "mix" },
];

const findReaction = (contents: readonly string[]) =>
  REACTIONS.find((reaction) => reaction.reagents.every((id) => contents.includes(id)));

/**
 * Which reaction a tube's contents make, regardless of the order they went
 * in — the order is judged by `mixingRules`, not by chemistry here. Extra
 * reagents don't cancel a reaction: a tube that holds all its reagents shows
 * it, whatever else was tipped in.
 */
export const reactionKindFor = (contents: readonly string[]): ReactionKind | null =>
  findReaction(contents)?.kind ?? null;

export const reactionTriggerFor = (contents: readonly string[]): "heat" | "mix" | null =>
  findReaction(contents)?.trigger ?? null;

/** Seconds for a mix-triggered reaction to run from the moment its last reagent goes in. */
export const MIX_REACTION_SECONDS = 4;

interface TubeReactionState {
  /** 0..1 per tube `instanceId`. Absent means not reacting. */
  readonly progressById: Readonly<Record<string, number>>;
  setProgress: (instanceId: string, progress: number) => void;
  clear: (instanceId: string) => void;
  reset: () => void;
}

/**
 * How far each tube's reaction has gone — the number the tube's visuals
 * read (`LabTestTubeInstance`'s `reactionProgress`). Kept per tube and out
 * of `useTestTubeStorageStore`, which only records what is IN a tube.
 */
export const useTubeReactionStore = create<TubeReactionState>((set) => ({
  progressById: {},
  setProgress: (instanceId, progress) =>
    set((state) => ({
      progressById: { ...state.progressById, [instanceId]: Math.max(0, Math.min(1, progress)) },
    })),
  clear: (instanceId) =>
    set((state) => {
      if (!(instanceId in state.progressById)) return state;
      const { [instanceId]: _removed, ...rest } = state.progressById;
      return { progressById: rest };
    }),
  reset: () => set({ progressById: {} }),
}));
