import { create } from "zustand";

interface ReagentInspectionState {
  /**
   * Stable per-instance id (e.g. `${cabinetId}-${reagentId}`) of the reagent
   * currently being inspected OR still flying back to its shelf, or null
   * once fully home. Only one at a time. Stays non-null for the ENTIRE
   * staged return animation (see `requestClose`/`finishClose` below) so the
   * background blur/tint doesn't cut out mid-flight.
   */
  inspectedId: string | null;
  /** True from the moment ОСТАВИТЬ/ESC is pressed until the staged return animation actually reaches the shelf — lets the UI (buttons) disappear immediately while the background blur stays up for the whole flight. */
  isClosing: boolean;
  /** True from the moment ВЗЯТЬ is pressed until the staged take animation actually reaches the held tray — same lifecycle role as `isClosing`, just for the take flight instead of the return flight. Mutually exclusive with `isClosing` in practice (the overlay hides both buttons once either fires). */
  isTaking: boolean;
  canShake: boolean;
  isShaking: boolean;
  /** Short interaction lock; releases before the long visual liquid-settle tail finishes. */
  isShakeLocked: boolean;
  /** Monotonic token used to restart motion when shaking is requested again during the settling tail. */
  shakeRequestId: number;
  setCanShake: (id: string, enabled: boolean) => void;
  requestShake: () => void;
  releaseShakeLock: () => void;
  finishShake: () => void;
  /** WORLD-space stage position/orientation computed once at open time (camera position + a fixed forward offset) — stays fixed for the duration since the gameplay camera doesn't move while inspecting. */
  stagePosition: readonly [number, number, number];
  stageQuaternion: readonly [number, number, number, number];
  /** Uniform scale applied only while at the stage (never touches the shelf-stored scale) — computed per-open from the actual container's bounding-box height so every container type reads at the same on-screen size. */
  stageScale: number;
  /** Which take-capacity/store the ВЗЯТЬ button should check and call — reagents (default) go through `useReagentStorageStore`'s 4-slot tray; glassware (test tubes) has its own separate 6-slot tray container (`useTestTubeStorageStore`), since it isn't a `ReagentId` and never runs out on the shelf. `"holder"` is a fixed workbench prop (e.g. the test tube rack itself) that can only be examined and put back — there is nothing to take, so `ReagentInspectionOverlay` hides the ВЗЯТЬ button entirely for it. Set once per `open()`. */
  kind: "reagent" | "test-tube" | "holder";
  open: (
    id: string,
    stagePosition: readonly [number, number, number],
    stageQuaternion: readonly [number, number, number, number],
    stageScale: number,
    kind?: "reagent" | "test-tube" | "holder",
  ) => void;
  /** ОСТАВИТЬ/ESC: signals the staged return should start. Does NOT clear `inspectedId` yet — see `finishClose`. */
  requestClose: () => void;
  /** Called by the inspected instance itself once its staged return animation actually settles back onto the shelf. */
  finishClose: () => void;
  /** ВЗЯТЬ: signals the staged take-to-tray flight should start. Does NOT clear `inspectedId` yet — see `finishTake`. */
  requestTake: () => void;
  /** Called by the inspected instance itself once its staged take animation actually reaches the held tray. */
  finishTake: () => void;
}

/**
 * Dev/gameplay-shared state for the reagent bottle inspection feature
 * (`ReagentContainerInstance` reads `inspectedId`/`isClosing` to know which
 * phase of its animation to run; `CameraRig` reads `inspectedId` to disable
 * mouse-look; `Laboratory`/`ReagentInspectionOverlay` read both to show the
 * blur/tint + ОСТАВИТЬ/ВЗЯТЬ UI). No persistence — this is pure runtime UI
 * state, unlike the F8/F9 calibration stores.
 */
export const useReagentInspectionStore = create<ReagentInspectionState>((set) => ({
  inspectedId: null,
  isClosing: false,
  isTaking: false,
  canShake: false,
  isShaking: false,
  isShakeLocked: false,
  shakeRequestId: 0,
  setCanShake: (id, enabled) => set((state) => state.inspectedId === id && state.canShake !== enabled ? { canShake: enabled } : state),
  requestShake: () => set((state) => state.inspectedId && state.canShake && !state.isShakeLocked && !state.isClosing && !state.isTaking
    ? { isShaking: true, isShakeLocked: true, shakeRequestId: state.shakeRequestId + 1 } : state),
  releaseShakeLock: () => set((state) => state.isShakeLocked ? { isShakeLocked: false } : state),
  finishShake: () => set({ isShaking: false, isShakeLocked: false }),
  stagePosition: [0, 0, 0],
  stageQuaternion: [0, 0, 0, 1],
  stageScale: 1,
  kind: "reagent",
  open: (id, stagePosition, stageQuaternion, stageScale, kind = "reagent") =>
    set({ inspectedId: id, isClosing: false, isTaking: false, canShake: false, isShaking: false, isShakeLocked: false, shakeRequestId: 0, stagePosition, stageQuaternion, stageScale, kind }),
  requestClose: () => set((state) => state.isShakeLocked ? state : { isClosing: true, canShake: false }),
  finishClose: () => set({ inspectedId: null, isClosing: false, canShake: false, isShaking: false, isShakeLocked: false }),
  requestTake: () => set((state) => state.isShakeLocked ? state : { isTaking: true, canShake: false }),
  finishTake: () => set({ inspectedId: null, isTaking: false, canShake: false, isShaking: false, isShakeLocked: false }),
}));

if (import.meta.env.DEV) {
  (window as unknown as { __inspectionStore?: unknown }).__inspectionStore = useReagentInspectionStore;
}
