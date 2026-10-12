/** Game units are separate from virtual millilitres. A tube never spills. */
export const TUBE_CAPACITY_ML = 5;
export const STANDARD_POUR_ML = 1;
/** The authored cavity is already at its resting level with 2.5 ml. */
export function tubeVisualFill(volumeMl: number): number {
  return Number.isFinite(volumeMl) ? Math.max(0, Math.min(1, volumeMl / 2.5)) : 0;
}
export type TubeAmount = { volumeMl: number; species: Record<string, number>; copper: number };
const tubes = new Map<string, TubeAmount>();
const copperProgress = new Map<string, number>();
const bariumExtent = new Map<string, number>();
const silverExtent = new Map<string, number>();
const permanganateExtent = new Map<string, number>();
const initial: Record<string, { ml: number; species?: Record<string, number>; copper?: number }> = {
  cu: { ml: 0, copper: 3 }, hno3: { ml: 1, species: { HNO3: 4.4 } },
  agno3: { ml: 2.5, species: { "Ag+": 1.15 } },
  nacl: { ml: 1, species: { "Cl-": 1 } },
  bacl2: { ml: 2.5, species: { "Ba2+": 1.1 } },
  k2so4: { ml: 1, species: { "SO4(2-)": 1 } },
  na2so3: { ml: 2.5, species: { "SO3(2-)": 6 } },
  h2so4: { ml: 1, species: { "H+": 7.2 } },
  kmno4: { ml: 1, species: { "MnO4-": 2 } },
};
export function tubeAmount(tubeId: string): TubeAmount {
  let state = tubes.get(tubeId);
  if (!state) { state = { volumeMl: 0, species: {}, copper: 0 }; tubes.set(tubeId, state); }
  return state;
}
/** Seed contents that predate this layer, including sandbox presets. */
export function seedTubeAmounts(tubeId: string, contents: readonly string[]) {
  if (tubes.has(tubeId)) return tubeAmount(tubeId);
  const state = tubeAmount(tubeId);
  for (const id of contents) deliver(tubeId, id, initial[id]?.ml ?? 0, true);
  return state;
}
/** Deliver at most the remaining capacity. Returns the actual liquid admitted. */
export function deliver(tubeId: string, reagentId: string, ml: number, seed = false): number {
  const state = tubeAmount(tubeId);
  const recipe = initial[reagentId];
  if (!recipe || !Number.isFinite(ml) || ml < 0) return 0;
  if (recipe.copper) {
    if (seed || ml > 0) state.copper = Math.max(state.copper, recipe.copper);
    return 0;
  }
  const accepted = Math.min(ml, TUBE_CAPACITY_ML - state.volumeMl);
  const fraction = seed ? (recipe.ml > 0 ? accepted / recipe.ml : 1)
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
  tubes.delete(tubeId); copperProgress.delete(tubeId); bariumExtent.delete(tubeId); silverExtent.delete(tubeId); permanganateExtent.delete(tubeId);
}
export function resetTubeAmounts() {
  tubes.clear(); copperProgress.clear(); bariumExtent.clear(); silverExtent.clear(); permanganateExtent.clear();
}
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __tubeAmount?: typeof tubeAmount }).__tubeAmount = tubeAmount;
