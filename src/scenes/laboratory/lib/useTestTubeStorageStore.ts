import { create } from "zustand";

import type { Position3 } from "./layout";
import { clearTubeAmount } from "./tubeAmounts";
import { clearDeliveries } from "./tubeDelivery";
import { clearTubePourImpact } from "./tubePourImpact";

/** One test tube the player has taken from the glassware cabinet — plain glassware, so this only needs an id, PLUS an optional `reagentId` once it's been filled (see `setWorkbenchTubeContents`/`InspectableTestTubeSlot`'s hover-to-fill mechanic). Display size is NOT stored per-instance: unlike reagents (which use the dev-tunable `heldTray.reagentScale`/`WorkbenchReagentAreaConfig.scale`, since a bottle can sit anywhere), a tube must fit the rack's fixed holes, so it always renders at the RACK's own live scale (`TRAY_RACK_ANCHOR.scale` on the tray, `holders.workbench.scale` on the bench) — see `computeTubeSlotPosition`'s doc. */
export interface StoredTestTube {
  readonly instanceId: string;
  /**
   * What has been put into this tube, in the order it went in. The ORDER is
   * load-bearing, not incidental: «нарушен порядок смешивания» and «кислоту
   * льют в воду, а не наоборот» are both read straight off this array, so
   * nothing may reorder or de-duplicate it into a set.
   *
   * Never emptied — there is no "pour the tube out" action yet.
   */
  readonly contents: readonly string[];
}

/** Convenience for the common "does this tube hold X" question. */
export const tubeHolds = (tube: StoredTestTube | undefined, reagentId: string): boolean =>
  tube?.contents.includes(reagentId) ?? false;

/**
 * Dedicated container on the tray, separate from the 4-slot reagent
 * `TRAY_SLOTS` — glassware isn't a `ReagentId` and the shelf copy never
 * disappears (it's an infinite dispenser, not session-depleted stock), so it
 * gets its own capacity and store rather than sharing `useReagentStorageStore`.
 * 8 holes per row × 2 rows = 16, per the user's call for a proper 16-tube
 * rack (modeled in Blender as `LabTestTubeRack.glb`, see
 * `LabTestTubeRackInstance`) — replacing an earlier flat-box placeholder
 * that only fit 6.
 */
export const TUBE_SLOTS_PER_ROW = 8;
export const TEST_TUBE_TRAY_CAPACITY = TUBE_SLOTS_PER_ROW * 2;

/**
 * The same modeled rack sits in two places: `LabTestTubeRackInstance`
 * renders it at the workbench, positioned/rotated/scaled by the live
 * dev-tuned `useStopperHolderStore` config (`holders.workbench`); on the
 * tray it's glued directly into `LabTray_Metal.glb` at a fixed transform
 * (`TRAY_RACK_ANCHOR` below) instead, since a separately-rendered,
 * dev-calibrated instance there just invited localStorage drift between the
 * rack's actual (fixed) position and whatever a stale saved config claimed.
 * `computeTubeSlotPosition` takes either holder shape's x/y/z/rotY/scale and
 * returns where tube `index` sits in the rack's own hole grid — the offsets
 * below were read directly off the exported model's node positions (not
 * eyeballed), so they land exactly in each insert collar.
 */

/**
 * 8 hole X-positions across one row of the rack (glTF/Three.js local space,
 * rack root at its own origin) — spacing/centering read straight off the
 * rack model (0.034 apart, centered on 0). Ordered so slot index 0 (the
 * first tube taken) lands at the +0.119 end and filling proceeds toward
 * -0.119 — the player asked for tubes to fill from that end instead of the
 * other one.
 */
const TUBE_SLOT_X_OFFSETS: readonly number[] = [
  0.119, 0.085, 0.051, 0.017, -0.017, -0.051, -0.085, -0.119,
];

/** The 2 rows' Z-offsets (0.021/-0.021 apart, centered on 0). Back row (-0.021) is row 0, front (0.021) is row 1 — the other half of the "fill from the other side" flip, alongside the reversed `TUBE_SLOT_X_OFFSETS` above. */
const TUBE_SLOT_ROW_Z_OFFSETS: readonly number[] = [-0.021, 0.021];

/**
 * Row/col within the rack's 8-per-row × 2-row hole grid for tube `index` —
 * row 1 (the front row, and the one `ReagentInspectionOverlay`'s button grid
 * renders on TOP — see its own `gridRow` doc) fills completely, col 0..7,
 * before row 0 starts. Was an alternating "one hole in each row per index"
 * pattern; the player asked for the top row to fill first instead. Shared
 * by `computeTubeSlotPosition`/`computeTubeSlotLocalOffset` below and the
 * overlay's button grid so the 3D tubes and the 2D buttons always agree on
 * which physical hole a given `index` is.
 */
export function tubeSlotRowCol(index: number): { row: number; col: number } {
  return { row: index < TUBE_SLOTS_PER_ROW ? 1 : 0, col: index % TUBE_SLOTS_PER_ROW };
}

