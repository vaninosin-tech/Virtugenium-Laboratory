import { create } from "zustand";

import type { HotspotTargetId, SceneTargetId } from "./layout";

/**
 * Camera/interaction states for cabinet inspection — separate from the
 * cabinet's own logical OPEN/CLOSED state (`useCabinetOpenStore`), per the
 * "two independent state systems, not one conflated one" split:
 * - `room`: normal free-look, mouse-look active, `CameraRig`'s old
 *   activeTargetId-lerp behavior applies (covers overview + table too).
 * - `focusing`: camera flying in toward a clicked cabinet; mouse-look locked.
 * - `inspecting`: camera settled at the cabinet's inspection view; mouse-look
 *   locked; cabinet fully open.
 * - `returning`: camera flying back to the stored pre-focus transform;
 *   mouse-look locked; cabinet closing.
 */
export type CabinetPhase = "room" | "focusing" | "inspecting" | "returning";

interface SceneInteractionState {
  /** Whether the browser Pointer Lock is currently engaged on the canvas (mouse-look active). */
  readonly isPointerLocked: boolean;
  /** Which fixed viewpoint the camera is currently resting at / animating toward. */
  readonly activeTargetId: SceneTargetId;
  /** Which hotspot the crosshair is currently aimed at, if any (only computed in overview). */
  readonly hoveredTargetId: HotspotTargetId | null;
  /** Cabinet inspection camera phase — see `CabinetPhase`. */
  readonly cabinetPhase: CabinetPhase;
  /** Which cabinet is focused/being inspected, if any. */
  readonly focusedCabinetId: HotspotTargetId | null;
  /**
   * Set by any UI (Esc key, the "return" button) to ask `CameraRig` to
   * start the return-to-room flow; `CameraRig` consumes and clears it once
   * it picks the request up. Decouples "who can ask for return" (anywhere)
   * from "who actually owns the camera and runs the tween" (CameraRig only).
   */
  readonly returnRequested: boolean;
  /** True after the separate held tray has completed its fast return-to-table leg. */
  readonly trayReturnReady: boolean;
  /**
   * Set by the chain-arrow UI to ask `CameraRig` to fly directly from the
   * currently inspected cabinet to a chain neighbor (see
   * `getChainNeighbors`), skipping the room. Same consume-and-clear pattern
   * as `returnRequested`, kept as a separate field since the two requests
   * are mutually exclusive but independently meaningful (a switch only ever
   * makes sense while already `inspecting`, a return can also apply while
   * `focusing`).
   */
  readonly switchRequestedId: HotspotTargetId | null;
  /**
   * Asks `CameraRig` to start a room -> zone approach for anyone who isn't
   * the clicked hotspot itself (currently the dev shortcut). Same
   * consume-and-clear decoupling as `returnRequested`: the flight has setup
   * that only `CameraRig` can do — the fume hood in particular runs a staged
   * sequence — so calling `beginCabinetFocus` from outside would leave the
   * phase set with no tween behind it.
   */
  readonly focusRequestedId: HotspotTargetId | null;
  /**
   * Fume-hood-only: true while the sash should be at its OPEN working
   * position — driven by `CameraRig`'s staged approach sequence (camera
   * pauses at a staging pose, sets this true, waits for the glass to
   * finish, then continues in), not by `cabinetPhase` directly, since the
   * sash now opens/closes mid-transition rather than exactly at focus/return.
   */
  readonly sashStageOpen: boolean;
  setPointerLocked: (locked: boolean) => void;
  setActiveTarget: (id: SceneTargetId) => void;
  setHoveredTarget: (id: HotspotTargetId | null) => void;
  beginCabinetFocus: (id: HotspotTargetId) => void;
  setCabinetPhase: (phase: CabinetPhase) => void;
  requestCabinetReturn: () => void;
  markTrayReturnReady: () => void;
  clearReturnRequest: () => void;
  requestCabinetSwitch: (id: HotspotTargetId) => void;
  clearSwitchRequest: () => void;
  requestFocus: (id: HotspotTargetId) => void;
  clearFocusRequest: () => void;
  finishCabinetReturn: () => void;
  setSashStageOpen: (open: boolean) => void;
}

/**
 * Ephemeral, render-only scene state (pointer lock, crosshair aim, cabinet
 * inspection phase). Kept separate from `useLaboratoryStore` — that store
 * models the domain session (mode, score, experiment progress) per the
 * entities layer, and has no business knowing about mouse-look plumbing.
 */
export const useSceneInteractionStore = create<SceneInteractionState>((set) => ({
  isPointerLocked: false,
  activeTargetId: "overview",
  hoveredTargetId: null,
  cabinetPhase: "room",
  focusedCabinetId: null,
  returnRequested: false,
  trayReturnReady: true,
  switchRequestedId: null,
  focusRequestedId: null,
  sashStageOpen: false,

  setPointerLocked: (isPointerLocked) => set({ isPointerLocked }),

  setActiveTarget: (activeTargetId) => set({ activeTargetId, hoveredTargetId: null }),

  setHoveredTarget: (hoveredTargetId) => set({ hoveredTargetId }),

  beginCabinetFocus: (id) =>
    set({
      activeTargetId: id,
      focusedCabinetId: id,
      cabinetPhase: "focusing",
      hoveredTargetId: null,
    }),

  setCabinetPhase: (cabinetPhase) => set({ cabinetPhase }),

  requestCabinetReturn: () => set({ returnRequested: true, trayReturnReady: false }),

  markTrayReturnReady: () => set({ trayReturnReady: true }),

  clearReturnRequest: () => set({ returnRequested: false }),

  requestCabinetSwitch: (id) => set({ switchRequestedId: id }),

  clearSwitchRequest: () => set({ switchRequestedId: null }),

  requestFocus: (focusRequestedId) => set({ focusRequestedId }),

  clearFocusRequest: () => set({ focusRequestedId: null }),

  finishCabinetReturn: () =>
    set({
      cabinetPhase: "room",
      focusedCabinetId: null,
      activeTargetId: "overview",
      returnRequested: false,
      trayReturnReady: true,
      switchRequestedId: null,
      focusRequestedId: null,
      sashStageOpen: false,
    }),

  setSashStageOpen: (sashStageOpen) => set({ sashStageOpen }),
}));

if (import.meta.env.DEV) {
  (window as unknown as { __sceneStore?: unknown }).__sceneStore = useSceneInteractionStore;
}
