import { create } from "zustand";
import { Vector2 } from "three";

import { useReagentInspectionStore } from "./useReagentInspectionStore";

/**
 * Last known cursor position, in NDC (-1..1), tracked CONTINUOUSLY by a
 * single always-on listener (`WorkbenchTestTubeRackInstance`) rather than
 * something each `InspectableTestTubeSlot` starts tracking only once it
 * becomes held. A per-instance ref that only starts listening on pick-up
 * defaults to (0, 0) until the very next real mouse move, which is exactly
 * why a freshly-picked tube used to sit at screen-center (or wherever the
 * PREVIOUS held tube's cursor tracking left off) instead of snapping
 * straight to the cursor immediately. A plain mutable `Vector2` (not React
 * or zustand state) so `Raycaster.setFromCamera` can take it directly — this
 * updates every mousemove and is only ever read inside `useFrame`, so it
 * must never trigger a re-render.
 */
export const sharedMouseNdc = new Vector2();

interface TestTubeDragState {
  /** Which tube (its `workbench-tube-slot-${index}` id) is currently "picked up" and following the cursor — only one at a time. `InspectableTestTubeSlot` reads this to know whether to track the mouse instead of resting in its rack slot. */
  readonly heldInstanceId: string | null;
  /**
   * A tube clicked from `ReagentInspectionOverlay`'s button grid while the
   * holder is being inspected — the player asked to be taken OUT of the
   * holder first, THEN have the tube actually picked up, not both at once.
   * `WorkbenchTestTubeRackInstance` calls `promotePendingPick` itself, once
   * the rack's own return-to-bench flight actually finishes (right where it
   * already calls `finishClose`), which is what turns this into
   * `heldInstanceId`.
   */
  readonly pendingPickInstanceId: string | null;
  requestPick: (id: string) => void;
  promotePendingPick: () => void;
  /** Toggle-release: a no-op unless `id` is the one currently held. */
  releaseIfHeld: (id: string) => void;
  /** Unconditional release (e.g. the global Escape handler) — there's only ever one held tube, so nothing needs to know its id to drop it. */
  release: () => void;
  /**
   * Whether the currently-dragged tube is close enough to the rack to treat
   * it as "bringing it back" — computed every frame, in 3D, by
   * `InspectableTestTubeSlot` itself (straight-line distance from the
   * tube's own live position to the rack's origin), NOT from R3F pointer
   * hover events. Pointer over/out only fire on an actual mouse move, but
   * here the TUBE is what's moving while the cursor may sit still, so
   * relying on hover left the rack's highlight stuck wherever it last
   * happened to catch a real mouse move — sometimes lit up far from the
   * rack, sometimes not lighting up right next to it. Distance is checked
   * fresh every frame regardless of whether the mouse itself moves, so it
   * can't go stale the way the hover event ever did.
   */
  readonly isNearHolder: boolean;
  setNearHolder: (near: boolean) => void;
}

export const useTestTubeDragStore = create<TestTubeDragState>((set) => ({
  heldInstanceId: null,
  pendingPickInstanceId: null,
  isNearHolder: false,
  requestPick: (id) => set({ pendingPickInstanceId: id }),
  promotePendingPick: () =>
    set((state) =>
      state.pendingPickInstanceId
        ? { heldInstanceId: state.pendingPickInstanceId, pendingPickInstanceId: null }
        : state,
    ),
  releaseIfHeld: (id) =>
    set((state) => (state.heldInstanceId === id ? { heldInstanceId: null, isNearHolder: false } : state)),
  release: () => set({ heldInstanceId: null, pendingPickInstanceId: null, isNearHolder: false }),
  setNearHolder: (near) => set((state) => (state.isNearHolder === near ? state : { isNearHolder: near })),
}));

/**
 * Toggle a tube's held/dropped state — the exact same logic whether it's
 * triggered from `ReagentInspectionOverlay`'s 2D button grid or a direct
 * click on the tube itself in the 3D inspecting view (`InspectableTestTubeSlot`),
 * so both entry points behave identically: already held → drop it; not held
 * → leave the holder first (`requestClose`), THEN pick it up once the rack
 * actually lands back on the bench (see `pendingPickInstanceId`'s doc).
 */
export function toggleTubePick(instanceId: string): void {
  const dragState = useTestTubeDragStore.getState();
  if (dragState.heldInstanceId === instanceId) {
    dragState.releaseIfHeld(instanceId);
    return;
  }
  dragState.requestPick(instanceId);
  useReagentInspectionStore.getState().requestClose();
}

/**
 * Set by a workbench jar's own `pointerdown` handler the instant it declines
 * to grab because a tube is already held (see `Laboratory.tsx`'s
 * `DraggableWorkbenchReagent`), consumed by the very next `click`
 * (`InspectableTestTubeSlot`'s "click while held drops the tube" listener).
 * Lets that listener tell "pressed a jar" apart from "clicked empty air"
 * using the jar's OWN already-reliable R3F pointer hit-test — the same one
 * that decides whether to grab it — instead of reconstructing a second,
 * independent raycast from scratch purely to answer the same question. That
 * duplicate raycast measurably drifted from the real hit in practice (a
 * press square on a jar's own hitbox still came back empty), which is
 * exactly why this replaces it. Not used for the Bunsen stand — its click
 * handling has its own ring-proximity check that must run regardless of
 * where on the stand the press landed (see `BunsenStandWorkbenchDisplay`'s
 * own `handlePointerDown` doc). A plain module boolean, not store state: it
 * only ever needs to survive from one synchronous `pointerdown` to the very
 * next `click`, never triggers or needs a React re-render.
 */
let pickableWasPressed = false;
export function markPickablePressed(): void {
  pickableWasPressed = true;
}
export function consumePickablePressed(): boolean {
  const was = pickableWasPressed;
  pickableWasPressed = false;
  return was;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __testTubeDragStore?: unknown }).__testTubeDragStore = useTestTubeDragStore;
  (window as unknown as { __sharedMouseNdc?: unknown }).__sharedMouseNdc = sharedMouseNdc;
}
