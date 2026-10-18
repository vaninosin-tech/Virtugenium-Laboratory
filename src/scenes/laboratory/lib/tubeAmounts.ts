/** Game units are separate from virtual millilitres. A tube never spills. */
import { currentSearch, silverStage } from "./silverStage";
import { silverRuntime } from "./tubeSilverRuntime";
import { tubeVessel } from "./vesselGeometry";

export const TUBE_CAPACITY_ML = tubeVessel.capacityMl;
export const STANDARD_POUR_ML = 1;
/** Fraction of the authored liquid mesh occupied by actual game millilitres. */
export function tubeVisualFill(volumeMl: number): number {
  return Number.isFinite(volumeMl)
    ? tubeVessel.heightFromVolume(volumeMl) / tubeVessel.cavityHeight : 0;
}
export type TubeAmount = { volumeMl: number; species: Record<string, number>; copper: number };
type AmountRegistry = {
  tubes: Map<string, TubeAmount>; seededContents: Map<string, Set<string>>;
  copperProgress: Map<string, number>; bariumExtent: Map<string, number>;
  silverExtent: Map<string, number>; permanganateExtent: Map<string, number>;
};
const registryKey = Symbol.for("virtugenium.tubeAmounts");
const globalRegistry = globalThis as unknown as Record<symbol, AmountRegistry | undefined>;
const registry = globalRegistry[registryKey] ??= {
  tubes: new Map(), seededContents: new Map(), copperProgress: new Map(),
  bariumExtent: new Map(), silverExtent: new Map(), permanganateExtent: new Map(),
};
const { tubes, seededContents, copperProgress, bariumExtent, silverExtent, permanganateExtent } = registry;
export const initial: Record<string, { ml: number; species?: Record<string, number>; copper?: number }> = {
  cu: { ml: 2.5, copper: 3 }, hno3: { ml: 2.5, species: { HNO3: 4.4 } },
  agno3: { ml: 2.5, species: { "Ag+": 1.15 } },
  nacl: { ml: 1, species: { "Cl-": 1 } },
  bacl2: { ml: 2.5, species: { "Ba2+": 1.1 } },
  k2so4: { ml: 1, species: { "SO4(2-)": 1 } },
  na2so3: { ml: 2.5, species: { "SO3(2-)": 6 } },
  h2so4: { ml: 1, species: { "H+": 7.2 } },
  kmno4: { ml: 1, species: { "MnO4-": 2 } },
};
/**
 * Review aid, off by default: window.__silverAgnoMl or ?agnoMl= (0.5 to 3.9 mL) fills the tube with that much AgNO3 instead
 * of 2.5 mL so the liquid is easier to judge. Only the volume changes (liquid height, cell count, jet depth); the species
 * amounts, the chloride portion and the geometry are untouched, and 3.9 mL leaves room for the standard 1 mL pour.
 */
