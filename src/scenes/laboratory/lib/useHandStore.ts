import * as THREE from "three";
import { create } from "zustand";

import type { ContainerType } from "../../../entities/laboratory/reagents/types";
import type { Position3 } from "./layout";
import type { TubeLocation } from "./useTestTubeStorageStore";

/**
 * «Рука» (VL-015): the player takes a bottle or a tube off the table or the
 * hood's worktop. The cursor and the «Назад» button go away, the item is
 * outlined, flies to the middle of the screen and from then on the mouse
 * moves IT over the worktop. Brought to its target (the clamp, the clamped
 * tube) it shows what a click will do; a click does it. A double click puts
 * it back where it was.
 *
 * The workbench rack's tubes were already carried this way, following the
 * cursor (`useTestTubeDragStore`, `InspectableTestTubeSlot`); the hand drives
 * that same carry instead of duplicating it — see `HandController`.
 */
export type HeldItem =
  | {
      readonly kind: "bottle";
      readonly location: TubeLocation;
      readonly instanceId: string;
      readonly reagentId: string;
      readonly containerType: ContainerType;
    }
  | { readonly kind: "tube"; readonly location: "fumeHood"; readonly index: number; readonly instanceId: string }
  /** A workbench rack tube — carried by `InspectableTestTubeSlot` itself, the hand only steers it. */
  | { readonly kind: "workbench-tube"; readonly index: number; readonly instanceId: string };

/**
 * The hand, as plain mutable state read and written every frame (never a
 * reason to re-render): the virtual cursor in NDC — it starts in the middle
 * of the screen, the mouse moves it under Pointer Lock — and the point over
 * the worktop it puts the item at.
 */
export const HAND = {
  ndc: new THREE.Vector2(),
  point: new THREE.Vector3(),
  valid: false,
  /** Where the held item rests, published by the item itself (`HandFollow`/`PourMotion`) — the worktop's height. */
  home: new THREE.Vector3(),
  homeValid: false,
  /** Where the hand is on screen, in CSS px, for the caption next to the item. */
  screen: new THREE.Vector2(),
  /** What a click would do right now — `handActionFor`, refreshed every frame. */
  action: null as { readonly label: string; readonly blocked: boolean } | null,
  /** When the hand last let go — an Esc that put the item back must not also leave the zone (`escapeTakenByHand`). */
  releasedAt: 0,
  /** The canvas, for Pointer Lock — set by `HandController`. */
  canvas: null as HTMLCanvasElement | null,
};

/**
 * What the held item is brought to, so the target itself lights up (blue —
 * a click does it; red — it can't): the tube in the clamp (to pour into) or
 * the empty clamp (to put a tube in).
 */
export interface HandAim {
  readonly part: "tube" | "clamp";
  readonly refused: boolean;
}

interface HandState {
  readonly held: HeldItem | null;
  readonly aim: HandAim | null;
  setAim: (aim: HandAim | null) => void;
  /** Where the held item rests, in the world: the worktop height, and where it goes back to. */
  readonly home: Position3 | null;
  take: (item: HeldItem, home: Position3) => void;
  /** Lets go of the item; whoever placed it (or put it back) has already taken care of where it is. */
  release: () => void;
}

export const useHandStore = create<HandState>((set) => ({
  held: null,
  aim: null,
  setAim: (aim) =>
    set((state) =>
      state.aim?.part === aim?.part && state.aim?.refused === aim?.refused ? state : { aim },
    ),
  home: null,
  take: (held, home) => {
    HAND.ndc.set(0, 0);
    HAND.valid = false;
    HAND.homeValid = false;
    HAND.action = null;
    set({ held, home });
  },
  release: () => {
    HAND.releasedAt = Date.now();
    set({ held: null, home: null, aim: null });
  },
}));

/** An Esc while holding (or the one that just put the item back) belongs to the hand. */
export const escapeTakenByHand = (): boolean =>
  useHandStore.getState().held !== null || Date.now() - HAND.releasedAt < 250;

/** Same item? A held item is identified by its instance id. */
export const isHeld = (instanceId: string) => useHandStore.getState().held?.instanceId === instanceId;

/**
 * Takes `item` into the hand. Called from the click that picked it up — the
 * user activation Pointer Lock needs.
 */
export function takeIntoHand(item: HeldItem, home: Position3): void {
  if (useHandStore.getState().held) return;
  useHandStore.getState().take(item, home);
  const canvas = HAND.canvas;
  if (canvas && document.pointerLockElement !== canvas) {
    try {
      const request = canvas.requestPointerLock() as Promise<void> | undefined;
      request?.catch(() => {});
    } catch {
      // Without the lock the hand still works off mouse movement deltas.
    }
  }
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __hand?: unknown }).__hand = { store: useHandStore, HAND };
}
