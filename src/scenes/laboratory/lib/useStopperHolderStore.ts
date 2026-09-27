import { create } from "zustand";

/**
 * Dev-only placement for the workbench `LabTestTubeRackInstance` — a
 * WORLD-space-ish offset added to `LAYOUT.table.position` (same convention
 * `TRAY_POSITION` uses in `layout.ts`). Used to be two holders (`workbench`
 * and `tray`), but the tray one is gone: that rack got glued directly into
 * `LabTray_Metal.glb` at a fixed transform (see `TRAY_RACK_ANCHOR` in
 * `useTestTubeStorageStore.ts`), so it no longer needs — or tolerates —
 * live dev calibration. Keeping a persisted, overridable `tray` entry here
 * after that change was actively harmful: a stale localStorage value (e.g.
 * `rotY: 0`, saved back before the rack was rotated) would silently keep
 * overriding the current default and misplace every tube taken onto the
 * tray, with no visible sign anything was wrong in the code itself.
 */
export type StopperHolderKey = "workbench";

export interface StopperHolderConfig {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
}

/**
 * Camera-relative pose the workbench rack flies to while inspected (see
 * `WorkbenchTestTubeRackInstance`'s click-to-inspect flow) — X/Y are along
 * the camera's own right/up axes, Z is the forward distance, same convention
 * `InspectionBottleConfig` uses. `tiltX` is an EXTRA rotation applied about
 * the camera's own right axis on top of "face the camera" — a round bottle
 * can just keep its shelf orientation when lifted (it already faces the
 * camera by construction), but the rack rests flat with its 16 holes facing
 * straight up, so without this tilt the player would see it edge-on instead
 * of looking down into the tube openings.
 */
export interface HolderInspectionStageConfig {
  x: number;
  y: number;
  z: number;
  tiltX: number;
  scale: number;
}

const INSPECTION_STAGE_DEFAULTS: HolderInspectionStageConfig = {
  x: 0,
  y: 0.05,
  z: 0.85,
  tiltX: -0.45,
  scale: 1.5,
};

/**
 * World Y here = table top (0.9) exactly — verified by loading the real
 * `Countertop` (from `LaboratoryWorkbench_MASTER.blend`) and the real
 * `LabTestTubeRack` hierarchy into one Blender scene at their actual coded
 * transforms and measuring the gap directly. The old 0.9175 (= table top +
 * half the holder's OLD default height) assumed a center-pivoted rack; every
 * rebuild of the rack this session re-pivoted it to its feet (bottom ~0),
 * so that leftover "+half height" term was floating the rack ~17.5 mm above
 * the table the whole time — this is that fix. X moved from -0.55 (the
 * drawer side) toward the sink side, but NOT a plain mirror to +0.55 — that
 * overlapped the real `Sink_Outer` mesh (measured straight off
 * `LaboratoryWorkbench_MASTER.blend`: X 0.665..1.185) by ~70 mm, since the
 * rack's own real half-width is 0.1849 m (0.55+0.1849 = 0.7349, well past
 * 0.665). +0.43 keeps the rack's right edge (0.43+0.1849 = 0.6149) a clear
 * 50 mm short of the sink instead. (Cabinet fronts BELOW the countertop —
 * `CabinetBody_Drawers`/`CabinetBody_Wet`, X -1.25..-0.6 / 0.6..1.25 — don't
 * matter here despite overlapping in X: they sit at a different Z than
 * anything resting ON the counter, so there's no real collision, unlike the
 * sink basin which sits at counter height.) Z pulled back twice now — first
 * -0.55→-0.4, then -0.4→-0.25 — the table's depth (1.3 m, centered on
 * `LAYOUT.table.position.z`) put the original value only ~0.1 m from the
 * front edge, nearly overhanging it; -0.25 leaves ~0.4 m of clearance
 * instead. Scale matched to the tray holder (both 1) so the two rack
 * instances read as the same physical object.
 */
// Move the rack and its tubes 3 cm toward the sink; retain 2 cm clearance.
const WORKBENCH_DEFAULTS: StopperHolderConfig = { x: 0.46, y: 0.9, z: -0.25, rotX: 0, rotY: 0, rotZ: 0, scale: 1 };

const STORAGE_KEY = "vg-stopper-holder-calibration";

interface PersistedShape {
  holders: Record<StopperHolderKey, StopperHolderConfig>;
  inspectionStage: HolderInspectionStageConfig;
}

function loadSaved(): PersistedShape {
  const result: PersistedShape = {
    holders: { workbench: { ...WORKBENCH_DEFAULTS } },
    inspectionStage: { ...INSPECTION_STAGE_DEFAULTS },
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as {
      holders?: Partial<Record<StopperHolderKey, Partial<StopperHolderConfig>>>;
      inspectionStage?: Partial<HolderInspectionStageConfig>;
    };
    if (parsed.holders?.workbench) {
      const savedWorkbench = { ...parsed.holders.workbench };
      // Two stale X defaults to migrate past: -0.55 (the original drawer
      // side) and +0.55 (the sink-mirror position that turned out to clip
      // ~70mm into the real sink mesh — see the doc above). Either exact
      // match is almost certainly a stale auto-persisted default, not a
      // deliberate F11 tweak, so let the current default (+0.43) through.
      if (savedWorkbench.x === -0.55 || savedWorkbench.x === 0.55 || savedWorkbench.x === 0.43) {
        delete savedWorkbench.x;
      }
      result.holders.workbench = { ...WORKBENCH_DEFAULTS, ...savedWorkbench };
    }
    if (parsed.inspectionStage) {
      result.inspectionStage = { ...INSPECTION_STAGE_DEFAULTS, ...parsed.inspectionStage };
    }
    return result;
  } catch {
    return result;
  }
}

interface StopperHolderState {
  isOpen: boolean;
  selected: StopperHolderKey;
  holders: Record<StopperHolderKey, StopperHolderConfig>;
  inspectionStage: HolderInspectionStageConfig;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setSelected: (key: StopperHolderKey) => void;
  setField: (key: StopperHolderKey, field: keyof StopperHolderConfig, value: number) => void;
  setInspectionStageField: (field: keyof HolderInspectionStageConfig, value: number) => void;
  save: () => void;
  resetCurrent: () => void;
  resetInspectionStage: () => void;
  resetAll: () => void;
}

export const useStopperHolderStore = create<StopperHolderState>((set, get) => {
  const loaded = loadSaved();
  return {
    isOpen: false,
    selected: "workbench",
    holders: loaded.holders,
    inspectionStage: loaded.inspectionStage,
    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
    setOpen: (open) => set({ isOpen: open }),
    setSelected: (selected) => set({ selected }),
    setField: (key, field, value) =>
      set((state) => ({
        holders: { ...state.holders, [key]: { ...state.holders[key], [field]: value } },
      })),
    setInspectionStageField: (field, value) =>
      set((state) => ({ inspectionStage: { ...state.inspectionStage, [field]: value } })),
    save: () => {
      try {
        const state = get();
        const payload: PersistedShape = { holders: state.holders, inspectionStage: state.inspectionStage };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore write failures (private browsing / storage disabled)
      }
    },
    resetCurrent: () =>
      set((state) => ({
        holders: { ...state.holders, [state.selected]: { ...WORKBENCH_DEFAULTS } },
      })),
    resetInspectionStage: () => set({ inspectionStage: { ...INSPECTION_STAGE_DEFAULTS } }),
    resetAll: () =>
      set({
        holders: { workbench: { ...WORKBENCH_DEFAULTS } },
        inspectionStage: { ...INSPECTION_STAGE_DEFAULTS },
      }),
  };
});
