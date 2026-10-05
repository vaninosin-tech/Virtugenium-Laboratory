import { create } from "zustand";

import type { ContainerType } from "../../../entities/laboratory/reagents";
import type { HotspotTargetId } from "./layout";
import { REAGENT_TRAY_SLOTS } from "./useTrayReagentAreaStore";
import { useLabNoticeStore } from "./useLabNoticeStore";

/** One reagent the player has taken — enough to re-look-up its full `ReagentContainerConfig` (`REAGENTS[reagentId]`) and render a static display copy. Display size is NOT stored per-instance: the tray uses the live, dev-tunable `heldTray.reagentScale` and the workbench uses its own live `WorkbenchReagentAreaConfig.scale` — both independent, both reactive to dev-panel changes even for items already placed. */
export interface StoredReagent {
  readonly instanceId: string;
  readonly reagentId: string;
  readonly containerType: ContainerType;
  /** Which cabinet's shelf this came from — needed to put it back (`requestReturn`) without re-parsing `instanceId`. */
  readonly cabinetId: HotspotTargetId;
  /**
   * Which `TRAY_SLOTS` index this item physically occupies — assigned ONCE
   * at take-time (see `nextFreeTraySlot`) and fixed for as long as the item
   * stays on the tray, rather than derived from the item's position in the
   * `trayItems` array. Deriving it from array position (or from a
   * dynamically re-centering row/column scheme — both tried and reverted)
   * meant returning ONE jar shifted every later item into a different
   * physical slot the instant it left — a visible "position swap"/jump for
   * jars the player didn't touch. A stable, gap-tolerant slot id fixes
   * that: the freed slot just stays empty until the next take fills it
   * (`nextFreeTraySlot`), and every other jar stays exactly where it was.
   */
  readonly slotIndex: number;
}

/** Captured once, at the moment a tray reagent is clicked to send it back — its EXACT current WORLD pose, so `ReagentContainerInstance`'s reverse flight starts from there with zero pop (same reasoning as the take flight's own captured start). */
export interface ReturnRequest {
  readonly instanceId: string;
  readonly worldPos: readonly [number, number, number];
  readonly worldQuat: readonly [number, number, number, number];
  readonly worldScale: number;
}

/**
 * Hard ceiling from the task spec — the actual usable capacity is
 * `min(this, TRAY_SLOT_COUNT)`, since a fixed physical layout may fit
 * fewer. Briefly dropped to 6 (3x2) for more per-jar spacing, then
 * reverted back to 8 on the player's own call — see `TRAY_SLOT_COUNT`'s
 * doc for the 4x2 layout this restores and its (tighter, but still safe)
 * spacing tradeoff.
 */
export const MAX_REAGENTS_ON_TRAY = 8;

/**
 * Fixed number of physical slots on the HELD tray — actual per-slot
 * positions are computed live from `useTrayReagentAreaStore`'s dev-tunable
 * config (see `computeTrayReagentPosition`/`traySlotLocalPosition`), not a
 * static table here, so a calibration change applies to every item already
 * on the tray immediately — a plain 4-column x 2-row grid (`slotIndex`
 * `col = slotIndex % 4`, `row = floor(slotIndex / 4)`). At this count, the
 * 110mm copper jars can't get much more per-jar gap along the 4-column
 * axis without either overhanging the workbench countertop (physically
 * checked: the tray's rotated length is capped by the countertop's own
 * 0.85m depth) or leaving the rack/rim margins razor-thin — see
 * `useTrayReagentAreaStore`'s `spacingX` doc for the actual numbers.
 * Taken reagents render at `heldTray.reagentScale` (F8 → "Поднос в
 * руках", dev-tunable — the tray is a small prop and needs its own size
 * independent of the workbench's own reagent-area scale); shrink that
 * value if 8 items at once reads as crowded on the physical model.
 */
export const TRAY_SLOT_COUNT = 8;

/**
 * Reagents take only the tray's left half — the right half is the lab
 * equipment's (`REAGENT_TRAY_SLOTS`) — so four bottles at a time.
 */
export const TRAY_CAPACITY = Math.min(MAX_REAGENTS_ON_TRAY, REAGENT_TRAY_SLOTS.length);

