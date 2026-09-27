import { create } from "zustand";

import { CABINETS, EQUIPMENT, LAYOUT, type HotspotTargetId, type Position3 } from "./layout";

/** Every furniture piece the F8 dev menu can reposition — the six cabinets, the two equipment pieces, and the workbench/table. Deliberately excludes the room itself. */
export type FurnitureId = HotspotTargetId;

export interface FurnitureOverride {
  position: Position3;
  /** `null` for `table`, which has no authored rotation in `layout.ts`. */
  rotationY: number | null;
}

const STORAGE_KEY = "vg-furniture-position-overrides";

/**
 * Computed once at module load, not per call: `getOverride` returns this
 * object by reference when there's no saved override, and a selector must
 * return a *stable* reference across calls with no change — a fresh object
 * literal built on every `staticDefault()` call looks like a changed value
 * to `useSyncExternalStore` (what Zustand's hook uses internally) and
 * re-triggers a render every time, which cascades into "Maximum update
 * depth exceeded".
 */
const STATIC_DEFAULTS: Record<FurnitureId, FurnitureOverride> = {
  table: { position: LAYOUT.table.position, rotationY: null },
  ...Object.fromEntries(CABINETS.map((c) => [c.id, { position: c.position, rotationY: c.rotationY }])),
  ...Object.fromEntries(EQUIPMENT.map((e) => [e.id, { position: e.position, rotationY: e.rotationY }])),
} as Record<FurnitureId, FurnitureOverride>;

function staticDefault(id: FurnitureId): FurnitureOverride {
  return STATIC_DEFAULTS[id];
}

export const FURNITURE_LABELS: Record<FurnitureId, string> = Object.fromEntries([
  ["table", "Верстак / Workbench"],
  ...CABINETS.map((c) => [c.id, `Шкаф — ${c.label}`]),
  ...EQUIPMENT.map((e) => [e.id, e.label]),
]) as Record<FurnitureId, string>;

export const FURNITURE_IDS: readonly FurnitureId[] = [
  "table",
  ...CABINETS.map((c) => c.id),
  ...EQUIPMENT.map((e) => e.id),
];

function loadOverrides(): Partial<Record<FurnitureId, FurnitureOverride>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<FurnitureId, FurnitureOverride>>;
  } catch {
    return {};
  }
}

function persistOverrides(overrides: Partial<Record<FurnitureId, FurnitureOverride>>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Best-effort — overrides still work in-memory for this session.
  }
}

interface FurniturePositionState {
  readonly overrides: Partial<Record<FurnitureId, FurnitureOverride>>;
  /** Live-edited position/rotation for `id` — the saved override if present, else the `layout.ts` default. */
  getOverride: (id: FurnitureId) => FurnitureOverride;
  setPosition: (id: FurnitureId, position: Position3) => void;
  setPositionAxis: (id: FurnitureId, axis: 0 | 1 | 2, value: number) => void;
  setRotationY: (id: FurnitureId, rotationY: number) => void;
  reset: (id: FurnitureId) => void;
  resetAll: () => void;
  save: () => void;
}

export const useFurniturePositionStore = create<FurniturePositionState>((set, get) => ({
  overrides: loadOverrides(),

  getOverride: (id) => get().overrides[id] ?? staticDefault(id),

  setPosition: (id, position) =>
    set((state) => {
      const current = state.overrides[id] ?? staticDefault(id);
      return { overrides: { ...state.overrides, [id]: { ...current, position } } };
    }),

  setPositionAxis: (id, axis, value) =>
    set((state) => {
      const current = state.overrides[id] ?? staticDefault(id);
      const position: [number, number, number] = [...current.position];
      position[axis] = value;
      return { overrides: { ...state.overrides, [id]: { ...current, position } } };
    }),

  setRotationY: (id, rotationY) =>
    set((state) => {
      const current = state.overrides[id] ?? staticDefault(id);
      return { overrides: { ...state.overrides, [id]: { ...current, rotationY } } };
    }),

  reset: (id) =>
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[id];
      return { overrides };
    }),

  resetAll: () => set({ overrides: {} }),

  save: () => {
    persistOverrides(get().overrides);
  },
}));

/** Imperative read for use outside React (render components read via the hook instead; this is for one-off consumers). */
export function getFurniturePosition(id: FurnitureId): Position3 {
  return useFurniturePositionStore.getState().getOverride(id).position;
}
