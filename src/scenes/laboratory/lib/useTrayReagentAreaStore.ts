import { create } from "zustand";

import type { Position3 } from "./layout";

/** Fixed slot count — always 8 physical positions on the tray, regardless of calibration (see `TRAY_CAPACITY` in `useReagentStorageStore`). */
export const TRAY_REAGENT_COLS = 4;
export const TRAY_REAGENT_ROWS = 2;

/**
 * Dev-tunable layout for the 8 reagent slots on the HELD tray — see
 * `TrayReagentAreaCalibrationPanel` (F8 → "Реагенты на подносе"). Local to
 * `LabTrayInstance`'s own animated group, same convention the stopper
 * holder's offset uses.
 *
 * ONE plain, evenly-spaced 4x2 grid. Briefly dropped to 3x2/6 for more
 * per-jar spacing (4 columns left no room to grow the gap without either
 * shrinking the rack/rim margin toward zero or making the tray longer than
 * the workbench countertop's own 0.85m depth — physically checked against
 * `Countertop` in `LaboratoryWorkbench_MASTER.blend`), then reverted back
 * to 4x2/8 on the player's own call, keeping the tighter (but still safe)
 * spacing that fits within it.
 *
 * `originX` is the grid's center along the tray's depth axis — the real
 * equidistant midpoint between the rack's right edge (-0.13612, measured
 * off the glued `LabTray_Metal.blend`) and `Tray_Body`'s own jar-side edge
 * (+0.5, after 4 stretches from its original ±0.3162 — see git history for
 * the individual +60/+40/+50/+18.75mm passes). This midpoint is
 * independent of column count or spacing, so it hasn't needed to move
 * across any of these passes.
 *
 * `spacingX`/`spacingZ` are sized against the WIDEST real container — the
 * copper-sulfate jar, `ReagentJar_WideMouth_120ml`, 0.11 m diameter (off
 * `ReagentContainers_MASTER.blend`; bottles are only 0.076 m, so this is
 * the worst case). CRITICAL: margins are sized against the tray HELD near
 * the camera (`heldTray.scale`, currently 0.85), not the tray at rest — a
 * jar's WORLD size is compensated to stay constant regardless of the
 * tray's own scale, but its POSITION shrinks with it, so a REST-scale gap
 * that looks fine can read as touching once held. Local (rest-scale)
 * target = desired world clearance / 0.85.
 *
 * At 4 columns, `spacingX` = 0.165 is close to the real ceiling for this
 * axis (~23mm rack/rim margin at the outer columns; going much higher
 * either overhangs the countertop or squeezes that margin toward zero) —
 * held-scale clearance between adjacent jars in a row is 0.165*0.85 - 0.11
 * = 30mm. `spacingZ` (the WIDTH axis, front row vs. back row — only ever
 * needs one gap for 2 rows and has slack to spare) was 0.28 (128mm held
 * clearance) but read as the two rows floating too far apart, pulled back
 * to 0.17 (34.5mm held clearance) on the player's call — still comfortably
 * more than `spacingX`'s own 30mm, just no longer an outlier next to it.
 */
export interface TrayReagentAreaConfig {
  originX: number;
  originY: number;
  originZ: number;
  spacingX: number;
  spacingZ: number;
  rotationY: number;
}

const DEFAULTS: TrayReagentAreaConfig = {
  originX: 0.182,
  // Exact inner-floor height, measured by downward raycasts at all eight
  // slot centers. 0.02875 is the raised rim and made the jars float.
  originY: 0.004025,
  originZ: 0,
  spacingX: 0.165,
  spacingZ: 0.17,
  rotationY: 0,
};

const STORAGE_KEY = "vg-tray-reagent-area";

/**
 * Bumped every time `DEFAULTS` changes for a real geometry reason (not a
 * dev's own deliberate F8 tweak) — the tray's own physical size changed
 * (60 mm longer on the jar side) since the last several defaults, and
 * chasing every old saved value one exact-number-at-a-time (`0.09`, `0.10`,
 * `0.111`, `0.115`, ...) was fragile and kept missing whichever stale value
 * a given browser actually had. A version mismatch now discards the WHOLE
 * saved config and falls back to fresh `DEFAULTS`, rather than trying to
 * merge individual fields — simpler and can't miss a stale value this
 * doesn't know the exact number of.
 */
const CONFIG_VERSION = 12;

function loadSaved(): TrayReagentAreaConfig {
  const result = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Partial<TrayReagentAreaConfig> & { version?: number };
    if (parsed.version !== CONFIG_VERSION) {
      return result;
    }
    return { ...result, ...parsed };
  } catch {
    return result;
  }
}

