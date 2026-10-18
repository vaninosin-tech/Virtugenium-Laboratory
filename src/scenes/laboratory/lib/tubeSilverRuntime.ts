import { STAGE3_AGCL_MOLARITY_MOL_L } from "./tubeSilverSediment";
import * as THREE from "three";
import { TubeSilverField } from "./tubeSilverField";
import { streamStateFromEvent } from "./tubeStreamModel";
import { deliver, tubeAmount } from "./tubeAmounts";
import type { DeliveryEvent } from "./tubeDelivery";
import { tubeLiquidHeight } from "./tubeLiquidLevel";
import { canAddToTube, tryAddToTube } from "./pourIntoTube";
import { CLAMP_TUBE_MOUTH, onSimulationTick } from "./useStandMotionStore";
import { useTestTubeStorageStore, type TubeLocation } from "./useTestTubeStorageStore";
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_BOTTOM, SILVER_TUBE_RADIUS } from "./tubeSilverGeometry";

type Diagnostic = { firstValidImpactMs?: number; firstCompositionUpdateMs?: number;
  firstFieldInitMs?: number; firstChlorideInsertionMs?: number;
  firstImpactPoint?: DeliveryEvent["point"]; deliveredMl: number; surfaceY?: number; eventIds: string[] };
type Entry = { field: TubeSilverField; lastStep: number; delivered: number;
  inlet: THREE.Vector3; latestRate: number; diagnostics: Diagnostic; ids: Set<string>;
  /** Experimental stream model only: ledger volume and last event of the current 50 ms step. */
  pendingMl?: number; lastEvent?: DeliveryEvent };
/** Stream of the pending ledger interval, in tube-local axes; undefined without events or without the flag. */
function pendingStream(entry: Entry) {
  if (!(globalThis as { __silverStream?: unknown }).__silverStream || !entry.lastEvent || !(entry.pendingMl! > 0)) return undefined;
  const state = streamStateFromEvent({ ...entry.lastEvent, ml: entry.pendingMl! }, 50);
  if (state) state.direction.transformDirection(CLAMP_TUBE_MOUTH.root.clone().invert());
  return state;
}
/** Concentration of the receiving AgNO3 (mol/L) and the moles one field unit stands for (1 mL of that concentration). */
const AGNO3_MOLARITY_MOL_L = STAGE3_AGCL_MOLARITY_MOL_L;
const FIELD_UNIT_MOL = 1e-3 * STAGE3_AGCL_MOLARITY_MOL_L;
const entries = new Map<string, Entry>();
const eventId = (event: DeliveryEvent) => `${event.serial}|${event.step}`;
const tubeSlot = (tubeId: string): { location: TubeLocation; index: number } | undefined => {
  const state = useTestTubeStorageStore.getState();
  for (const location of ["workbench", "fumeHood"] as const) {
    const list = location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
    const index = list.findIndex(tube => tube.instanceId === tubeId);
    if (index >= 0) return { location, index };
  }
};
const localPoint = (point: DeliveryEvent["point"]) => new THREE.Vector3(point.x, point.y, point.z)
  .applyMatrix4(CLAMP_TUBE_MOUTH.root.clone().invert());
const localUp = () => new THREE.Vector3(0, 1, 0)
  .transformDirection(CLAMP_TUBE_MOUTH.root.clone().invert());

/** The tube really holds silver nitrate (a field never starts from the chloride alone). */
const holdsSilverNitrate = (tubeId: string) => {
  const slot = tubeSlot(tubeId);
  if (!slot) return false;
  const state = useTestTubeStorageStore.getState();
  const tube = (slot.location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes)[slot.index];
  return !!tube?.contents.includes("agno3") && tubeAmount(tubeId).volumeMl > 0;
};

