import { create } from "zustand";

import { CLAMP_CHANNEL_OFFSET_Z, CLAMP_MOUNT_HEIGHT, CLAMP_TUBE_AXIS_X } from "./bunsenStandGeometry";
import type { Position3 } from "./layout";

/**
 * Fixed local anchor for the stand while it rides the held tray — its own
 * dedicated spot, deliberately NOT part of the 4x2 reagent grid
 * (`useTrayReagentAreaStore`, centered ~x=0.182) or the glued-in test-tube
 * rack (`TRAY_RACK_ANCHOR`, x=-0.216): `BunsenStand.glb`'s own footprint
 * (0.30m rod, rings reaching ~0.15m off it) is bigger than the tray itself
 * was ever sized for (its widest reagent, a 0.11m jar, drove that grid's
 * spacing) — there's no slot this actually fits cleanly into, so it's placed
 * roughly centered on the tray instead of squeezed into the remaining gap.
 */
export const BUNSEN_STAND_TRAY_ANCHOR: Position3 = [0.05, 0.03, 0];

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

/**
 * `BUNSEN_STAND_TRAY_ANCHOR` corrected for `STAND_BASE_BOTTOM_OFFSET` — the
 * actual local position to render the stand's root at so its base rests ON
 * the tray rather than sinking into it. Shared by `BunsenStandInstance`'s
 * shelf→tray flight target and `BunsenStandTrayDisplay`'s own static render
 * position; they have to agree exactly, or the flight would visibly pop the
 * instant it hands off to the static copy.
 */
export const BUNSEN_STAND_TRAY_REST_POSITION: Position3 = [
  BUNSEN_STAND_TRAY_ANCHOR[0],
  BUNSEN_STAND_TRAY_ANCHOR[1] + STAND_BASE_BOTTOM_OFFSET,
  BUNSEN_STAND_TRAY_ANCHOR[2],
];

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
const DEFAULT_TABLE_POSITION: BunsenStandTablePosition = { x: -0.06, z: -0.12 };

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

const STORAGE_KEY = "vg-bunsen-stand-table-position-v2";

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