interface TrayReagentAreaState {
  isOpen: boolean;
  config: TrayReagentAreaConfig;
  setOpen: (open: boolean) => void;
  setField: (field: keyof TrayReagentAreaConfig, value: number) => void;
  save: () => void;
  resetAll: () => void;
}

export const useTrayReagentAreaStore = create<TrayReagentAreaState>((set, get) => ({
  isOpen: false,
  config: loadSaved(),
  setOpen: (isOpen) => set({ isOpen }),
  setField: (field, value) => set((state) => ({ config: { ...state.config, [field]: value } })),
  save: () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...get().config, version: CONFIG_VERSION }));
    } catch {
      // ignore write failures (private browsing / storage disabled)
    }
  },
  resetAll: () => set({ config: { ...DEFAULTS } }),
}));

/**
 * Where a jar sits given its own STABLE `slotIndex` (see that field's doc
 * in `useReagentStorageStore` — NOT its position in the `trayItems` array)
 * — a plain 4-column x 2-row grid, `col = slotIndex % TRAY_REAGENT_COLS`,
 * `row = floor(slotIndex / TRAY_REAGENT_COLS)`, centered on
 * `config.originX`/`originZ` (that center itself sits at the midpoint
 * between the rack's real edge and the tray's own edge, equidistant from
 * both — see the config's doc). A dynamically re-centering layout (jars
 * shifting to stay centered as the count changes) was tried and reverted —
 * it made a jar's row/column jump unpredictably whenever some unrelated jar
 * elsewhere in the list was returned, which read as the whole arrangement
 * "breaking". `rotationY` rigidly rotates the whole grid around the tray's
 * own center afterward, for fine visual alignment — same convention
 * `computeWorkbenchReagentSlotOffsets`'s grid rotation uses.
 */
export function computeTrayReagentPosition(
  config: TrayReagentAreaConfig,
  slotIndex: number,
): Position3 {
  const normalizedIndex = Number.isFinite(slotIndex) ? Math.floor(slotIndex) : 0;
  const safeIndex = Math.max(0, Math.min(TRAY_REAGENT_COLS * TRAY_REAGENT_ROWS - 1, normalizedIndex));
  const row = Math.floor(safeIndex / TRAY_REAGENT_COLS);
  const col = safeIndex % TRAY_REAGENT_COLS;
  const localX = config.originX + (col - (TRAY_REAGENT_COLS - 1) / 2) * config.spacingX;
  const localZ = config.originZ + (row - (TRAY_REAGENT_ROWS - 1) / 2) * config.spacingZ;
  const cos = Math.cos(config.rotationY);
  const sin = Math.sin(config.rotationY);
  const rotatedX = localX * cos - localZ * sin;
  const rotatedZ = localX * sin + localZ * cos;
  return [rotatedX, config.originY, rotatedZ];
}

/** Non-reactive lookup for callers outside React render (e.g. `ReagentContainerInstance`'s takeMove flight-target calc, computed once at take-start). */
export function traySlotLocalPosition(slotIndex: number): Position3 {
  return computeTrayReagentPosition(useTrayReagentAreaStore.getState().config, slotIndex);
}

/**
 * The tray's grid is split in two zones (as the player sees it from the front):
 *
 *     00 11      0 — reagents: the two left columns (slots 0, 1, 4, 5)
 *     00 11      1 — lab equipment: the two right columns
 *
 * so bottles and the stand never stand in each other on the tray. The stand
 * takes three of the equipment cells, the spirit lamp the fourth.
 */
export const REAGENT_TRAY_SLOTS: readonly number[] = [0, 1, 4, 5];
/** Equipment cells, by slot index of the same grid: the lamp's, and the three the stand stands across. */
const LAMP_CELL = 3;
const STAND_CELLS = [2, 6, 7] as const;

/** Where the spirit lamp rests on the tray: its own cell (far row, right), on the inner floor. */
export function lampTrayRestPosition(config: TrayReagentAreaConfig = useTrayReagentAreaStore.getState().config): Position3 {
  return computeTrayReagentPosition(config, LAMP_CELL);
}

/**
 * Where the stand's base centre rests on the tray: the middle of its three
 * cells, on the inner floor. Its clamp arm points along +X — further right,
 * over its own cells, never over the bottles.
 *
 * @param baseBottomOffset how far below the stand's origin its base's bottom is
 */
export function standTrayRestPosition(
  baseBottomOffset: number,
  config: TrayReagentAreaConfig = useTrayReagentAreaStore.getState().config,
): Position3 {
  const cells = STAND_CELLS.map((cell) => computeTrayReagentPosition(config, cell));
  const mean = (axis: 0 | 2) => cells.reduce((sum, cell) => sum + cell[axis], 0) / cells.length;
  return [mean(0), config.originY + baseBottomOffset, mean(2)];
}
