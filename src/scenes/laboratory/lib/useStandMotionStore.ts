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
 * Pour time is simulation time. A stalled timer catches up from the elapsed
 * clock difference; each pour remains capped at one standard portion.
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
export const CLAMP_TUBE_MOUTH = {
  point: new THREE.Vector3(),
  rod: new THREE.Vector3(),
  /** Where a tube in the clamp stands, in the world — its origin, turned as the clamp holds it (`StandStation`). */
  root: new THREE.Matrix4(),
  valid: false,
};

/**
 * Where the clamp — with its tube — is held in the lamp's flame for heating,
 * in the world (`heldClampPose`, published by the clamp itself, `StandStation`):
 * the outline of a carried clamp shows it there. Valid only while the lamp
 * stands where the stand does.
 */
export const CLAMP_HEAT_POSE = { matrix: new THREE.Matrix4(), valid: false };

/** A tube that left one place for another and should be seen flying from `world`. */
export interface TubeArrival {
  readonly world: Position3;
  readonly at: number;
  /** How it was turned there, in the world — it turns into its place as it flies; upright when not given. */
  readonly quaternion?: readonly [number, number, number, number];
}

interface StandMotionState {
  /** Stand clicks are refused until then. */
  readonly busyUntil: number;
  /** `from`: where the bottle's base was when the pour began (it was in the hand), if not at its place. */
  readonly pour: {
    readonly instanceId: string;
    readonly at: number;
    readonly from?: Position3;
    /** Into the tube held in the hand rather than the one in the clamp (`HAND.mouth`). */
    readonly into?: "clamp" | "hand";
  } | null;
  /** The tube now in the clamp, flying in from its rack slot. */
  readonly clampArrival: TubeArrival | null;
  /** The tube just taken out of the clamp, flying back to its rack slot. */
  readonly rackArrival: (TubeArrival & { readonly location: TubeLocation; readonly index: number }) | null;
  /** The stand or the lamp just set down off the tray, flying from the hand to its place. */
  readonly equipmentArrival: (TubeArrival & { readonly what: "stand" | "lamp" }) | null;
  readonly simulationPaused: boolean;
  /** Refuses stand clicks for `ms`. */
  hold: (ms: number) => void;
  /** Starts a bottle's pour; `commit` puts the reagent in the tube at the pour's tipping point. */
  startPour: (instanceId: string, commit: () => void, from?: Position3, into?: "clamp" | "hand",
    onStep?: (serial: number, now: number) => void) => void;
  arriveInClamp: (world: Position3) => void;
  arriveInRack: (location: TubeLocation, index: number, world: Position3) => void;
  arriveEquipment: (what: "stand" | "lamp", world: Position3, quaternion: readonly [number, number, number, number]) => void;
}

let simulationMs = 0;
let wallSample = Date.now();
const tickListeners = new Set<(now: number) => void>();
let activeStep: ((serial: number, now: number) => void) | undefined;
let activeSerial: number | undefined;
let activeCommit: (() => void) | undefined;
let committed = false;
export function simNowMs(): number {
  const now = Date.now();
  if (!useStandMotionStore.getState().simulationPaused) simulationMs += Math.max(0, now - wallSample);
  wallSample = now;
  return simulationMs;
}
export function setSimulationPaused(paused: boolean): void {
  simNowMs();
  useStandMotionStore.setState({ simulationPaused: paused });
}
export function onSimulationTick(listener: (now: number) => void): () => void {
  tickListeners.add(listener);
  return () => tickListeners.delete(listener);
}
export const useStandMotionStore = create<StandMotionState>((set) => ({
  busyUntil: 0,
  simulationPaused: false,
  pour: null,
  clampArrival: null,
  rackArrival: null,
  equipmentArrival: null,
  hold: (ms) => set((state) => ({ busyUntil: Math.max(state.busyUntil, Date.now() + ms) })),
  startPour: (instanceId, commit, from, into, onStep) => {
    restartSimulationTimer();
    const at = simNowMs();
    set({ pour: { instanceId, at, from, into }, busyUntil: at + POUR_MS });
    activeStep = onStep; activeSerial = at; activeCommit = commit; committed = false;
  },
  arriveInClamp: (world) => {
    const at = Date.now();
    set((state) => ({ clampArrival: { world, at }, busyUntil: Math.max(state.busyUntil, at + TUBE_FLIGHT_MS) }));
  },
  arriveInRack: (location, index, world) => {
    const at = Date.now();
    set((state) => ({
      rackArrival: { location, index, world, at },
      busyUntil: Math.max(state.busyUntil, at + TUBE_FLIGHT_MS),
    }));
  },
  arriveEquipment: (what, world, quaternion) => {
    const at = Date.now();
    set((state) => ({
      equipmentArrival: { what, world, quaternion, at },
      busyUntil: Math.max(state.busyUntil, at + TUBE_FLIGHT_MS),
    }));
  },
}));

/** Whether a motion at the stand is still running. */
export const standBusy = (): boolean => simNowMs() < useStandMotionStore.getState().busyUntil;

// One timer owns all simulation progression, regardless of React or WebGL frames.
let simulationTimer: ReturnType<typeof setInterval>;
function simulationPulse() {
  const now = simNowMs();
  const pour = useStandMotionStore.getState().pour;
  if (pour && pour.at === activeSerial) {
    activeStep?.(pour.at, Math.min(now, pour.at + POUR_MS));
    for (const listener of tickListeners) listener(now);
    if (!activeStep && !committed && now - pour.at >= POUR_COMMIT_MS) {
      committed = true; activeCommit?.();
    }
    if (now - pour.at >= POUR_MS) {
      useStandMotionStore.setState({ pour: null });
      activeStep = undefined; activeCommit = undefined; activeSerial = undefined;
    }
  } else for (const listener of tickListeners) listener(now);
}
function restartSimulationTimer() {
  if (simulationTimer) clearInterval(simulationTimer);
  simulationTimer = setInterval(simulationPulse, 25);
  if (typeof simulationTimer === "object" && "unref" in simulationTimer)
    (simulationTimer as { unref: () => void }).unref();
}
restartSimulationTimer();

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __standMotion?: unknown }).__standMotion = { store: useStandMotionStore, mouth: CLAMP_TUBE_MOUTH };
}
