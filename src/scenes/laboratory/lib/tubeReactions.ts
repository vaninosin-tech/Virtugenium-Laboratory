import { create } from "zustand";
import { TemperatureField } from "./tubeTemperatureField";
import { useHeatingStore } from "./useHeatingStore";

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
  /**
   * Seconds the freshly mixed tube shows its starting state before the
   * reaction visibly moves. Only for the permanganate: the real thing fades
   * so fast that the raspberry — the very sign the tablet asks about — was
   * gone before the player registered it.
   */
  readonly holdSeconds?: number;
}

const REACTIONS: readonly ReactionDef[] = [
  // dp/dt ∝ √(1 − p) (see `advanceChemistry`) finishes in 2·seconds/drive:
  // about half a minute on a hot tube, about two minutes cold.
  { kind: "copper-nitric", reagents: ["cu", "hno3"], trigger: "heat", seconds: 15, coldRate: 0.25 },
  // Precipitation is instant; what takes time is the settling, which the
  // visuals map onto the later part of the progress. AgCl's loose curds
  // coagulate and drop within seconds.
  { kind: "silver-chloride", reagents: ["agno3", "nacl"], trigger: "mix", seconds: 12, coldRate: 1 },
  // BaSO₄'s fine crystals stay a milky suspension far longer — on video
  // hardly settling at all in the ten seconds after mixing.
  { kind: "barium-sulfate", reagents: ["bacl2", "k2so4"], trigger: "mix", seconds: 45, coldRate: 1 },
  // In acid the colour goes almost at once (1–2 s on video); here the
  // raspberry holds for a moment and then fades over ~3 s, so it is seen.
  {
    kind: "permanganate-redox",
    reagents: ["kmno4", "h2so4", "na2so3"],
    trigger: "mix",
    seconds: 3,
    coldRate: 1,
    holdSeconds: 1.5,
  },
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
  /** Persistent spatial temperature; its mean is `temperature`. */
  readonly temperatureField?: TemperatureField;
  /** External heat contact for a scripted tube; absent means only the live flame can heat it. */
  readonly externalHeat?: { readonly power: number; readonly side: number };
  /** Seconds since the tube's reagents first made a reaction — for `holdSeconds`. */
  readonly age?: number;
}

export const ROOM_TEMPERATURE_CHEMISTRY: TubeChemistry = { progress: 0, rate: 0, temperature: 0, age: 0 };

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

/** R1 bookkeeping in normalized game units; ξmax = 1. Progress/rate remain the controller's source of truth. */
export interface CopperReactionState {
  extent: number;
  copper: number;
  acid: number;
  copperII: number;
  nitricOxide: number;
}
export const copperReactionState = (progress: number): CopperReactionState => {
  const extent = clamp01(Number.isFinite(progress) ? progress : 0);
  return { extent, copper: 3 * (1 - extent), acid: 8 * (1 - extent),
    copperII: 3 * extent, nitricOxide: 2 * extent };
};

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
  const temperatureField = state.temperatureField ?? new TemperatureField(state.temperature);
  const heating = useHeatingStore.getState();
  // The caller has already checked the target, lamp and bottom contact.
  const external = state.externalHeat;
  const power = Math.max(inFlame ? 1 : 0, external?.power ?? 0);
  const side = inFlame ? (heating.sweep < 0 ? -1 : 1) : external?.side ?? 0;
  temperatureField.advance(deltaSeconds, power, side,
    TEMPERATURE_RISE_SECONDS, TEMPERATURE_COOL_SECONDS);
  const temperature = clamp01(temperatureField.mean);
  const reaction = findReaction(contents);
  if (!reaction) return { progress: 0, rate: 0, temperature, temperatureField, externalHeat: external, age: 0 };

  const age = (state.age ?? 0) + deltaSeconds;
  if (age < (reaction.holdSeconds ?? 0)) return { progress: 0, rate: 0, temperature, temperatureField, externalHeat: external, age };

  const drive = reaction.coldRate + (1 - reaction.coldRate) * temperature;
  const remaining = 1 - state.progress;
  const rate = reaction.trigger === "heat" ? drive * Math.sqrt(remaining) : remaining > 0 ? drive : 0;
  const progress = clamp01(state.progress + (rate * deltaSeconds) / reaction.seconds);
  return { progress, rate: progress >= 1 ? 0 : rate, temperature, temperatureField, externalHeat: external, age };
};

interface TubeReactionState {
  /** Per tube `instanceId`. Absent means a tube at room temperature with nothing reacting. */
  readonly chemistryById: Readonly<Record<string, TubeChemistry>>;
  setChemistry: (instanceId: string, chemistry: TubeChemistry) => void;
  /** Feed 0..1 flame-equivalent heat into a tube's bottom; side defaults to centre. */
  setExternalHeat: (instanceId: string, power: number, side?: number) => void;
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
  setExternalHeat: (instanceId, power, side = 0) =>
    set((state) => {
      const current = state.chemistryById[instanceId] ?? ROOM_TEMPERATURE_CHEMISTRY;
      const externalHeat = { power: clamp01(Number.isFinite(power) ? power : 0),
        side: Math.max(-1, Math.min(1, Number.isFinite(side) ? side : 0)) };
      return { chemistryById: { ...state.chemistryById, [instanceId]: { ...current, externalHeat } } };
    }),
  clear: (instanceId) =>
    set((state) => {
      if (!(instanceId in state.chemistryById)) return state;
      const { [instanceId]: _removed, ...rest } = state.chemistryById;
      return { chemistryById: rest };
    }),
  reset: () => set({ chemistryById: {} }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __tubeReactionStore?: unknown }).__tubeReactionStore = useTubeReactionStore;
}