export const MAX_AGNO_REVIEW_ML = TUBE_CAPACITY_ML - STANDARD_POUR_ML - 0.1;
export function seedMl(reagentId: string): number {
  const base = initial[reagentId]?.ml ?? 0;
  if (reagentId !== "agno3" || typeof window === "undefined") return base;
  const fromUrl = Number(new URLSearchParams(currentSearch()).get("agnoMl"));
  const override = Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : (window as Window & { __silverAgnoMl?: unknown }).__silverAgnoMl;
  return typeof override === "number" && Number.isFinite(override)
    ? Math.min(MAX_AGNO_REVIEW_ML, Math.max(0.5, override)) : base;
}
export function tubeAmount(tubeId: string): TubeAmount {
  let state = tubes.get(tubeId);
  if (!state) { state = { volumeMl: 0, species: {}, copper: 0 }; tubes.set(tubeId, state); }
  return state;
}
/** Seed contents that predate this layer, including sandbox presets. */
export function seedTubeAmounts(tubeId: string, contents: readonly string[]) {
  const state = tubeAmount(tubeId);
  for (const id of contents) {
    // Stage 3 chloride has one entry point: a validated delivery event.
    if (id === "nacl" && contents.includes("agno3") && silverStage() === 3) continue;
    if (seededContents.get(tubeId)?.has(id)) continue;
    deliver(tubeId, id, seedMl(id), true);
  }
  return state;
}
/** Deliver at most the remaining capacity. Returns the actual liquid admitted. */
export function deliver(tubeId: string, reagentId: string, ml: number, seed = false): number {
  const state = tubeAmount(tubeId);
  const recipe = initial[reagentId];
  if (!recipe || !Number.isFinite(ml) || ml < 0) return 0;
  if (seed || ml > 0) {
    let seen = seededContents.get(tubeId);
    if (!seen) { seen = new Set<string>(); seededContents.set(tubeId, seen); }
    seen.add(reagentId);
  }
  if (recipe.copper) {
    state.volumeMl = Math.min(TUBE_CAPACITY_ML, Math.max(state.volumeMl, recipe.ml));
    if (seed || ml > 0) state.copper = Math.max(state.copper, recipe.copper);
    return 0;
  }
  const accepted = Math.min(ml, TUBE_CAPACITY_ML - state.volumeMl);
  const fraction = seed ? (seedMl(reagentId) > 0 ? accepted / seedMl(reagentId) : 1)
    : accepted / STANDARD_POUR_ML;
  state.volumeMl += accepted;
  state.copper += (recipe.copper ?? 0) * fraction;
  for (const [species, amount] of Object.entries(recipe.species ?? {}))
    state.species[species] = (state.species[species] ?? 0) + amount * fraction;
  return accepted;
}
/** R1 consumes the limiting acid; one standard pour leaves 45% of the copper. */
export function reactCopper(tubeId: string, requestedExtent: number): number {
  const state = tubeAmount(tubeId);
  const extent = Math.min(Math.max(0, requestedExtent), state.copper / 3, (state.species.HNO3 ?? 0) / 8);
  state.copper -= 3 * extent;
  state.species.HNO3 = (state.species.HNO3 ?? 0) - 8 * extent;
  state.species["Cu2+"] = (state.species["Cu2+"] ?? 0) + 3 * extent;
  state.species.NO = (state.species.NO ?? 0) + 2 * extent;
  return extent;
}
export function syncCopperProgress(tubeId: string, progress: number) {
  const next = Math.max(0, Math.min(1, progress));
  const previous = copperProgress.get(tubeId) ?? 0;
  if (next > previous) reactCopper(tubeId, (next - previous) * 0.55);
  copperProgress.set(tubeId, Math.max(next, previous));
}
export function syncBariumExtent(tubeId: string, extent: number) {
  const state = tubeAmount(tubeId);
  const delta = Math.max(0, Math.min(extent - (bariumExtent.get(tubeId) ?? 0),
    state.species["Ba2+"] ?? 0, state.species["SO4(2-)"] ?? 0));
  state.species["Ba2+"] -= delta; state.species["SO4(2-)"] -= delta;
  state.species.BaSO4 = (state.species.BaSO4 ?? 0) + delta;
  bariumExtent.set(tubeId, (bariumExtent.get(tubeId) ?? 0) + delta);
}
export function syncSilverExtent(tubeId: string, extent: number) {
  const state = tubeAmount(tubeId);
  const delta = Math.max(0, Math.min(extent - (silverExtent.get(tubeId) ?? 0),
    state.species["Ag+"] ?? 0, state.species["Cl-"] ?? 0));
  state.species["Ag+"] -= delta; state.species["Cl-"] -= delta;
  state.species.AgCl = (state.species.AgCl ?? 0) + delta;
  silverExtent.set(tubeId, (silverExtent.get(tubeId) ?? 0) + delta);
}
export function syncPermanganateExtent(tubeId: string, extent: number) {
  const state = tubeAmount(tubeId);
  const delta = Math.max(0, Math.min(extent - (permanganateExtent.get(tubeId) ?? 0),
    (state.species["MnO4-"] ?? 0) / 2, (state.species["SO3(2-)"] ?? 0) / 5,
    (state.species["H+"] ?? 0) / 6));
  state.species["MnO4-"] -= 2 * delta;
  state.species["SO3(2-)"] -= 5 * delta;
  state.species["H+"] -= 6 * delta;
  state.species["Mn2+"] = (state.species["Mn2+"] ?? 0) + 2 * delta;
  state.species["SO4(2-)"] = (state.species["SO4(2-)"] ?? 0) + 5 * delta;
  permanganateExtent.set(tubeId, (permanganateExtent.get(tubeId) ?? 0) + delta);
}
export function clearTubeAmount(tubeId: string) {
  // The runtime owns fields by tube identity, so a cleared tube cannot retain its old field.
  silverRuntime.reset(tubeId);
  seededContents.delete(tubeId);
  tubes.delete(tubeId); copperProgress.delete(tubeId); bariumExtent.delete(tubeId); silverExtent.delete(tubeId); permanganateExtent.delete(tubeId);
}
export function resetTubeAmounts() {
  silverRuntime.reset();
  seededContents.clear();
  tubes.clear(); copperProgress.clear(); bariumExtent.clear(); silverExtent.clear(); permanganateExtent.clear();
}
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __tubeAmount?: typeof tubeAmount }).__tubeAmount = tubeAmount;
