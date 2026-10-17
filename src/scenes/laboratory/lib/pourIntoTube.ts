import type { EntityId } from "../../../entities/laboratory";
import { applyErrorRule } from "../../../features/tablet/lib/penalties";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { MIXING_RULES, judgeMix, reagentName } from "./mixingRules";
import { useLabNoticeStore } from "./useLabNoticeStore";
import { useTestTubeStorageStore, type TubeLocation } from "./useTestTubeStorageStore";

/**
 * A continuous attempt refreshes this instead of repeating itself: the
 * workbench fills by proximity every frame, so without it holding a tube
 * against the wrong jar would log the same error sixty times a second. A
 * pause longer than this (the tube taken away and brought back) is a new
 * attempt.
 */
const SAME_ATTEMPT_MS = 500;
let lastAttempt: { key: string; at: number } | null = null;

const isRepeat = (key: string): boolean => {
  const now = Date.now();
  const repeat = lastAttempt !== null && lastAttempt.key === key && now - lastAttempt.at < SAME_ATTEMPT_MS;
  lastAttempt = { key, at: now };
  return repeat;
};

const listFor = (location: TubeLocation) => {
  const state = useTestTubeStorageStore.getState();
  return location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
};

/** «сначала медь, затем азотная кислота» — the experiment's order spelled out for the notice. */
const describeOrder = (experimentId: EntityId): string => {
  const stages = MIXING_RULES[experimentId]?.stages ?? [];
  return stages
    .map((stage, index) => {
      const names = stage.map((id) => reagentName(id).toLowerCase()).join(" и ");
      return index === 0 ? `сначала ${names}` : `затем ${names}`;
    })
    .join(", ");
};

/**
 * Runs the mixing rules before anything is poured. Only a mix the game has
 * no reaction for is refused — a reagent this experiment does not use. A
 * mistake the game does know (the wrong order) is the player's to make: it
 * is charged and poured all the same, and the reaction shows what it led to
 * (VL-018, replacing the earlier «штраф + откат»).
 */
const guardMix = (
  tubeKey: string,
  contents: readonly string[],
  adding: readonly string[],
  pour: () => void,
): boolean => {
  const experimentId = useLaboratoryStore.getState().selectedExperimentId;
  const verdict = judgeMix(experimentId, contents, adding);
  if (verdict.kind === "ok") {
    lastAttempt = null;
    pour();
    return true;
  }

  if (isRepeat(`${tubeKey}:${verdict.kind}:${verdict.reagentId}`)) {
    if (verdict.kind !== "foreign") { pour(); return true; }
    return false;
  }
  const notices = useLabNoticeStore.getState();
  const name = reagentName(verdict.reagentId);

  if (verdict.kind === "foreign") {
    notices.show(`Нельзя слить: ${name.toLowerCase()} в этом опыте не используется`, "refusal");
    return false;
  }

  const order = experimentId === null ? "" : describeOrder(experimentId);
  const penalty = verdict.ruleId === undefined ? null : applyErrorRule(verdict.ruleId, "wrong-order");
  const points = penalty?.charged ? ` (${penalty.rule.points})` : "";
  notices.show(`Ошибка: нарушен порядок смешивания${points}. Нужно: ${order}`, "error");
  pour();
  return true;
};

/**
 * Mixes that give off a toxic gas and so belong in the fume hood only: the
 * ToR's «работа с токсичным газом вне вытяжки». Outside the hood it is
 * charged — and done all the same (VL-018): the player sees the gas come
 * off on the open bench.
 */
const HOOD_ONLY_MIXES: Readonly<Record<EntityId, { readonly together: readonly string[]; readonly ruleId: EntityId; readonly gas: string }>> = {
  "experiment-copper-nitric-acid": { together: ["cu", "hno3"], ruleId: "error-1-fume", gas: "оксиды азота" },
};

const chargeOutsideHood = (location: TubeLocation, contents: readonly string[], adding: readonly string[]): void => {
  if (location === "fumeHood") return;
  const experimentId = useLaboratoryStore.getState().selectedExperimentId;
  const rule = experimentId === null ? undefined : HOOD_ONLY_MIXES[experimentId];
  if (!rule) return;
  const after = new Set([...contents, ...adding]);
  if (!rule.together.every((id) => after.has(id))) return;
  if (isRepeat(`hood-only:${rule.ruleId}`)) return;
  const penalty = applyErrorRule(rule.ruleId, "safety-violation");
  const points = penalty?.charged ? ` (${penalty.rule.points})` : "";
  useLabNoticeStore
    .getState()
    .show(`Ошибка: выделяются ядовитые ${rule.gas} — этот опыт проводят только в вытяжном шкафу${points}`, "error");
};

export const tryAddToTube = (location: TubeLocation, index: number, reagentId: string): boolean => {
  const target = listFor(location)[index];
  if (!target || target.contents.includes(reagentId)) return false;
  const contents = target.contents;
  return guardMix(target.instanceId, contents, [reagentId], () => {
    chargeOutsideHood(location, contents, [reagentId]);
    useTestTubeStorageStore.getState().addTubeContents(location, index, reagentId);
  });
};

/** Read-only preflight for a delivery event; wrong-order mistakes remain allowed. */
export const canAddToTube = (location: TubeLocation, index: number, reagentId: string): boolean => {
  const target = listFor(location)[index];
  if (!target || target.contents.includes(reagentId)) return false;
  return judgeMix(useLaboratoryStore.getState().selectedExperimentId,
    target.contents, [reagentId]).kind !== "foreign";
};

export const tryPourBetweenTubes = (location: TubeLocation, fromIndex: number, toIndex: number): boolean => {
  const list = listFor(location);
  const source = list[fromIndex];
  const target = list[toIndex];
  if (!source || !target || fromIndex === toIndex || source.contents.length === 0) return false;
  const adding = source.contents.filter((id) => !target.contents.includes(id));
  const contents = target.contents;
  return guardMix(target.instanceId, contents, adding, () => {
    chargeOutsideHood(location, contents, adding);
    useTestTubeStorageStore.getState().pourBetweenTubes(location, fromIndex, toIndex);
  });
};
