import { create } from "zustand";

import type { Position3 } from "./layout";

/** Dev-tunable placement for the workbench "taken reagents" display area — see `WorkbenchReagentAreaCalibrationPanel` (F12). Origin is added to `LAYOUT.table.position`, same convention `TRAY_POSITION`/the stopper holder use. */
export interface WorkbenchReagentAreaConfig {
  originX: number;
  originY: number;
  originZ: number;
  spacingX: number;
  spacingZ: number;
  scale: number;
  rotationY: number;
  maxDisplaySlots: number;
}

/** Center of the free countertop: tray right edge -0.7065, rack left edge 0.27505.
 * Each occupied row grows symmetrically around their midpoint. */
const DEFAULTS: WorkbenchReagentAreaConfig = {
  originX: (-0.7065 + 0.27505) / 2,
  originY: 0.9,
  originZ: -0.218,
  spacingX: 0.113,
  spacingZ: 0.16,
  scale: 1,
  // Faces each container's label toward the table-view camera — same
  // Math.PI convention every shelf reagent already uses for the same
  // reason (see `ReagentCabinetInstance.tsx`'s own `rotationY={Math.PI}`);
  // the container's own authored default (0) faces its label away from a
  // viewer. This field doubles as the ROW's own spatial rotation (see
  // `computeWorkbenchReagentSlotOffsets`) — for a single straight row
  // (`localZ` always 0), a 180° turn just mirrors left/right ordering
  // around the same center, so it doesn't reopen the holder-clearance math
  // above.
  rotationY: Math.PI,
  maxDisplaySlots: 8,
};

/** Slots wrap to a new row after this many columns — matches the default `maxDisplaySlots` (8) so a full table forms exactly one row, not a shorter grid. */
const ROW_LENGTH = 8;

const STORAGE_KEY = "vg-workbench-reagent-area";

function loadSaved(): WorkbenchReagentAreaConfig {
  const result = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Partial<WorkbenchReagentAreaConfig>;
    if (parsed.originX === 0.13) delete parsed.originX;
    if (parsed.originY === 0.9175) delete parsed.originY;
    return { ...result, ...parsed };
  } catch {
    return result;
  }
}

interface WorkbenchReagentAreaState {
  isOpen: boolean;
  config: WorkbenchReagentAreaConfig;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setField: (field: keyof WorkbenchReagentAreaConfig, value: number) => void;
  save: () => void;
  resetAll: () => void;
}

export const useWorkbenchReagentAreaStore = create<WorkbenchReagentAreaState>((set, get) => ({
  isOpen: false,
  config: loadSaved(),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
  setField: (field, value) => set((state) => ({ config: { ...state.config, [field]: value } })),
  save: () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get().config));
    } catch {
      // ignore write failures (private browsing / storage disabled)
    }
  },
  resetAll: () => set({ config: { ...DEFAULTS } }),
}));

/** Local (table-relative) offsets for `count` slots — a regular `ROW_LENGTH`-wide grid, centered on X per row, rotated by `config.rotationY` around the origin. */
export function computeWorkbenchReagentSlotOffsets(config: WorkbenchReagentAreaConfig, count: number): Position3[] {
  const cos = Math.cos(config.rotationY);
  const sin = Math.sin(config.rotationY);
  const offsets: Position3[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / ROW_LENGTH);
    const col = i % ROW_LENGTH;
    const rowCount = Math.min(ROW_LENGTH, count - row * ROW_LENGTH);
    const localX = (col - (rowCount - 1) / 2) * config.spacingX;
    const localZ = row * config.spacingZ;
    const rotatedX = localX * cos - localZ * sin;
    const rotatedZ = localX * sin + localZ * cos;
    offsets.push([config.originX + rotatedX, config.originY, config.originZ + rotatedZ]);
  }
  return offsets;
}
