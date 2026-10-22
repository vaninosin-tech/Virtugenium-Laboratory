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
 */
export const advanceStep = (experiment: Experiment, step: ExperimentStep): void => {
  const store = useLaboratoryStore.getState();
  const now = new Date().toISOString();

  for (const rule of step.successScoreRules) {
    store.addScoreEvent({ ruleId: rule.id, points: rule.points, stepId: step.id, createdAt: now });
  }
  store.completeStep(step.id);

  const nextStepId = getNextStepId(experiment, step.id);
  if (nextStepId) {
    store.setCurrentStep(nextStepId);
    return;
  }

  store.completeExperiment(experiment.id);
  store.setCurrentStep(null);
  store.finishSession(now);
};