/** Smallest tray slot index not currently occupied by any item in `trayItems` — see `StoredReagent.slotIndex`'s doc for why this is gap-tolerant rather than just `trayItems.length`. Returns -1 if every slot is taken; callers already guard capacity separately (`takeReagent`/`TRAY_CAPACITY`). */
export function nextFreeTraySlot(trayItems: readonly StoredReagent[]): number {
  const occupied = new Set(trayItems.map((item, index) => (Number.isFinite(item.slotIndex) ? item.slotIndex : index)));
  for (const slot of REAGENT_TRAY_SLOTS) {
    if (!occupied.has(slot)) return slot;
  }
  return -1;
}

interface ReagentStorageState {
  /**
   * Reagent instance ids taken during the CURRENT open session of each
   * cabinet — a fresh `Set` reference per cabinet id, replaced (never
   * mutated in place) so components subscribed to one cabinet's set
   * re-render correctly on both a take and a session reset.
   */
  readonly takenByCabinet: Partial<Record<HotspotTargetId, ReadonlySet<string>>>;
  /** Currently riding the held tray — cleared (and handed to `workbenchItems`) the moment the cabinet session ends, see `transferTrayToWorkbench`. */
  readonly trayItems: readonly StoredReagent[];
  /** Sitting on the workbench near the stopper holder — the player's own placed items; persists across cabinet sessions (this is not shelf stock). */
  readonly workbenchItems: readonly StoredReagent[];
  /** Moved into the fume hood by the «Перенести» flow — a third location alongside tray/workbench, never a copy of either. */
  readonly fumeHoodItems: readonly StoredReagent[];
  /** Moves the named workbench reagents into the fume hood, preserving their relative order. Unknown ids are ignored. */
  transferReagentsToFumeHood: (instanceIds: readonly string[]) => void;
  /** Marks `cabinetId`'s taken-set empty again — call once when that cabinet is FRESHLY (re)focused, per the "session-local" shelf-stock rule. */
  resetCabinetSession: (cabinetId: HotspotTargetId) => void;
  /** Registers a completed take: marks the instance taken for its cabinet session and appends it to the tray. Call once the take ANIMATION actually reaches the tray (not at click time) — see `ReagentContainerInstance`'s "takeMove" phase — so the shelf original and the tray's static copy are never both visible at once. Returns false (no-op) if the tray has no free slot. */
  takeReagent: (cabinetId: HotspotTargetId, item: StoredReagent) => boolean;
  /** Moves every current tray item onto the workbench (capped at `MAX_REAGENTS_ON_TRAY` total) and empties the tray — call once when the cabinet interaction ends (camera starts its return flight). */
  transferTrayToWorkbench: () => void;
  /** A workbench reagent dropped onto the tray on the table goes onto it (VL-017), into a free slot of the bottles' half; refused (it stays) when there is none. */
  returnWorkbenchReagent: (instanceId: string) => void;
  /** Exchanges two workbench items' grid slots. Tray and cabinet items are never touched. */
  swapWorkbenchReagents: (firstInstanceId: string, secondInstanceId: string) => void;
  /** A tray reagent was clicked to send it back — captured its exact current world pose (see `ReturnRequest`) for `ReagentContainerInstance`'s reverse flight to start from. Only tray items are returnable this way (no cabinet context to fly back to once it's already left for the workbench). No-op if `instanceId` isn't currently on the tray. */
  readonly returnRequest: ReturnRequest | null;
  requestReturn: (
    instanceId: string,
    worldPos: readonly [number, number, number],
    worldQuat: readonly [number, number, number, number],
    worldScale: number,
  ) => void;
  /** Call once `ReagentContainerInstance` has picked up a `returnRequest` and started its reverse flight, so it isn't re-triggered. */
  clearReturnRequest: () => void;
}

function uniqueReagents(items: readonly StoredReagent[]): StoredReagent[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.instanceId)) return false;
    seen.add(item.instanceId);
    return true;
  });
}

