import { useEffect } from "react";

import { useLabNoticeStore } from "../../../scenes/laboratory/lib/useLabNoticeStore";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { getExperimentById, getStepById } from "./experimentRuntime";
import { isSceneCompletedStep } from "./stageSceneConfig";
import { advanceStep } from "./stepActions";
import { useStageSceneState } from "./useStageSceneState";

/**
 * Closes the current step by itself once the scene shows it done — the
 * player clamps the tube, carries the setup into the hood, heats the
 * reaction, and the lab notices; they are not sent to the tablet to report
 * what they just did. Lives outside the tablet (mounted with the scene) so it
 * works with the tablet closed, which is how these steps are played.
 *
 * A step whose condition already holds when it becomes current closes at
 * once, so a player who did things ahead of the checklist is not held up.
 */
export function SceneStepAutoAdvance() {
  const experimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const completed = useLaboratoryStore((state) => state.completedStepIds);
  const sceneState = useStageSceneState(currentStepId);
  const met = sceneState?.met ?? false;

  useEffect(() => {
    if (!met || !isSceneCompletedStep(currentStepId)) return;
    if (currentStepId === null || completed.includes(currentStepId)) return;
    const experiment = getExperimentById(experimentId);
    const step = getStepById(experiment, currentStepId);
    if (!experiment || !step) return;
    advanceStep(experiment, step);
    useLabNoticeStore.getState().show(`Этап выполнен: ${step.title}`, "info");
  }, [met, currentStepId, experimentId, completed]);

  return null;
}
