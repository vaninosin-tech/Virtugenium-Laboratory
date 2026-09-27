import { create } from "zustand";

/**
 * Dev-only sizing knobs for the three HUD navigation buttons (`InspectionControls`):
 * left/right chain chevrons + bottom back button. Button box size and triangle glyph
 * size are stored independently per button so resizing one never touches the other,
 * mirroring `useCameraCalibrationStore`'s localStorage persistence pattern (F9 panel
 * instead of F8).
 *
 * Also holds the (unrelated but F9-panel-hosted) reagent-inspection
 * ОСТАВИТЬ/ВЗЯТЬ button calibration and the inspected-bottle stage transform
 * calibration — see `InspectionButtonConfig`/`InspectionBottleConfig` below.
 */
export type NavButtonKey = "left" | "right" | "bottom";

export interface NavButtonConfig {
  buttonWidth: number;
  buttonHeight: number;
  triangleWidth: number;
  triangleHeight: number;
}

/**
 * buttonWidth/buttonHeight size the button body; triangleWidth/triangleHeight
 * independently size the split-triangle icon inside it (InspectionControls'
 * `SplitTriangleIcon` reads triangleWidth/triangleHeight directly — it is
 * NOT derived from the button box). Defaults below are the values that were
 * previously computed as ~0.7x the button box, kept as explicit numbers so
 * the icon looks the same out of the box while staying independently
 * adjustable via the F9 panel's "Triangle W/H" controls.
 */
const DEFAULTS: Record<NavButtonKey, NavButtonConfig> = {
  left: { buttonWidth: 110, buttonHeight: 190, triangleWidth: 77, triangleHeight: 133 },
  right: { buttonWidth: 110, buttonHeight: 190, triangleWidth: 77, triangleHeight: 133 },
  bottom: { buttonWidth: 280, buttonHeight: 90, triangleWidth: 140, triangleHeight: 54 },
};

/** How far LEFT/RIGHT sit from the horizontal center (`left`/`right` CSS, px) — matches the original hardcoded `130px`. Shared by both sides so they can only ever move mirror-symmetrically; there is deliberately no per-side override. */
const DEFAULT_SIDE_DISTANCE = 130;

/** ОСТАВИТЬ (left)/ВЗЯТЬ (right) reagent-inspection buttons — `ReagentInspectionOverlay` reads this directly instead of hardcoded CSS. */
export type InspectionButtonSide = "left" | "right";

export interface InspectionButtonConfig {
  width: number;
  height: number;
  /** px offset from the viewport's horizontal center — negative moves left, positive moves right; each button is independently centered on its own offset (`left: calc(50% + offsetX px)`), not laid out as a flex pair. */
  offsetX: number;
  /** Vertical position as a percent of viewport height (top edge of the button). */
  top: number;
  /** Label font size in px — independent of width/height, so bumping text size never resizes the button box. */
  fontSize: number;
}

const INSPECTION_BUTTON_DEFAULTS: Record<InspectionButtonSide, InspectionButtonConfig> = {
  left: { width: 300, height: 84, offsetX: -180, top: 76, fontSize: 20 },
  right: { width: 300, height: 84, offsetX: 180, top: 76, fontSize: 20 },
};

/**
 * The inspected reagent's stage transform — camera-RELATIVE (not a fixed
 * world position, since inspection can happen in front of any cabinet's own
 * camera pose): X/Y are offsets along the camera's own right/up axes, Z is
 * the forward distance. `ReagentContainerInstance` reads this directly
 * instead of a hardcoded distance/vertical-offset/per-containerType scale
 * table, so a dev can lock in one "stable inspection framing" that every
 * reagent (any cabinet, any container type) reuses verbatim.
 */
export interface InspectionBottleConfig {
  x: number;
  y: number;
  z: number;
  scale: number;
}

const INSPECTION_BOTTLE_DEFAULTS: InspectionBottleConfig = { x: 0, y: -0.09, z: 0.85, scale: 2 };

/**
 * The HELD lab tray's camera-relative transform (`LabTrayInstance` reads
 * this directly while an eligible cabinet is focused — see
 * `isTrayHeldEligible` in `layout.ts`). X/Y are offsets along the camera's
 * own right/up axes, Z is the forward distance, same convention as
 * `InspectionBottleConfig`. `rotX/Y/Z` are the user's local rotation offsets
 * from the focused cabinet's yaw. With all three at zero the tray is level
 * and parallel to the cabinet. This never
 * touches the approved WORKBENCH placement (`TRAY_POSITION`/`TRAY_ROTATION_Y`
 * in `layout.ts`) — that stays the sole authority for the "workbench" visual
 * state.
 */
