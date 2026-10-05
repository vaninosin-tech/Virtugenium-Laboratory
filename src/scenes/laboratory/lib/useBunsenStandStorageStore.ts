import { create } from "zustand";

import { CLAMP_CHANNEL_OFFSET_Z, CLAMP_MOUNT_HEIGHT, CLAMP_TUBE_AXIS_X } from "./bunsenStandGeometry";
import type { Position3 } from "./layout";

/**
 * How far BELOW the model's own root origin `StandBase`'s true bottom sits
 * (Blender build: the base is centred at local Z=-0.006, 0.012m tall, so it
 * spans Z -0.012..0 — the root origin (Z=0) is level with the base's TOP,
 * not its bottom; after the Blender→glTF Z-up→Y-up export, that's local
 * Y=-0.012). Every placement that means "the stand rests ON this surface"
 * has to add this on top of the surface height, or the base sinks this far
 * into the shelf/tray/tabletop instead of sitting on it — exactly the bug
 * `BunsenStandWorkbenchDisplay` had before this constant existed.
 */
export const STAND_BASE_BOTTOM_OFFSET = 0.012;

/** Captured WORLD pose of the tray copy at the instant a return-to-shelf click fires — same "hand off exactly where it visually was" trick `useReagentStorageStore.returnRequest` uses. */
export interface BunsenStandReturnRequest {
  readonly worldPos: Position3;
  readonly worldQuat: readonly [number, number, number, number];
  readonly worldScale: number;
}

/** Table-local (relative to the workbench furniture position) X/Z the stand currently sits at, freely dragged by the player — see `BunsenStandWorkbenchDisplay`. */
export interface BunsenStandTablePosition {
  readonly x: number;
  readonly z: number;
}

/** Where the stand first appears on the table, the moment a cabinet session ends with it riding the tray (see `transferToWorkbench`) — clear of the reagent grid/stopper holder, which sit closer to the table's own center/back edge. Only ever applied once; dragging afterward persists via `setTablePosition`. */
/**
 * The stand's place on the table (VL-018): the middle of the work area, in
 * front of the reagents' row at the far edge, far enough (38 cm) that from the
 * table view the tube in its clamp is seen below the bottles, not over them —
 * over them it took the clicks meant for the bottle behind it. The tube in
 * its clamp straight ahead of the table view (the camera is at the table's
 * middle, X 0), the lamp beside it towards the tray.
 */
export const DEFAULT_TABLE_POSITION: BunsenStandTablePosition = { x: 0.06, z: -0.7 };
/**
 * The stand on the table is turned round: its clamp, and the lamp beside it,
 * towards the tray (VL-018) — not towards the rack.
 */
export const STAND_TABLE_YAW = Math.PI;
/** The clamp's ring from the stand's rod on the table, in table space (X, Z) — `TUBE_RING_LOCAL_OFFSET` turned by `STAND_TABLE_YAW`. */
export function tableRingOffsetXZ(): readonly [number, number] {
  const cos = Math.cos(STAND_TABLE_YAW);
  const sin = Math.sin(STAND_TABLE_YAW);
  const [x, , z] = TUBE_RING_LOCAL_OFFSET;
  return [x * cos + z * sin, -x * sin + z * cos];
}

/**
 * The clamped tube's axis at the clamp jaws (`TubeClamp_TubeAxis`), in the
 * stand's own local space, for the assembly in `bunsenStandAssembly.ts`: the
 * boss at `CLAMP_MOUNT_HEIGHT` on the rod, the clamp handle in the boss's side
 * channel, the jaws `CLAMP_TUBE_AXIS_X` along it. The stand is never rotated
 * once on the table, so this is a plain add onto the stand's own position
 * wherever `InspectableTestTubeSlot` tests a held tube's proximity to it, and
 * the same offset places the attached tube as a CHILD of the stand's group.
 */
export const TUBE_RING_LOCAL_OFFSET: Position3 = [CLAMP_TUBE_AXIS_X, CLAMP_MOUNT_HEIGHT, CLAMP_CHANNEL_OFFSET_Z];
/** How close a held tube needs to get to the ring's centre to "clip in" on release — same spirit as `InspectableTestTubeSlot`'s own `FILL_PROXIMITY_RADIUS` for reagent jars. */
export const TUBE_RING_ATTACH_RADIUS = 0.1;
/** How far below the ring's own centre the attached tube's (bottom-pivoted) origin sits — mostly hanging through/below the ring with its neck poking a little above it, matching how it read in the Blender verification render. */
export const TUBE_RING_INSERT_DEPTH = 0.1;

