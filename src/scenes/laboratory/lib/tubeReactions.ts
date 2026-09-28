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
  /** Seconds to run to completion at full rate. */
  readonly seconds: number;
  /**
   * Fraction of the full rate at room temperature. Only copper depends on
   * temperature. Cold dilute nitric acid does dissolve copper — on video the
   * solution visibly turns blue-green within about a minute, unheated — so
   * cold is slow, not stopped; heating makes it go several times faster.
   */
  readonly coldRate: number;
}

const REACTIONS: readonly ReactionDef[] = [
  // dp/dt ∝ √(1 − p) (see `advanceChemistry`) finishes in 2·seconds/drive:
  // about half a minute on a hot tube, about two minutes cold.
  { kind: "copper-nitric", reagents: ["cu", "hno3"], trigger: "heat", seconds: 15, coldRate: 0.25 },
  // Precipitation is instant; what takes time is the settling, which the
  // visuals map onto the later part of the progress.
  { kind: "silver-chloride", reagents: ["agno3", "nacl"], trigger: "mix", seconds: 12, coldRate: 1 },
  // Fine crystals settle slower than AgCl's loose curds.
  { kind: "barium-sulfate", reagents: ["bacl2", "k2so4"], trigger: "mix", seconds: 16, coldRate: 1 },
  // Fast in acid, but not instant — the violet has to be seen to fade.
  { kind: "permanganate-redox", reagents: ["kmno4", "h2so4", "na2so3"], trigger: "mix", seconds: 7, coldRate: 1 },
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

/** Everything the tube's visuals need to know about what is happening inside it. */
export interface TubeChemistry {
  /** 0..1, how much of the reaction has happened — drives colour and precipitate. */
  readonly progress: number;
  /** 0..1, how vigorously it is happening right now — drives bubbles and gas. */
  readonly rate: number;
  /** 0..1, contents temperature: 0 room, 1 near boiling. */
  readonly temperature: number;
}

export const ROOM_TEMPERATURE_CHEMISTRY: TubeChemistry = { progress: 0, rate: 0, temperature: 0 };

/**
 * Seconds of holding the tube in the flame to bring cold contents near
 * boiling. Slow enough that the preheat passes — which only brush the flame
 * — warm the glass and barely the contents, so the copper takes off after
 * the preheat, in front of the player, not during it.
 */
export const TEMPERATURE_RISE_SECONDS = 12;
/** Seconds for hot contents to cool back to room temperature once out of the flame. */
export const TEMPERATURE_COOL_SECONDS = 40;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * One step of a tube's chemistry. `inFlame` is whether the flame is heating
 * the contents right now. Temperature is tracked for every tube, reacting or
 * not, so contents heated first and mixed after still react hot.
 *
 * The rate falls as the reagents run out (√(1 − p) for copper, which reads
 * as a reaction dying down rather than stopping dead), and copper keeps
 * reacting while the tube cools after heating — slower and slower, not cut
 * off the moment the tube leaves the flame.
 */
export const advanceChemistry = (
  contents: readonly string[],
  state: TubeChemistry,
  deltaSeconds: number,
  inFlame: boolean,
): TubeChemistry => {
  const temperature = clamp01(
    state.temperature +
      (inFlame ? deltaSeconds / TEMPERATURE_RISE_SECONDS : -deltaSeconds / TEMPERATURE_COOL_SECONDS),
  );
  const reaction = findReaction(contents);
  if (!reaction) return { progress: 0, rate: 0, temperature };

  const drive = reaction.coldRate + (1 - reaction.coldRate) * temperature;
  const remaining = 1 - state.progress;
  const rate = reaction.trigger === "heat" ? drive * Math.sqrt(remaining) : remaining > 0 ? drive : 0;
  const progress = clamp01(state.progress + (rate * deltaSeconds) / reaction.seconds);
  return { progress, rate: progress >= 1 ? 0 : rate, temperature };
};

interface TubeReactionState {
  /** Per tube `instanceId`. Absent means a tube at room temperature with nothing reacting. */
  readonly chemistryById: Readonly<Record<string, TubeChemistry>>;
  setChemistry: (instanceId: string, chemistry: TubeChemistry) => void;
  clear: (instanceId: string) => void;
  reset: () => void;
}

/**
 * What is happening inside each tube — the numbers the tube's visuals read
 * (`LabTestTubeInstance`). Kept per tube and out of `useTestTubeStorageStore`,
 * which only records what is IN a tube.
 */
export const useTubeReactionStore = create<TubeReactionState>((set) => ({
  chemistryById: {},
  setChemistry: (instanceId, chemistry) =>
    set((state) => ({ chemistryById: { ...state.chemistryById, [instanceId]: chemistry } })),
  clear: (instanceId) =>
    set((state) => {
      if (!(instanceId in state.chemistryById)) return state;
      const { [instanceId]: _removed, ...rest } = state.chemistryById;
      return { chemistryById: rest };
    }),
  reset: () => set({ chemistryById: {} }),
}));