export const silverRuntime = {
  /**
   * Stage 3 models chloride poured into silver nitrate that is already in the receiving tube.
   * Chloride into an empty tube, into other contents or before the silver nitrate (any order the experiment's
   * mixing rules still allow) takes the plain amount-ledger path and creates no Ag+ and no field.
   */
  acceptsChloride(tubeId: string): boolean {
    return entries.has(tubeId) || holdsSilverNitrate(tubeId);
  },
  canApply(event: DeliveryEvent): boolean {
    if (!event.valid || event.ml <= 0 || event.reagentId !== "nacl") return false;
    const existing = entries.get(event.tubeId);
    if (!existing && !holdsSilverNitrate(event.tubeId)) return false;
    if (existing?.ids.has(eventId(event))) return false;
    if (event.ml > 5 - tubeAmount(event.tubeId).volumeMl + 1e-9) return false;
    const slot = tubeSlot(event.tubeId);
    return !!slot && (!!existing || canAddToTube(slot.location, slot.index, event.reagentId));
  },
  applyDelivery(event: DeliveryEvent): boolean {
    if (!event.valid || event.ml <= 0 || event.reagentId !== "nacl") return false;
    const id = eventId(event);
    const existing = entries.get(event.tubeId);
    if (existing?.ids.has(id)) return false;
    const amount = tubeAmount(event.tubeId);
    const slot = tubeSlot(event.tubeId);
    if (!this.canApply(event) || !slot || !Number.isFinite(event.atMs)) return false;
    const isFirst = !existing;
    // Construct before mutating stores. The constructor is pure with respect to receiving chemistry.
    // Field unit = 0.1 mmol = the NaCl portion (1 mL of 0.1 mol/L). The receiving AgNO3 is 0.1 mol/L too, so its amount in
    // units is its volume in mL: 2.5 mL holds 0.25 mmol Ag+ = 2.5 units, of which 1 unit can precipitate with the 1 mL NaCl.
    const silverUnits = amount.volumeMl * 1e-3 * AGNO3_MOLARITY_MOL_L / FIELD_UNIT_MOL;
    const field = existing?.field ?? new TubeSilverField("LOW", SILVER_TUBE_RADIUS,
      SILVER_TUBE_BOTTOM, silverFieldHeight, silverUnits);
    const inlet = localPoint(event.point);
    const diag: Diagnostic = existing?.diagnostics ?? { deliveredMl: 0, eventIds: [] };
    const up = localUp();
    const level = tubeLiquidHeight(amount.volumeMl + event.ml, silverEffectiveRadius);
    // Place the numerical inlet on the highest wet voxel beneath the physical impact.
    // The physical point stays unchanged in diagnostics.
    field.mask.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < field.mask.activeCount; a++) {
      const index = field.mask.active[a];
      const x = index % field.mask.nx;
      const y = Math.floor(index / field.mask.nx) % field.mask.ny;
      const z = Math.floor(index / (field.mask.nx * field.mask.ny));
      const p = field.mask.point(x, y, z);
      if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y;
    }
    if (!Number.isFinite(top)) { if (isFirst) field.dispose(); return false; }
    inlet.y = top;
    // Preflight the contents target before touching the receiving amount.
    if (isFirst && !canAddToTube(slot.location, slot.index, event.reagentId)) {
      field.dispose(); return false;
    }
    const accepted = deliver(event.tubeId, event.reagentId, event.ml);
    if (isFirst && !tryAddToTube(slot.location, slot.index, event.reagentId)) {
      // A rejected mix must be refused by the action guard before publication.
      field.dispose(); return false;
    }
    const entry: Entry = existing ?? { field, lastStep: Math.floor((event.serial + event.atMs) / 50) * 50,
      delivered: 0, inlet, latestRate: 0, diagnostics: diag, ids: new Set() };
    entry.delivered += accepted;
    entry.inlet.copy(inlet);
    // accepted is the ledger volume in mL. Accumulate all events until the next
    // 50 ms fluid step; Q = (sum accepted mL) * 1e-6 / 0.05 m3/s.
    entry.latestRate = (globalThis as { __silverJetModel?: unknown }).__silverJetModel
      ? entry.latestRate + accepted * 20 : accepted * 20;
    entry.pendingMl = (entry.pendingMl ?? 0) + accepted; entry.lastEvent = event;
    // The first fixed step inserts chloride synchronously with the first valid event.
    if (isFirst) {
      field.streamState = pendingStream(entry);
      field.advance(0.05, up, level, inlet, entry.delivered, 0, entry.latestRate, undefined);
      field.streamState = undefined; entry.pendingMl = 0;
    }
    if (isFirst && (globalThis as { __silverJetModel?: unknown }).__silverJetModel) entry.latestRate = 0;
    entry.ids.add(id);
    diag.eventIds.push(id);
    diag.deliveredMl = entry.delivered;
    if (isFirst) {
      diag.firstValidImpactMs = diag.firstCompositionUpdateMs = diag.firstFieldInitMs =
        diag.firstChlorideInsertionMs = event.atMs;
      diag.firstImpactPoint = { ...event.point };
      diag.surfaceY = event.surfaceY;
      entries.set(event.tubeId, entry);
    }
    return true;
  },
  tick(simMs: number): void {
    for (const [tubeId, entry] of entries) {
      const wanted = Math.floor(simMs / 50) * 50;
      while (entry.lastStep + 50 <= wanted) {
        const up = localUp();
        const level = tubeLiquidHeight(tubeAmount(tubeId).volumeMl, silverEffectiveRadius);
        entry.field.streamState = pendingStream(entry);
        entry.field.advance(0.05, up, level, entry.inlet, entry.delivered, 0,
          entry.latestRate, undefined);
        entry.field.streamState = undefined; entry.pendingMl = 0;
        entry.latestRate = 0;
        entry.lastStep += 50;
      }
    }
  },
  field: (tubeId: string) => entries.get(tubeId)?.field,
  journal: (tubeId: string) => [...(entries.get(tubeId)?.diagnostics.eventIds ?? [])],
  diagnostics: (tubeId: string) => entries.get(tubeId)?.diagnostics,
  reset(tubeId?: string): void {
    for (const [id, entry] of entries) if (tubeId === undefined || id === tubeId) {
      entry.field.dispose(); entries.delete(id);
    }
  },
};
onSimulationTick(silverRuntime.tick);
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __silverRuntime?: typeof silverRuntime }).__silverRuntime = silverRuntime;
