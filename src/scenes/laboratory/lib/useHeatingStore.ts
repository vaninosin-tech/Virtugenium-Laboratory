import { create } from "zustand";

/**
 * The glass along the tube is modelled as this many zones. The knob's
 * position on the track is the part of the tube sitting in the flame, so
 * the zones are laid out along the same -1..1 axis as the knob.
 */
export const HEAT_ZONE_COUNT = 12;

/**
 * Seconds for the target oval to cross the track once. Four crossings are the
 * ToR's «провести в пламени влево-вправо четыре раза», so `PREHEAT_PER_PASS`
 * below is 1/4 — a player who simply follows the oval finishes the preheat in
 * exactly four passes.
 */
export const PASS_SECONDS = 5;
const TARGET_SPEED = 2 / PASS_SECONDS;
const PREHEAT_PER_PASS = 1 / 4;

/** Half-width, in track units, of the stretch of glass the flame reaches. */
export const FLAME_HALF_WIDTH = 0.25;

/**
 * Heating rate under the flame's peak, derived so one crossing at the
 * oval's speed deposits exactly `PREHEAT_PER_PASS` into every zone: the flame
 * is a triangle of half-width `FLAME_HALF_WIDTH`, so a zone swept at
 * `TARGET_SPEED` receives `rate * FLAME_HALF_WIDTH / TARGET_SPEED`.
 */
const HEAT_RATE = (PREHEAT_PER_PASS * TARGET_SPEED) / FLAME_HALF_WIDTH;

/**
 * Hottest-minus-coldest zone at which the glass cracks. Following the oval
 * never exceeds about one pass's worth (0.25) plus the flame's edges; holding
 * still in the flame reaches this in roughly a second and a half. That is the
 * ToR's «нагрев без предварительного прогревания» expressed as the physics it
 * is about — uneven heating is what actually breaks the tube.
 */
export const CRACK_SPREAD = 0.6;
/** Zone temperature that counts as preheated. */
const PREHEATED = 0.97;

/** Spread at which the overlay starts warning. */
export const WARN_SPREAD = 0.4;

/** Half-width of the target oval, also the tolerance for "held in the flame" during heating. */
export const TARGET_HALF_WIDTH = 0.14;

/** Seconds of holding the contents in the flame to finish heating them. */
export const HEAT_SECONDS = 3.5;

export type HeatingPhase = "preheat" | "heating" | "done" | "cracked";

interface HeatingState {
  /** Whether the heating mini-game currently owns the controls. */
  readonly active: boolean;
  /** Knob position, -1..1 — the tube's offset across the flame. */
  readonly sweep: number;
  /** Per-zone glass temperature, 0..1; preheat is done when every zone reaches 1. */
  readonly zones: readonly number[];
  /** The oval the player follows, -1..1. */
  readonly target: number;
  readonly targetDirection: -1 | 1;
  /**
   * The oval and the flame wait for the player's first grab — otherwise the
   * tube would sit in the flame while the player is still reading the hint.
   */
  readonly started: boolean;
  /** 0..1 progress of heating the contents, only advances once preheated. */
  readonly heatProgress: number;
  readonly phase: HeatingPhase;
  /** `random` is injectable so tests can pick the oval's starting side. */
  enter: (random?: () => number) => void;
  exit: () => void;
  grab: () => void;
  setSweep: (sweep: number) => void;
  /** Advances the oval and the glass. `burnerLit: false` freezes the heating but not the oval. */
  tick: (deltaSeconds: number, burnerLit: boolean) => void;
  /** Rollback after a crack: fresh glass, same contents, the preheat starts over. */
  restartPreheat: (random?: () => number) => void;
  reset: () => void;
}

const coldZones = (): number[] => Array.from({ length: HEAT_ZONE_COUNT }, () => 0);