export interface HeldTrayConfig {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  /** WORLD scale of a reagent sitting on the tray — independent of the tray model's own `scale` above (and of the workbench's own reagent-area scale, which defaults to 1 — true size). Read live every frame by both `LabTrayInstance` (rendering already-taken items) and `ReagentContainerInstance` (the take-flight itself), so a change here applies instantly to reagents already on the tray, not just future ones. */
  reagentScale: number;
}

const HELD_TRAY_DEFAULTS: HeldTrayConfig = {
  x: 0.2,
  y: -0.22,
  z: 0.75,
  scale: 0.85,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  // Was 0.4 — noticeably smaller than the bottle's own true size (the
  // workbench reagent area renders the same jars at scale 1) and than how
  // it looks resting on the shelf before being taken, so it read as
  // shrunken/"not normal" on the tray. Raised to 1 to match.
  reagentScale: 1,
};

const STORAGE_KEY = "vg-nav-button-calibration";

interface PersistedShape {
  values: Record<NavButtonKey, NavButtonConfig>;
  sideDistance: number;
  inspectionButtons: Record<InspectionButtonSide, InspectionButtonConfig>;
  inspectionBottle: InspectionBottleConfig;
  heldTray: HeldTrayConfig;
}

function loadSaved(): PersistedShape {
  const result: PersistedShape = {
    values: structuredClone(DEFAULTS),
    sideDistance: DEFAULT_SIDE_DISTANCE,
    inspectionButtons: structuredClone(INSPECTION_BUTTON_DEFAULTS),
    inspectionBottle: { ...INSPECTION_BOTTLE_DEFAULTS },
    heldTray: { ...HELD_TRAY_DEFAULTS },
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as
      | {
          values?: Partial<Record<NavButtonKey, Partial<NavButtonConfig>>>;
          sideDistance?: number;
          inspectionButtons?: Partial<Record<InspectionButtonSide, Partial<InspectionButtonConfig>>>;
          inspectionBottle?: Partial<InspectionBottleConfig>;
          heldTray?: Partial<HeldTrayConfig>;
        }
      | Partial<Record<NavButtonKey, Partial<NavButtonConfig>>>;
    // Back-compat: earlier saves stored the per-button record directly (no `values`/`sideDistance` wrapper).
    const savedValues = "values" in parsed ? parsed.values : (parsed as Partial<Record<NavButtonKey, Partial<NavButtonConfig>>>);
    (Object.keys(DEFAULTS) as NavButtonKey[]).forEach((key) => {
      result.values[key] = { ...DEFAULTS[key], ...savedValues?.[key] };
    });
    if ("sideDistance" in parsed && typeof parsed.sideDistance === "number") {
      result.sideDistance = parsed.sideDistance;
    }
    if ("inspectionButtons" in parsed && parsed.inspectionButtons) {
      (Object.keys(INSPECTION_BUTTON_DEFAULTS) as InspectionButtonSide[]).forEach((side) => {
        result.inspectionButtons[side] = { ...INSPECTION_BUTTON_DEFAULTS[side], ...parsed.inspectionButtons?.[side] };
      });
    }
    if ("inspectionBottle" in parsed && parsed.inspectionBottle) {
      result.inspectionBottle = { ...INSPECTION_BOTTLE_DEFAULTS, ...parsed.inspectionBottle };
    }
    if ("heldTray" in parsed && parsed.heldTray) {
      const savedHeldTray = { ...parsed.heldTray };
      // One-time migration: 0.4 was the OLD `reagentScale` default (a jar
      // sat noticeably smaller than its true size — see `HELD_TRAY_DEFAULTS`'
      // doc). A saved value exactly matching that old default almost
      // certainly just got auto-persisted along with everything else via
      // "SAVE ALL" at some point, not deliberately chosen by a dev — so
      // treat it as stale and let the new default (1) through instead of
      // silently re-shrinking every jar again after this fix.
      if (savedHeldTray.reagentScale === 0.4) {
        delete savedHeldTray.reagentScale;
      }
      result.heldTray = { ...HELD_TRAY_DEFAULTS, ...savedHeldTray };
    }
    return result;
  } catch {
    return result;
  }
}

