import { create } from "zustand";
import type * as THREE from "three";

/**
 * Per-INSTANCE drag overrides for reagents sitting on the workbench (not
 * the tray-held ones) — separate from `useWorkbenchReagentAreaStore`, which
 * only positions the grid as a whole. Each taken reagent's `instanceId` is
 * a dynamic, ever-changing set (new ones appear as the player takes more
 * reagents), so this can't reuse the closed `ReagentPickableId` union
 * `useReagentPickablesStore` uses — it's its own small registry, checked by
 * `CameraRig` as a third pick pool alongside furniture and the fixed
 * reagent pickables.
 *
 * An item with no override here falls back to its grid-computed default
 * (`computeWorkbenchReagentSlotOffsets`) — dragging one jar only ever adds
 * an override for THAT jar, never disturbs its neighbors' own (overridden
 * or still-default) positions.
 */
export interface WorkbenchReagentOverride {
  readonly x: number;
  readonly z: number;
}

/**
 * Drives one jar's swap-into-place tween (see `DraggableWorkbenchReagent`,
 * `Laboratory.tsx`): a fixed-duration arc from its pre-swap table-local
 * position to its post-swap one. Both jars arc around the same midpoint
 * between the two slots, but one of them (`reverseSpin: true`) sweeps the
 * opposite angular direction AND uses a different bulge radius than the
 * other — the different radius is what keeps them from ever occupying the
 * same point at the same instant (two distinct circles through the same two
 * slot points only ever meet exactly at those two points), while the
 * opposite sweep direction is what makes one jar visibly clockwise and the
 * other counterclockwise, rather than both turning the same way around a
 * shared center. See `DraggableWorkbenchReagent`'s handling for the exact
 * parametrization.
 */
export interface WorkbenchReagentSwapSpec {
  readonly fromX: number;
  readonly fromZ: number;
  readonly toX: number;
  readonly toZ: number;
  readonly reverseSpin: boolean;
}

// Previous absolute positions bypassed the new count-centered arrangement.
const STORAGE_KEY = "vg-workbench-reagent-item-positions-v2";

function loadSaved(): Record<string, WorkbenchReagentOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, WorkbenchReagentOverride>;
  } catch {
    return {};
  }
}

function persist(overrides: Record<string, WorkbenchReagentOverride>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore write failures (private browsing / storage disabled)
  }
}

interface WorkbenchReagentDragState {
  readonly objectsById: Readonly<Record<string, THREE.Object3D>>;
  /**
   * Minimal meshes used for hover/swap raycasts. Keeping these separate
   * from the visual roots avoids recursively walking every bottle mesh,
   * label and Fresnel-rim clone on every pointer move.
   */
  readonly pickTargetsById: Readonly<Record<string, THREE.Object3D>>;
  register: (instanceId: string, object: THREE.Object3D, pickTarget: THREE.Object3D) => void;
  unregister: (instanceId: string) => void;
  readonly overrides: Readonly<Record<string, WorkbenchReagentOverride>>;
  /** Active swap-into-place tweens, keyed by instanceId — see `WorkbenchReagentSwapSpec`. */
  readonly swaps: Readonly<Record<string, WorkbenchReagentSwapSpec>>;
  readonly draggingInstanceId: string | null;
  readonly isOverReturnZone: boolean;
  readonly swapTargetInstanceId: string | null;
  readonly grabRequest: {
    readonly instanceId: string;
    readonly clientX: number;
    readonly clientY: number;
    readonly sequence: number;
  } | null;
  requestGrab: (instanceId: string, clientX: number, clientY: number) => void;
  clearGrabRequest: () => void;
  beginDrag: (instanceId: string) => void;
  setOverReturnZone: (isOverReturnZone: boolean) => void;
  setSwapTarget: (instanceId: string | null) => void;
  endDrag: () => void;
  setPosition: (instanceId: string, x: number, z: number) => void;
  reset: (instanceId: string) => void;
  resetAll: () => void;
  /** Starts both jars' swap tweens atomically (one `set` call) so they never render one-frame-mismatched. */
  beginSwap: (entries: readonly { instanceId: string; spec: WorkbenchReagentSwapSpec }[]) => void;
  /** Call once an instance's own tween reaches t=1 — leaves the other jar's (if still running) untouched. */
  clearSwap: (instanceId: string) => void;
}