/**
 * Centre of zone `index` on the -1..1 track. The zones span the track inset
 * by the flame's half-width, so the whole triangle of every zone — end zones
 * included — lies within the knob's travel. Spread across the full track,
 * the end zones would only ever get a partial flame per crossing, finish the
 * preheat late and read as a false spread against the middle.
 */
export const zoneCentre = (index: number): number => {
  const span = 1 - FLAME_HALF_WIDTH;
  return -span + (2 * span * (index + 0.5)) / HEAT_ZONE_COUNT;
};

/** Spread between the hottest and coldest zone — the quantity that cracks the glass. */
export const heatSpread = (zones: readonly number[]): number =>
  zones.length === 0 ? 0 : Math.max(...zones) - Math.min(...zones);

const freshPreheat = (random: () => number) => {
  const side: -1 | 1 = random() < 0.5 ? -1 : 1;
  return {
    zones: coldZones(),
    target: side,
    targetDirection: (-side) as -1 | 1,
    // The knob starts under the oval, at the end of the track — out of the
    // flame's centre, so nothing heats before the player moves.
    sweep: side,
    started: false,
    heatProgress: 0,
    phase: "preheat" as HeatingPhase,
  };
};

const INITIAL = {
  active: false,
  sweep: 0,
  zones: coldZones() as readonly number[],
  target: 0,
  targetDirection: 1 as -1 | 1,
  started: false,
  heatProgress: 0,
  phase: "preheat" as HeatingPhase,
};

export const useHeatingStore = create<HeatingState>((set, get) => ({
  ...INITIAL,

  enter: (random = Math.random) =>
    set((state) => {
      // Re-entering mid-preheat keeps the glass as it was; only an untouched
      // preheat gets a fresh starting side.
      const untouched = state.phase === "preheat" && !state.started;
      return untouched ? { active: true, ...freshPreheat(random) } : { active: true };
    }),

  exit: () => set({ active: false }),

  grab: () => {
    if (!get().started) set({ started: true });
  },

  setSweep: (rawSweep) => set({ sweep: Math.max(-1, Math.min(1, rawSweep)) }),

  tick: (deltaSeconds, burnerLit) =>
    set((state) => {
      if (!state.active || !state.started) return state;
      if (state.phase === "cracked" || state.phase === "done") return state;

      if (state.phase === "heating") {
        if (!burnerLit || Math.abs(state.sweep) > TARGET_HALF_WIDTH) return state;
        const heatProgress = Math.min(1, state.heatProgress + deltaSeconds / HEAT_SECONDS);
        return { heatProgress, phase: heatProgress >= 1 ? "done" : "heating" };
      }

      // Preheat: the oval ping-pongs between the ends of the track.
      let target = state.target + state.targetDirection * TARGET_SPEED * deltaSeconds;
      let targetDirection = state.targetDirection;
      if (target >= 1) {
        target = 2 - target;
        targetDirection = -1;
      } else if (target <= -1) {
        target = -2 - target;
        targetDirection = 1;
      }

      if (!burnerLit) return { target, targetDirection };

      const zones = state.zones.map((heat, index) => {
        const weight = Math.max(0, 1 - Math.abs(zoneCentre(index) - state.sweep) / FLAME_HALF_WIDTH);
        return Math.min(1, heat + HEAT_RATE * weight * deltaSeconds);
      });

      if (heatSpread(zones) >= CRACK_SPREAD) {
        return { zones, target, targetDirection, phase: "cracked" };
      }
      // A hair under 1: frame-by-frame integration of four exact passes lands
      // a few thousandths short, and the player must not need a fifth.
      if (Math.min(...zones) >= PREHEATED) {
        // Preheated: the oval parks in the flame for the heating itself.
        return { zones, target: 0, targetDirection, phase: "heating" };
      }
      return { zones, target, targetDirection };
    }),

  restartPreheat: (random = Math.random) => set({ active: true, ...freshPreheat(random) }),

  reset: () => set(INITIAL),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __heatingStore?: unknown }).__heatingStore = useHeatingStore;
}
