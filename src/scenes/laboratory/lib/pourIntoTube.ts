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
 * Runs the mixing rules before anything is actually poured. A refused or
 * penalised pour never reaches the tube — that is the rollback half of
 * «штраф + видимое последствие + откат»: the player sees what went wrong
 * and is left where they were, able to do it right.
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

  if (isRepeat(`${tubeKey}:${verdict.kind}:${verdict.reagentId}`)) return false;
  const notices = useLabNoticeStore.getState();
  const name = reagentName(verdict.reagentId);

  if (verdict.kind === "foreign") {
    notices.show(`Нельзя слить: ${name.toLowerCase()} в этом опыте не используется`, "refusal");
    return false;
  }

  const order = experimentId === null ? "" : describeOrder(experimentId);
  const penalty = verdict.ruleId === undefined ? null : applyErrorRule(verdict.ruleId, "wrong-order");
  if (penalty) {
    const points = penalty.charged ? ` (${penalty.rule.points})` : "";
    notices.show(`Ошибка: нарушен порядок смешивания${points}. Нужно: ${order}`, "error");
  } else {
    notices.show(`Нельзя слить в таком порядке. Нужно: ${order}`, "refusal");
  }
  return false;
};

/**
 * Mixes that give off a toxic gas and so belong in the fume hood only: the
 * ToR's «работа с токсичным газом вне вытяжки». Refused outside the hood,
 * and charged — the attempt itself is the mistake.
 */
const HOOD_ONLY_MIXES: Readonly<Record<EntityId, { readonly together: readonly string[]; readonly ruleId: EntityId; readonly gas: string }>> = {
  "experiment-copper-nitric-acid": { together: ["cu", "hno3"], ruleId: "error-1-fume", gas: "оксиды азота" },
};

const refusedOutsideHood = (location: TubeLocation, contents: readonly string[], adding: readonly string[]): boolean => {
  if (location === "fumeHood") return false;
  const experimentId = useLaboratoryStore.getState().selectedExperimentId;
  const rule = experimentId === null ? undefined : HOOD_ONLY_MIXES[experimentId];
  if (!rule) return false;
  const after = new Set([...contents, ...adding]);
  if (!rule.together.every((id) => after.has(id))) return false;
  // The workbench fills by proximity every frame: one attempt, one notice.
  if (isRepeat(`hood-only:${rule.ruleId}`)) return true;
  const penalty = applyErrorRule(rule.ruleId, "safety-violation");
  const points = penalty?.charged ? ` (${penalty.rule.points})` : "";
  useLabNoticeStore
    .getState()
    .show(`Ошибка: выделяются ядовитые ${rule.gas} — этот опыт проводят только в вытяжном шкафу${points}`, "error");
  return true;
};

export const tryAddToTube = (location: TubeLocation, index: number, reagentId: string): boolean => {
  const target = listFor(location)[index];
  if (!target || target.contents.includes(reagentId)) return false;
  if (refusedOutsideHood(location, target.contents, [reagentId])) return false;
  return guardMix(target.instanceId, target.contents, [reagentId], () =>
    useTestTubeStorageStore.getState().addTubeContents(location, index, reagentId),
  );
};

export const tryPourBetweenTubes = (location: TubeLocation, fromIndex: number, toIndex: number): boolean => {
  const list = listFor(location);
  const source = list[fromIndex];
  const target = list[toIndex];
  if (!source || !target || fromIndex === toIndex || source.contents.length === 0) return false;
  const adding = source.contents.filter((id) => !target.contents.includes(id));
  if (refusedOutsideHood(location, target.contents, adding)) return false;
  return guardMix(target.instanceId, target.contents, adding, () =>
    useTestTubeStorageStore.getState().pourBetweenTubes(location, fromIndex, toIndex),
  );
};
