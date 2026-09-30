import { create } from "zustand";

/**
 * The heating mini-game, after `docs/assets/SpiritLamp_flame_logic.txt`: the
 * clamp comes off the stand and the player drags an ellipse along a V-shaped
 * line; the held tube follows it through the spirit lamp's STILL flame
 * (`HeldClampRig`). Along the line, `sweep` runs -1..1: the two tops of the V
 * put the tube's bottom in the flame, the vertex puts the flame at the middle
 * of the tube, and each arm is one flank of the glass. The glass along that
 * line is modelled as this many zones.
 */
export const HEAT_ZONE_COUNT = 12;

/**
 * The reference pace: seconds for one pass from one top of the V to the
 * other. Four such passes are the ToR's «провести в пламени четыре раза», so
 * `PREHEAT_PER_PASS` below is 1/4. Faster passes warm less each and simply
 * take more of them; lingering is what cracks the glass.
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

/** How close to a top of the V counts as "the tube's bottom in the flame" when heating the contents. */
export const TARGET_HALF_WIDTH = 0.14;

/** Whether `sweep` holds the tube's bottom in the flame — either top of the V. */
export const bottomInFlame = (sweep: number): boolean => Math.abs(sweep) >= 1 - TARGET_HALF_WIDTH;

/** Seconds of holding the contents in the flame to finish heating them. */
export const HEAT_SECONDS = 3.5;

export type HeatingPhase = "preheat" | "heating" | "done" | "cracked";

interface HeatingState {
  /** Whether the heating mini-game currently owns the controls. */
  readonly active: boolean;
  /** The ellipse's position along the V, -1..1 — where on the glass the flame is. */
  readonly sweep: number;
  /** Per-zone glass temperature, 0..1; preheat is done when every zone reaches 1. */
  readonly zones: readonly number[];
  /**
   * The glass waits for the player's first grab — otherwise the tube would
   * sit in the flame while the player is still reading the hint.
   */
  readonly started: boolean;
  /** 0..1 progress of heating the contents, only advances once preheated. */
  readonly heatProgress: number;
  readonly phase: HeatingPhase;
  /** The zone that was hottest when the glass cracked — where the crack starts. Null until a crack. */
  readonly crackZone: number | null;
  /** `random` is injectable so tests can pick the starting top of the V. */
  enter: (random?: () => number) => void;
  exit: () => void;
  grab: () => void;
  setSweep: (sweep: number) => void;
  /** Advances the glass. `burnerLit: false` heats nothing. */
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

/**
 * Where on the tube a crack in `zone` starts: on the flank of that arm of the
 * V, higher up the tube the nearer the zone is to the V's vertex.
 *
 * `side` is signed across the tube, -1..1; `height` is 0..1 along the tube
 * from its tip.
 */
export interface CrackSpot {
  readonly side: number;
  readonly height: number;
}

/** Tube length the V covers from the bottom, as a fraction of the 15 cm tube (`heldTubePose`). */
const V_REACH = 0.1 / 0.15;

export const crackSpotForZone = (zone: number): CrackSpot => {
  const u = zoneCentre(zone) / (1 - FLAME_HALF_WIDTH);
  return { side: u, height: 0.04 + V_REACH * (1 - Math.abs(u)) };
};

/** Spread between the hottest and coldest zone — the quantity that cracks the glass. */
export const heatSpread = (zones: readonly number[]): number =>
  zones.length === 0 ? 0 : Math.max(...zones) - Math.min(...zones);

const freshPreheat = (random: () => number) => {
  const side: -1 | 1 = random() < 0.5 ? -1 : 1;
  return {
    zones: coldZones(),
    // The ellipse starts at a top of the V, the tube's bottom at the flame.
    sweep: side,
    started: false,
    heatProgress: 0,
    phase: "preheat" as HeatingPhase,
    crackZone: null,
  };
};

const INITIAL = {
  active: false,
  sweep: 0,
  zones: coldZones() as readonly number[],
  started: false,
  heatProgress: 0,
  phase: "preheat" as HeatingPhase,
  crackZone: null as number | null,
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
      if (!state.active || !state.started || !burnerLit) return state;
      if (state.phase === "cracked" || state.phase === "done") return state;

      if (state.phase === "heating") {
        if (!bottomInFlame(state.sweep)) return state;
        const heatProgress = Math.min(1, state.heatProgress + deltaSeconds / HEAT_SECONDS);
        return { heatProgress, phase: heatProgress >= 1 ? "done" : "heating" };
      }

      const zones = state.zones.map((heat, index) => {
        const weight = Math.max(0, 1 - Math.abs(zoneCentre(index) - state.sweep) / FLAME_HALF_WIDTH);
        return Math.min(1, heat + HEAT_RATE * weight * deltaSeconds);
      });

      if (heatSpread(zones) >= CRACK_SPREAD) {
        const crackZone = zones.indexOf(Math.max(...zones));
        return { zones, phase: "cracked", crackZone };
      }
      // A hair under 1: frame-by-frame integration of four exact passes lands
      // a few thousandths short, and the player must not need a fifth.
      if (Math.min(...zones) >= PREHEATED) return { zones, phase: "heating" };
      return { zones };
    }),

  restartPreheat: (random = Math.random) => set({ active: true, ...freshPreheat(random) }),

  reset: () => set(INITIAL),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __heatingStore?: unknown }).__heatingStore = useHeatingStore;
}
