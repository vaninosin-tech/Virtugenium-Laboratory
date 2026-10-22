import type { EntityId, LaboratoryErrorCode, ScoreRule } from "../../../entities/laboratory";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { getExperimentById } from "./experimentRuntime";

export interface AppliedPenalty {
  readonly rule: ScoreRule;
  readonly stepId: EntityId;
  /** False when this rule had already been charged in the attempt — the error is logged again, the points are not. */
  readonly charged: boolean;
}

const findErrorRule = (experimentId: EntityId | null, ruleId: EntityId) => {
  const experiment = getExperimentById(experimentId);
  for (const step of experiment?.steps ?? []) {
    const rule = step.errorScoreRules.find((candidate) => candidate.id === ruleId);
    if (rule) return { rule, stepId: step.id };
  }
  return null;
};

/**
 * Charges one of the active experiment's `errorScoreRules`: a negative score
 * event (so `totalScore` and the grade see it) plus an entry in the Errors
 * tab. Each rule is charged at most once per attempt — a player who cracks
 * three tubes in a row has made one mistake three times, and the ToR's grade
 * tables price the mistake, not the repetitions.
 *
 * Returns null when no experiment is running or the rule is not part of it,
 * so callers in scenes that also work outside an assignment need no guard.
 */
export const applyErrorRule = (
  ruleId: EntityId,
  code: LaboratoryErrorCode,
): AppliedPenalty | null => {
  const state = useLaboratoryStore.getState();
  const found = findErrorRule(state.selectedExperimentId, ruleId);
  if (!found) return null;

  const charged = !state.scoreEvents.some((event) => event.ruleId === ruleId);
  useLaboratoryStore.setState((current) => ({
    scoreEvents: charged
      ? [
          ...current.scoreEvents,
          {
            ruleId,
            points: found.rule.points,
            stepId: found.stepId,
            createdAt: new Date().toISOString(),
          },
        ]
      : current.scoreEvents,
    errors: [...current.errors, { code, message: found.rule.reason, stepId: found.stepId }],
  }));
  return { ...found, charged };
};
