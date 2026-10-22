import { create } from "zustand";

/**
 * The rectangles a held item stays inside (VL-018, VL-019): the table's
 * countertop, the tray on it, the fume hood's worktop and the tray standing
 * there. Each is in its own object's space (X/Z) — the workbench, the
 * table's tray, the fume hood, the tray at the hood — so it moves and turns
 * with it. Tuned in F8 → «Границы» (`WorktopZonePanel`).
 *
 * A place is its worktop together with its tray: an item may go anywhere
 * over either (`constrainOnWorktop`), never past both.
 */
export type WorktopZoneId = "table" | "table-tray" | "fume-hood" | "hood-tray";

export interface ZoneRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const WORKTOP_ZONE_IDS: readonly WorktopZoneId[] = ["table", "table-tray", "fume-hood", "hood-tray"];

export const WORKTOP_ZONE_LABELS: Record<WorktopZoneId, string> = {
  table: "Стол",
  "table-tray": "Поднос на столе",
  "fume-hood": "Стол вытяжного шкафа",
  "hood-tray": "Поднос в вытяжном шкафу",
};

/** Which place a zone belongs to: an item taken at a place stays over that place's zones. */
export const WORKTOP_ZONE_PLACE: Record<WorktopZoneId, "table" | "hood"> = {
  table: "table",
  "table-tray": "table",
  "fume-hood": "hood",
  "hood-tray": "hood",
};

/** The tray's own body (`LabTray_Metal`): X −0.316..0.5 (rack end to jar end), Z ±0.2. */
const TRAY_RECT: ZoneRect = { minX: -0.316, maxX: 0.5, minZ: -0.2, maxZ: 0.2 };

export const WORKTOP_ZONE_DEFAULTS: Record<WorktopZoneId, ZoneRect> = {
  // `Countertop`, X −1.25..1.25, Z −0.85..0.
  table: { minX: -1.25, maxX: 1.25, minZ: -0.85, maxZ: 0 },
  "table-tray": TRAY_RECT,
  // Between the hood's side walls, from the rear baffle to the sash.
  "fume-hood": { minX: -0.664, maxX: 0.666, minZ: -0.255, maxZ: 0.325 },
  "hood-tray": TRAY_RECT,
};

const STORAGE_KEY = "vg-worktop-zones";
/** Bumped when the defaults change for a geometry reason — a stale saved set is dropped. */
const CONFIG_VERSION = 1;

function loadSaved(): Record<WorktopZoneId, ZoneRect> {
  const result = { ...WORKTOP_ZONE_DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as { version?: number; zones?: Partial<Record<WorktopZoneId, ZoneRect>> };
    if (parsed.version !== CONFIG_VERSION || !parsed.zones) return result;
    for (const id of WORKTOP_ZONE_IDS) {
      const zone = parsed.zones[id];
      if (zone && [zone.minX, zone.maxX, zone.minZ, zone.maxZ].every(Number.isFinite)) result[id] = zone;
    }
    return result;
  } catch {
    return result;
  }
}

interface WorktopZoneState {
  readonly isOpen: boolean;
  readonly selected: WorktopZoneId;
  readonly zones: Record<WorktopZoneId, ZoneRect>;
  setOpen: (open: boolean) => void;
  select: (id: WorktopZoneId) => void;
  setZone: (id: WorktopZoneId, rect: ZoneRect) => void;
  reset: (id: WorktopZoneId) => void;
  save: () => void;
}

export const useWorktopZoneStore = create<WorktopZoneState>((set, get) => ({
  isOpen: false,
  selected: "table",
  zones: loadSaved(),
  setOpen: (isOpen) => set({ isOpen }),
  select: (selected) => set({ selected }),
  setZone: (id, rect) => set((state) => ({ zones: { ...state.zones, [id]: rect } })),
  reset: (id) => set((state) => ({ zones: { ...state.zones, [id]: WORKTOP_ZONE_DEFAULTS[id] } })),
  save: () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: CONFIG_VERSION, zones: get().zones }));
    } catch {
      // ignore write failures (private browsing / storage disabled)
    }
  },
}));

/** The rectangle as center and size — how the panel edits it. */
export const rectToCenterSize = (rect: ZoneRect) => ({
  centerX: (rect.minX + rect.maxX) / 2,
  centerZ: (rect.minZ + rect.maxZ) / 2,
  width: rect.maxX - rect.minX,
  depth: rect.maxZ - rect.minZ,
});

export const centerSizeToRect = ({ centerX, centerZ, width, depth }: ReturnType<typeof rectToCenterSize>): ZoneRect => {
  const w = Math.max(0.01, width) / 2;
  const d = Math.max(0.01, depth) / 2;
  return { minX: centerX - w, maxX: centerX + w, minZ: centerZ - d, maxZ: centerZ + d };
};