// v3: the stand moved to the middle of the work area (VL-018) — an old saved spot is in the bottles' row.
const STORAGE_KEY = "vg-bunsen-stand-table-position-v4";

function loadSavedTablePosition(): BunsenStandTablePosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TABLE_POSITION;
    const parsed = JSON.parse(raw) as Partial<BunsenStandTablePosition>;
    if (typeof parsed.x !== "number" || typeof parsed.z !== "number") return DEFAULT_TABLE_POSITION;
    return { x: parsed.x, z: parsed.z };
  } catch {
    return DEFAULT_TABLE_POSITION;
  }
}

interface BunsenStandStorageState {
  /** Only one stand exists — plain flags are enough (no per-instance ids/slots, unlike the reagent/test-tube stores). Mutually exclusive with `onTray`/on the shelf. */
  readonly onTray: boolean;
  readonly onWorkbench: boolean;
  /** Moved into the fume hood by the «Перенести» flow. The stand travels as ONE object with whatever tube is clamped in its ring — `attachedTubeSlotIndex` keeps pointing at that tube, so the clamp survives the move. */
  readonly onFumeHood: boolean;
  readonly tablePosition: BunsenStandTablePosition;
  readonly returnRequest: BunsenStandReturnRequest | null;
  /** The workbench rack's slot index currently clipped into `TubeRing`, or `null` — see `InspectableTestTubeSlot`'s proximity-release check and `BunsenStandWorkbenchDisplay`'s attached-tube child. Reuses the rack's own slot-index identity (same convention `useTestTubeDragStore`/`useTestTubeHoverStore` already key tubes by), not a separate instance id. */
  readonly attachedTubeSlotIndex: number | null;
  /** Captured WORLD position of the held tube at the exact instant it clipped in — read ONCE by `AttachedTube` on mount so it can animate in from wherever the player actually released it instead of popping straight into the ring. Stale between attaches (never cleared on detach — cheap, and always overwritten by the next `attachTestTube` before it's read again). */
  readonly attachStartWorldPosition: Position3 | null;
  take: () => void;
  /** Called once, synchronously, on the same "leave the cabinet" frame `useReagentStorageStore`/`useTestTubeStorageStore`'s own `transferTrayToWorkbench` fire (see `CameraRig.startReturning`) — moves the stand off the tray and onto the table for good. */
  transferToWorkbench: () => void;
  /** No-op unless the stand is currently on the workbench — there is nothing to carry in from the tray or the shelf. */
  transferStandToFumeHood: () => void;
  setTablePosition: (x: number, z: number) => void;
  attachTestTube: (slotIndex: number, worldPos: Position3) => void;
  /** Re-points the existing clamp at the same tube's new slot index after it changes location (workbench -> fume hood), without replaying the clip-in animation. */
  remapAttachedTube: (slotIndex: number | null) => void;
  detachTestTube: () => void;
  requestReturn: (worldPos: Position3, worldQuat: readonly [number, number, number, number], worldScale: number) => void;
  clearReturnRequest: () => void;
}

export const useBunsenStandStorageStore = create<BunsenStandStorageState>((set, get) => ({
  onTray: false,
  onWorkbench: false,
  onFumeHood: false,
  tablePosition: loadSavedTablePosition(),
  returnRequest: null,
  attachedTubeSlotIndex: null,
  attachStartWorldPosition: null,
  take: () => set({ onTray: true }),
  transferToWorkbench: () => {
    if (!get().onTray) return;
    set({ onTray: false, onWorkbench: true });
  },
  transferStandToFumeHood: () => {
    if (!get().onWorkbench) return;
    set({ onWorkbench: false, onFumeHood: true });
  },
  setTablePosition: (x, z) => {
    const tablePosition = { x, z };
    set({ tablePosition });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tablePosition));
    } catch {
      // ignore write failures (private browsing / storage disabled)
    }
  },
  attachTestTube: (slotIndex, worldPos) => set({ attachedTubeSlotIndex: slotIndex, attachStartWorldPosition: worldPos }),
  remapAttachedTube: (slotIndex) => set({ attachedTubeSlotIndex: slotIndex }),
  detachTestTube: () => set({ attachedTubeSlotIndex: null }),
  requestReturn: (worldPos, worldQuat, worldScale) =>
    set({ onTray: false, returnRequest: { worldPos, worldQuat, worldScale } }),
  clearReturnRequest: () => set({ returnRequest: null }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __bunsenStandStore?: unknown }).__bunsenStandStore = useBunsenStandStorageStore;
}
