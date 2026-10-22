import type { Experiment, ExperimentStep } from "../../../entities/laboratory";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { getNextStepId } from "./experimentRuntime";

/**
 * Awards a step's success score rules, marks it complete, and either moves
 * to the next step or — if it was the last one — closes out the
 * experiment and hands off to the results screen. Shared by the
 * "Эксперимент" tab's step checklist and the "Уравнение" tab's successful
 * submission, since both are just different ways of satisfying a step's
 * requirement.
 *
 * All state changes are applied in a single zustand update so the Stages UI
 * does not flash intermediate frames (e.g. "Этап выполнен" before focus moves).
 */
/** `score-1-heat` → `error-1-heat`: the data names a success and its matching mistake alike. */
export const pairedErrorRuleId = (successRuleId: string): string => successRuleId.replace(/^score-/, "error-");

export const advanceStep =(experiment: Experiment, step: ExperimentStep): void => {
  const now = new Date().toISOString();
  const nextStepId = getNextStepId(experiment, step.id);

  useLaboratoryStore.setState((state) => {
    const charged = new Set(state.scoreEvents.map((event) => event.ruleId));
    const scoreEvents = [
      ...state.scoreEvents,
      ...step.successScoreRules
        // A success rule is not paid for the same operation the player was
        // already charged for — `score-1-heat` after `error-1-heat` (a cracked
        // tube) would net the mistake +0 instead of costing points.
        .filter((rule) => !charged.has(pairedErrorRuleId(rule.id)))
        .map((rule) => ({
          ruleId: rule.id,
          points: rule.points,
          stepId: step.id,
          createdAt: now,
        })),
    ];
    const completedStepIds = state.completedStepIds.includes(step.id)
      ? state.completedStepIds
      : [...state.completedStepIds, step.id];

    if (nextStepId) {
      return {
        scoreEvents,
        completedStepIds,
        currentStepId: nextStepId,
      };
    }

    return {
      scoreEvents,
      completedStepIds,
      currentStepId: null,
      completedExperimentIds: state.completedExperimentIds.includes(experiment.id)
        ? state.completedExperimentIds
        : [...state.completedExperimentIds, experiment.id],
      finishedAt: now,
    };
  });
};
