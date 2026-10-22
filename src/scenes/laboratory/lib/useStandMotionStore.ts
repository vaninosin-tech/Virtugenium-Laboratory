import * as THREE from "three";
import { create } from "zustand";

import type { ContainerType } from "../../../entities/laboratory/reagents/types";
import type { Position3 } from "./layout";
import type { TubeLocation } from "./useTestTubeStorageStore";

/**
 * The motions that make a stand action visible (VL-014): a bottle comes to
 * the clamped tube, tips, pours and goes back; a tube flies from the rack
 * into the clamp and back. While one runs, nothing else at the stand can be
 * clicked — a quick player could otherwise pour twice, or pour into a tube
 * still in the air.
 *
 * Times are `Date.now()` milliseconds: the animators read the same clock to
 * know where they are in a motion, and tests can fake it.
 */

/** Whole pour: to the tube, tip, pour, back home. */
export const POUR_MS = 1700;
/** When, into the pour, the reagent is actually in the tube — with the bottle tipped over the mouth. */
export const POUR_COMMIT_MS = 820;
/** A tube flying between the rack and the clamp. */
export const TUBE_FLIGHT_MS = 480;
/** The lamp's cap coming off or going on (`SpiritBurner`'s `CAP_MOVE_SECONDS`). */
export const CAP_MS = 600;

/**
 * Height of each container's pour point above its base centre — the
 * `PourPoint*` anchors in `ReagentContainers.glb` (`tests/measure-model.mjs`).
 */
export const POUR_POINT_HEIGHT: Record<ContainerType, number> = {
  clear250: 0.1322,
  amber250: 0.1322,
  wide120: 0.0791,
};

/**
 * World position of the clamped tube's mouth, and of the stand's rod base,
 * written every frame by the stand (`StandStation`) and read by a pouring
 * bottle — it comes in on the side away from the rod. A plain mutable object
 * like `TUBE_FOCUS`: read in `useFrame`, never a reason to re-render.
 */
export const CLAMP_TUBE_MOUTH = { point: new THREE.Vector3(), rod: new THREE.Vector3(), valid: false };

/** A tube flying to rack slot `index` of `location`. */
export type RackArrival = TubeArrival & { readonly location: TubeLocation; readonly index: number };

/** The latest flight to rack slot `index` of `location`, if any is recorded. */
export function rackArrivalFor(arrivals: readonly RackArrival[], location: TubeLocation, index: number): RackArrival | null {
  for (let i = arrivals.length - 1; i >= 0; i -= 1) {
    if (arrivals[i].location === location && arrivals[i].index === index) return arrivals[i];
  }
  return null;
}

/** A tube that left one place for another and should be seen flying from `world`. */
export interface TubeArrival {
  readonly world: Position3;
  readonly at: number;
}

interface StandMotionState {
  /** Stand clicks are refused until then. */
  readonly busyUntil: number;
  /** `from`: where the bottle's base was when the pour began (it was in the hand), if not at its place. */
  readonly pour: { readonly instanceId: string; readonly at: number; readonly from?: Position3 } | null;
  /** The tube now in the clamp, flying in from its rack slot. */
  readonly clampArrival: TubeArrival | null;
  /**
   * Tubes just taken out of the clamp (or off the tray), flying to their rack
   * slots. A list: unloading the tray (`trayUnload`) starts several in a row.
   */
  readonly rackArrivals: readonly RackArrival[];
  /** Refuses stand clicks for `ms`. */
  hold: (ms: number) => void;
  /** Starts a bottle's pour; `commit` puts the reagent in the tube at the pour's tipping point. */
  startPour: (instanceId: string, commit: () => void, from?: Position3) => void;
  arriveInClamp: (world: Position3) => void;
  arriveInRack: (location: TubeLocation, index: number, world: Position3) => void;
}

export const useStandMotionStore = create<StandMotionState>((set) => ({
  busyUntil: 0,
  pour: null,
  clampArrival: null,
  rackArrivals: [],
  hold: (ms) => set((state) => ({ busyUntil: Math.max(state.busyUntil, Date.now() + ms) })),
  startPour: (instanceId, commit, from) => {
    const at = Date.now();
    set({ pour: { instanceId, at, from }, busyUntil: at + POUR_MS });
    setTimeout(commit, POUR_COMMIT_MS);
    setTimeout(() => {
      set((state) => (state.pour?.at === at ? { pour: null } : state));
    }, POUR_MS);
  },
  arriveInClamp: (world) => {
    const at = Date.now();
    set((state) => ({ clampArrival: { world, at }, busyUntil: Math.max(state.busyUntil, at + TUBE_FLIGHT_MS) }));
  },
  arriveInRack: (location, index, world) => {
    const at = Date.now();
    set((state) => ({
      // Flights already over are dropped; the ones still in the air keep flying.
      rackArrivals: [...state.rackArrivals.filter((arrival) => at - arrival.at < TUBE_FLIGHT_MS), { location, index, world, at }],
      busyUntil: Math.max(state.busyUntil, at + TUBE_FLIGHT_MS),
    }));
  },
}));

/** Whether a motion at the stand is still running. */
export const standBusy = (): boolean => Date.now() < useStandMotionStore.getState().busyUntil;

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __standMotion?: unknown }).__standMotion = { store: useStandMotionStore, mouth: CLAMP_TUBE_MOUTH };
}