export const useReagentStorageStore = create<ReagentStorageState>((set, get) => ({
  takenByCabinet: {},
  trayItems: [],
  workbenchItems: [],
  fumeHoodItems: [],
  returnRequest: null,

  transferReagentsToFumeHood: (instanceIds) =>
    set((state) => {
      const moving = new Set(instanceIds);
      if (moving.size === 0) return state;
      const taken = state.workbenchItems.filter((item) => moving.has(item.instanceId));
      if (taken.length === 0) return state;
      return {
        workbenchItems: state.workbenchItems.filter((item) => !moving.has(item.instanceId)),
        fumeHoodItems: [...state.fumeHoodItems, ...taken],
      };
    }),

  resetCabinetSession: (cabinetId) =>
    set((state) => {
      // Out in the hood counts too, or the shelf showed a second copy of it.
      const stillOutsideCabinet = [...state.trayItems, ...state.workbenchItems, ...state.fumeHoodItems]
        .filter((item) => item.cabinetId === cabinetId)
        .map((item) => item.instanceId);
      return {
        takenByCabinet: {
          ...state.takenByCabinet,
          [cabinetId]: new Set(stillOutsideCabinet),
        },
        workbenchItems: uniqueReagents(state.workbenchItems),
      };
    }),

  takeReagent: (cabinetId, item) => {
    const state = get();
    const alreadyStored = [...state.trayItems, ...state.workbenchItems]
      .some((candidate) => candidate.instanceId === item.instanceId);
    if (!alreadyStored && state.trayItems.length >= TRAY_CAPACITY) return false;
    const takenSet = new Set(state.takenByCabinet[cabinetId] ?? []);
    takenSet.add(item.instanceId);
    set({
      takenByCabinet: { ...state.takenByCabinet, [cabinetId]: takenSet },
      trayItems: alreadyStored ? state.trayItems : [...state.trayItems, item],
      workbenchItems: uniqueReagents(state.workbenchItems),
    });
    return true;
  },

  transferTrayToWorkbench: () =>
    set((state) => {
      if (state.trayItems.length === 0) return {};
      return {
        workbenchItems: uniqueReagents([...state.workbenchItems, ...state.trayItems])
          .slice(0, MAX_REAGENTS_ON_TRAY),
        trayItems: [],
      };
    }),

  returnWorkbenchReagent: (instanceId) =>
    set((state) => {
      const item = state.workbenchItems.find((candidate) => candidate.instanceId === instanceId);
      if (!item) return state;
      const slotIndex = nextFreeTraySlot(state.trayItems);
      if (slotIndex < 0) {
        useLabNoticeStore.getState().show("На подносе нет места для склянок", "refusal");
        return state;
      }
      return {
        workbenchItems: state.workbenchItems.filter((candidate) => candidate.instanceId !== instanceId),
        trayItems: [...state.trayItems, { ...item, slotIndex }],
      };
    }),

  swapWorkbenchReagents: (firstInstanceId, secondInstanceId) =>
    set((state) => {
      if (firstInstanceId === secondInstanceId) return {};
      const firstIndex = state.workbenchItems.findIndex((item) => item.instanceId === firstInstanceId);
      const secondIndex = state.workbenchItems.findIndex((item) => item.instanceId === secondInstanceId);
      if (firstIndex < 0 || secondIndex < 0) return {};
      const workbenchItems = [...state.workbenchItems];
      [workbenchItems[firstIndex], workbenchItems[secondIndex]] = [
        workbenchItems[secondIndex],
        workbenchItems[firstIndex],
      ];
      return { workbenchItems };
    }),

  requestReturn: (instanceId, worldPos, worldQuat, worldScale) => {
    const state = get();
    const item = state.trayItems.find((candidate) => candidate.instanceId === instanceId);
    if (!item) return;
    const takenSet = new Set(state.takenByCabinet[item.cabinetId] ?? []);
    takenSet.delete(instanceId);
    set({
      trayItems: state.trayItems.filter((candidate) => candidate.instanceId !== instanceId),
      takenByCabinet: { ...state.takenByCabinet, [item.cabinetId]: takenSet },
      returnRequest: { instanceId, worldPos, worldQuat, worldScale },
    });
  },

  clearReturnRequest: () => set({ returnRequest: null }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __storageStore?: unknown }).__storageStore = useReagentStorageStore;
}