/** Y of the bottom rail's top surface (`Rack_BottomRail` sits at Y 0.011, thickness 0.006) — where a base-anchored `LabTestTubeInstance` should rest so it stands through both rails instead of floating or sinking into the bottom one. */
const TUBE_BASE_Y = 0.014;

/**
 * Fixed anchor for the rack now glued directly into `LabTray_Metal.glb`
 * (see the Blender source) — NOT read from `useStopperHolderStore` anymore.
 * That store persists to localStorage, and the tray rack used to be a
 * separately-rendered, dev-tunable `LabTestTubeRackInstance`; once it got
 * glued into the tray mesh at a fixed transform, any stale saved `tray`
 * value in a browser's localStorage (e.g. `rotY: 0`, saved back when the
 * rack wasn't rotated yet) would silently keep overriding the current
 * default and misplace every tube — which is exactly what happened. These
 * numbers are the same ones baked into the glb: `x`/`z` slide the rack to
 * one end of the tray's long axis, `y` is the tray's own top-surface height
 * in its local frame, `rotY` is the quarter turn that lays the rack across
 * the tray's short axis — see `useStopperHolderStore`'s (now workbench-only)
 * history for the full derivation.
 */
export const TRAY_RACK_ANCHOR = { x: -0.216, y: 0.02875, z: 0, rotY: Math.PI / 2, scale: 1 } as const;

/**
 * Where test tube `index` sits on the HELD TRAY's rack (`TRAY_RACK_ANCHOR`)
 * as it flies there straight from the cabinet shelf (`LabTestTubeCabinetInstance`)
 * — the only remaining caller now that the workbench rack renders its own
 * tubes via `computeTubeSlotLocalOffset` instead. Deliberately kept on the
 * ORIGINAL alternating row assignment (index 0 → row 0 col 0, index 1 → row
 * 1 col 0, index 2 → row 0 col 1, ...) rather than `tubeSlotRowCol`'s newer
 * "top row first" order — the player asked for the tray's own fill pattern
 * left as it was, only the workbench rack's changed. Offsets are scaled by
 * `holder.scale` so slots stay inside their insert collars regardless of
 * calibration. `rotY` rotates the whole (X, Z) offset around the holder's
 * own Y axis before adding it to `holder.x/z`.
 */
export function computeTubeSlotPosition(
  holder: { x: number; y: number; z: number; rotY?: number; scale: number },
  index: number,
): Position3 {
  const row = index % 2;
  const col = Math.floor(index / 2);
  const localX = (TUBE_SLOT_X_OFFSETS[col] ?? 0) * holder.scale;
  const localZ = (TUBE_SLOT_ROW_Z_OFFSETS[row] ?? 0) * holder.scale;
  const rotationY = holder.rotY ?? 0;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return [
    holder.x + localX * cos + localZ * sin,
    holder.y + TUBE_BASE_Y * holder.scale,
    holder.z - localX * sin + localZ * cos,
  ];
}

/**
 * Raw, UNSCALED local-space hole offset for tube `index` — for a tube
 * rendered as a CHILD of a group that already carries the holder's own
 * position/rotation/scale (`WorkbenchTestTubeRackInstance`), so ordinary
 * Three.js parent/child inheritance does the scaling and rotation for free.
 * Unlike `computeTubeSlotPosition` (which computes an absolute WORLD-ish
 * target for a tube that ISN'T parented to the holder — e.g. the cabinet
 * shelf → held-tray flight target), this never needs `holder.scale`/`rotY`
 * baked in, and stays correct through the holder's own pick-up/inspect/
 * return animation without recomputing anything.
 */
export function computeTubeSlotLocalOffset(index: number): Position3 {
  const { row, col } = tubeSlotRowCol(index);
  return [TUBE_SLOT_X_OFFSETS[col] ?? 0, TUBE_BASE_Y, TUBE_SLOT_ROW_Z_OFFSETS[row] ?? 0];
}

/** Which of the two placed-tube lists an index refers to — tube indices are location-relative, same rule as `attachedTubeSlotIndex`. */
export type TubeLocation = "workbench" | "fumeHood";