interface NavButtonCalibrationState {
  isOpen: boolean;
  /** Open state for the standalone `TrayCalibrationPanel` (F10) — independent of `isOpen` (the F9 nav-button panel) so the two can be shown/hidden separately even though both edit fields on this same store. */
  isTrayPanelOpen: boolean;
  selected: NavButtonKey;
  values: Record<NavButtonKey, NavButtonConfig>;
  /** Shared LEFT/RIGHT distance from center — see DEFAULT_SIDE_DISTANCE. */
  sideDistance: number;
  inspectionButtons: Record<InspectionButtonSide, InspectionButtonConfig>;
  selectedInspectionButton: InspectionButtonSide;
  inspectionBottle: InspectionBottleConfig;
  heldTray: HeldTrayConfig;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  toggleTrayPanelOpen: () => void;
  setTrayPanelOpen: (open: boolean) => void;
  setSelected: (key: NavButtonKey) => void;
  setField: (key: NavButtonKey, field: keyof NavButtonConfig, value: number) => void;
  setSideDistance: (value: number) => void;
  setSelectedInspectionButton: (side: InspectionButtonSide) => void;
  setInspectionButtonField: (side: InspectionButtonSide, field: keyof InspectionButtonConfig, value: number) => void;
  resetCurrentInspectionButton: () => void;
  setInspectionBottleField: (field: keyof InspectionBottleConfig, value: number) => void;
  resetInspectionBottle: () => void;
  setHeldTrayField: (field: keyof HeldTrayConfig, value: number) => void;
  resetHeldTray: () => void;
  save: () => void;
  resetCurrent: () => void;
  resetAll: () => void;
}

export const useNavButtonCalibrationStore = create<NavButtonCalibrationState>((set, get) => {
  const loaded = loadSaved();
  return {
    isOpen: false,
    isTrayPanelOpen: false,
    selected: "left",
    values: loaded.values,
    sideDistance: loaded.sideDistance,
    inspectionButtons: loaded.inspectionButtons,
    selectedInspectionButton: "left",
    inspectionBottle: loaded.inspectionBottle,
    heldTray: loaded.heldTray,
    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
    setOpen: (open) => set({ isOpen: open }),
    toggleTrayPanelOpen: () => set((state) => ({ isTrayPanelOpen: !state.isTrayPanelOpen })),
    setTrayPanelOpen: (open) => set({ isTrayPanelOpen: open }),
    setSelected: (key) => set({ selected: key }),
    setField: (key, field, value) =>
      set((state) => ({
        values: { ...state.values, [key]: { ...state.values[key], [field]: value } },
      })),
    setSideDistance: (value) => set({ sideDistance: value }),
    setSelectedInspectionButton: (side) => set({ selectedInspectionButton: side }),
    setInspectionButtonField: (side, field, value) =>
      set((state) => ({
        inspectionButtons: {
          ...state.inspectionButtons,
          [side]: { ...state.inspectionButtons[side], [field]: value },
        },
      })),
    resetCurrentInspectionButton: () =>
      set((state) => ({
        inspectionButtons: {
          ...state.inspectionButtons,
          [state.selectedInspectionButton]: { ...INSPECTION_BUTTON_DEFAULTS[state.selectedInspectionButton] },
        },
      })),
    setInspectionBottleField: (field, value) =>
      set((state) => ({ inspectionBottle: { ...state.inspectionBottle, [field]: value } })),
    resetInspectionBottle: () => set({ inspectionBottle: { ...INSPECTION_BOTTLE_DEFAULTS } }),
    setHeldTrayField: (field, value) => set((state) => ({ heldTray: { ...state.heldTray, [field]: value } })),
    resetHeldTray: () => set({ heldTray: { ...HELD_TRAY_DEFAULTS } }),
    save: () => {
      try {
        const state = get();
        const payload: PersistedShape = {
          values: state.values,
          sideDistance: state.sideDistance,
          inspectionButtons: state.inspectionButtons,
          inspectionBottle: state.inspectionBottle,
          heldTray: state.heldTray,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore write failures (private browsing / storage disabled)
      }
    },
    resetCurrent: () =>
      set((state) => ({
        values: { ...state.values, [state.selected]: { ...DEFAULTS[state.selected] } },
      })),
    resetAll: () =>
      set({
        values: structuredClone(DEFAULTS),
        sideDistance: DEFAULT_SIDE_DISTANCE,
        inspectionButtons: structuredClone(INSPECTION_BUTTON_DEFAULTS),
        inspectionBottle: { ...INSPECTION_BOTTLE_DEFAULTS },
        heldTray: { ...HELD_TRAY_DEFAULTS },
      }),
  };
});
