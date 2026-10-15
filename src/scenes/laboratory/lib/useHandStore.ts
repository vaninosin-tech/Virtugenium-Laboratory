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
  | { readonly kind: "workbench-tube"; readonly index: number; readonly instanceId: string }
  /**
   * Something taken off the tray at the table or the hood, to be put down
   * there in its usual place (VL-017) — or back on the tray with RMB.
   */
  | { readonly kind: "tray"; readonly what: "bottle" | "tube" | "stand" | "lamp"; readonly instanceId: string }
  /**
   * The stand or the spirit lamp off the table (`equipmentCarry`): onto the
   * tray there, or — the stand — elsewhere on the table.
   */
  | { readonly kind: "equipment"; readonly what: "stand" | "lamp"; readonly location: "workbench"; readonly instanceId: string }
  /** The stand's clamp, with whatever tube is in it (`clampCarry`): to the lamp's flame, or back onto the stand. */
  | { readonly kind: "clamp"; readonly location: TubeLocation; readonly instanceId: string };

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
  /** Where the held item rests, published by the item itself (`PourMotion`) — the worktop's height. */
  home: new THREE.Vector3(),
  homeValid: false,
  /**
   * The bare hand over the worktop, before it was kept off the things there
   * (`constrainOnWorktop`, VL-018): what the item is brought TO — the stand's
   * magnet answers to it, so the item can snap beside the tube it is kept off.
   */
  rawPoint: new THREE.Vector3(),
  /** Half the held item's width — how far it is kept off things; published by the item (`PourMotion`). */
  radius: 0.03,
  /** Where the held item itself is (its base), as drawn — snapped to a target or on the hand. */
  itemPos: new THREE.Vector3(),
  /** How it is turned there, in the world — published with `itemPos`. */
  itemQuat: new THREE.Quaternion(),
  /**
   * Taken from somewhere other than its own place (a tube out of the clamp,
   * `takeClampedTube`): where it was, in the world — it comes to the hand
   * from there. Consumed by the item on its first carried frame.
   */
  takenFrom: new THREE.Vector3(),
  takenFromValid: false,
  /** The carried item's mouth, in the world (a tube's top) — published by whatever carries it, for a bottle to pour into. */
  mouth: new THREE.Vector3(),
  mouthValid: false,
  itemPosValid: false,
  /** Where the hand is on screen, in CSS px, for the caption next to the item. */
  screen: new THREE.Vector2(),
  /** What a click would do right now — `handActionFor`, refreshed every frame. */
  action: null as { readonly label: string; readonly blocked: boolean } | null,
  /**
   * Just taken: the hand starts where the item is (VL-018), not in the middle
   * of the screen — the stand stands there now, and an item flown to it was
   * snapped to the tube the moment it was picked up. `HandController` puts
   * the hand over the item once the item has said where it is.
   */
  startAtItem: false,
  /**
   * Carried with the button held down (`pressToTake`): letting go of it sets
   * the item down — does what a click would there, or puts it back. Taken by
   * a click instead, it is set down by the next click.
   */
  dragging: false,
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
    HAND.startAtItem = true;
    HAND.dragging = false;
    HAND.valid = false;
    HAND.homeValid = false;
    HAND.itemPosValid = false;
    HAND.takenFromValid = false;
    HAND.mouthValid = false;
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