interface TestTubeStorageState {
  /** Currently riding the held tray — cleared (and handed to `workbenchTestTubes`) the moment the cabinet session ends, see `transferTrayToWorkbench`. */
  readonly trayTestTubes: readonly StoredTestTube[];
  /** Sitting on the workbench — persists across cabinet sessions. */
  readonly workbenchTestTubes: readonly StoredTestTube[];
  /** Moved into the fume hood's own rack by the «Перенести» flow — a third location alongside tray/workbench, never a copy of either. */
  readonly fumeHoodTestTubes: readonly StoredTestTube[];
  /** Registers an immediate cabinet take. Returns false once the combined tray/workbench rack capacity is full. */
  takeTestTube: (item: StoredTestTube) => boolean;
  /** Moves every current tray test tube onto the workbench and empties the tray — call once when the cabinet interaction ends. */
  transferTrayToWorkbench: () => void;
  /**
   * Adds one reagent to a tube's contents by its slot INDEX within the given
   * location's own list (for the workbench that matches the
   * `WORKBENCH_TUBE_SLOT_INDICES.map(...)` order
   * `WorkbenchTestTubeRackInstance` renders, i.e. `workbenchTestTubes[index]`
   * IS the tube standing in UI slot `index`).
   *
   * Appends rather than replaces — pouring acid onto copper has to leave the
   * copper there. A reagent already present is ignored, so a double click
   * can't stack the same thing twice.
   */
  addTubeContents: (location: TubeLocation, index: number, reagentId: string) => void;
  /**
   * Empties one tube into another within the same location — the ToR's own
   * procedure for experiment 1 («во вторую пробирку подготовьте кислоту»,
   * then pour it onto the copper) and the shape every mixing experiment
   * uses. The source's contents are appended in their existing order, so the
   * receiving tube's `contents` still reads as "what went in, when".
   */
  pourBetweenTubes: (location: TubeLocation, fromIndex: number, toIndex: number) => void;
  /** Moves the named workbench tubes into the fume hood, preserving their relative order. Unknown ids are ignored. */
  transferTestTubesToFumeHood: (instanceIds: readonly string[]) => void;
  /**
   * A cracked tube goes in the bin and a clean, empty one takes its place
   * (same slot, so a clamp holding it keeps holding the new one). The
   * contents are lost with the glass — the player fills it again.
   */
  replaceWithEmptyTube: (location: TubeLocation, index: number) => void;
}

export const useTestTubeStorageStore = create<TestTubeStorageState>((set, get) => ({
  trayTestTubes: [],
  workbenchTestTubes: [],
  fumeHoodTestTubes: [],

  takeTestTube: (item) => {
    const state = get();
    const alreadyStored = [...state.trayTestTubes, ...state.workbenchTestTubes].some(
      (stored) => stored.instanceId === item.instanceId,
    );
    if (alreadyStored) return true;
    if (state.trayTestTubes.length + state.workbenchTestTubes.length >= TEST_TUBE_TRAY_CAPACITY) return false;
    set({ trayTestTubes: [...state.trayTestTubes, item] });
    return true;
  },

  transferTrayToWorkbench: () =>
    set((state) => {
      if (state.trayTestTubes.length === 0) return {};
      const seen = new Set<string>();
      return {
        workbenchTestTubes: [...state.workbenchTestTubes, ...state.trayTestTubes]
          .filter((item) => {
            if (seen.has(item.instanceId)) return false;
            seen.add(item.instanceId);
            return true;
          })
          .slice(0, TEST_TUBE_TRAY_CAPACITY),
        trayTestTubes: [],
      };
    }),

  addTubeContents: (location, index, reagentId) =>
    set((state) => {
      const list =
        location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
      const target = list[index];
      if (!target || target.contents.includes(reagentId)) return state;
      const next = list.slice();
      next[index] = { ...target, contents: [...target.contents, reagentId] };
      return location === "workbench" ? { workbenchTestTubes: next } : { fumeHoodTestTubes: next };
    }),

  pourBetweenTubes: (location, fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return state;
      const list =
        location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
      const source = list[fromIndex];
      const target = list[toIndex];
      if (!source || !target || source.contents.length === 0) return state;

      const poured = source.contents.filter((id) => !target.contents.includes(id));
      const next = list.slice();
      next[fromIndex] = { ...source, contents: [] };
      next[toIndex] = { ...target, contents: [...target.contents, ...poured] };
      return location === "workbench" ? { workbenchTestTubes: next } : { fumeHoodTestTubes: next };
    }),

  replaceWithEmptyTube: (location, index) => {
    const current = get();
    const oldTube = (location === "workbench" ? current.workbenchTestTubes : current.fumeHoodTestTubes)[index];
    if (oldTube) {
      clearTubeAmount(oldTube.instanceId);
      clearDeliveries(oldTube.instanceId);
      clearTubePourImpact(oldTube.instanceId);
    }
    set((state) => {
      const list =
        location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
      const old = list[index];
      if (!old) return state;
      const next = list.slice();
      next[index] = { instanceId: `${old.instanceId.replace(/-replaced-\d+$/, "")}-replaced-${Date.now()}`, contents: [] };
      return location === "workbench" ? { workbenchTestTubes: next } : { fumeHoodTestTubes: next };
    });
  },

  transferTestTubesToFumeHood: (instanceIds) =>
    set((state) => {
      const moving = new Set(instanceIds);
      if (moving.size === 0) return state;
      const taken = state.workbenchTestTubes.filter((tube) => moving.has(tube.instanceId));
      if (taken.length === 0) return state;
      return {
        workbenchTestTubes: state.workbenchTestTubes.filter((tube) => !moving.has(tube.instanceId)),
        fumeHoodTestTubes: [...state.fumeHoodTestTubes, ...taken],
      };
    }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __testTubeStorageStore?: unknown }).__testTubeStorageStore = useTestTubeStorageStore;
}