export const useWorkbenchReagentDragStore = create<WorkbenchReagentDragState>((set) => ({
  objectsById: {},
  pickTargetsById: {},
  overrides: loadSaved(),
  swaps: {},
  draggingInstanceId: null,
  isOverReturnZone: false,
  swapTargetInstanceId: null,
  grabRequest: null,

  register: (instanceId, object, pickTarget) =>
    set((state) => {
      if (
        state.objectsById[instanceId] === object &&
        state.pickTargetsById[instanceId] === pickTarget
      ) {
        return state;
      }
      return {
        objectsById: { ...state.objectsById, [instanceId]: object },
        pickTargetsById: { ...state.pickTargetsById, [instanceId]: pickTarget },
      };
    }),

  unregister: (instanceId) =>
    set((state) => {
      const next = { ...state.objectsById };
      const nextPickTargets = { ...state.pickTargetsById };
      const swaps = { ...state.swaps };
      delete next[instanceId];
      delete nextPickTargets[instanceId];
      delete swaps[instanceId];
      return {
        objectsById: next,
        pickTargetsById: nextPickTargets,
        swaps,
        ...(state.draggingInstanceId === instanceId
          ? { draggingInstanceId: null, isOverReturnZone: false, swapTargetInstanceId: null }
          : {}),
      };
    }),

  beginDrag: (instanceId) =>
    set((state) => state.draggingInstanceId === instanceId && !state.isOverReturnZone && state.swapTargetInstanceId === null
      ? state
      : { draggingInstanceId: instanceId, isOverReturnZone: false, swapTargetInstanceId: null }),
  requestGrab: (instanceId, clientX, clientY) =>
    set((state) => ({
      grabRequest: {
        instanceId,
        clientX,
        clientY,
        sequence: (state.grabRequest?.sequence ?? 0) + 1,
      },
    })),
  clearGrabRequest: () => set({ grabRequest: null }),
  setOverReturnZone: (isOverReturnZone) =>
    set((state) => state.isOverReturnZone === isOverReturnZone ? state : { isOverReturnZone }),
  setSwapTarget: (swapTargetInstanceId) =>
    set((state) => state.swapTargetInstanceId === swapTargetInstanceId ? state : { swapTargetInstanceId }),
  endDrag: () =>
    set((state) => state.draggingInstanceId === null && !state.isOverReturnZone && state.swapTargetInstanceId === null
      ? state
      : { draggingInstanceId: null, isOverReturnZone: false, swapTargetInstanceId: null }),

  // Persisted immediately (not gated behind a separate SAVE button, unlike
  // the numeric calibration panels) — dragging IS the whole interaction
  // here, there's no companion slider UI to hang a Save action off of.
  setPosition: (instanceId, x, z) =>
    set((state) => {
      const overrides = { ...state.overrides, [instanceId]: { x, z } };
      persist(overrides);
      return { overrides };
    }),

  reset: (instanceId) =>
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[instanceId];
      persist(overrides);
      return { overrides };
    }),

  resetAll: () => {
    persist({});
    set({ overrides: {} });
  },

  beginSwap: (entries) =>
    set((state) => ({
      swaps: {
        ...state.swaps,
        ...Object.fromEntries(entries.map(({ instanceId, spec }) => [instanceId, spec])),
      },
    })),

  clearSwap: (instanceId) =>
    set((state) => {
      if (!(instanceId in state.swaps)) return state;
      const swaps = { ...state.swaps };
      delete swaps[instanceId];
      return { swaps };
    }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __workbenchReagentDragStore?: unknown }).__workbenchReagentDragStore =
    useWorkbenchReagentDragStore;
}
