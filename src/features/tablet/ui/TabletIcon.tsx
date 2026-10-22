import { AlertTriangle, ChevronRight, FlaskConical } from "lucide-react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { getExperimentById, getStepById, totalScore } from "../lib/experimentRuntime";
import { getStepRequirementProgress } from "../lib/stageRequiredConfig";
import { usePhysicalCollectionState } from "../lib/usePhysicalCollectionState";
import { ScoreProgressBar } from "./ScoreProgressBar";
import "./scoreProgress.css";
import "./tabletCollapsed.css";

type TabletIconProps = {
  readonly onOpen: () => void;
  readonly exiting?: boolean;
  readonly entering?: boolean;
};

/**
 * Collapsed lab UI — hologram status card in the top-left corner.
 * Fixed footprint so idle / active / finished states share one size.
 */
export function TabletIcon({ onOpen, exiting = false, entering = false }: TabletIconProps) {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const scoreEvents = useLaboratoryStore((state) => state.scoreEvents);
  const errors = useLaboratoryStore((state) => state.errors);
  const finishedAt = useLaboratoryStore((state) => state.finishedAt);
  const inventoryItemIds = useLaboratoryStore((state) => state.inventoryItemIds);
  const identifyAnswers = useLaboratoryStore((state) => state.identifyAnswers);
  const physical = usePhysicalCollectionState();

  const experiment = getExperimentById(selectedExperimentId);
  const currentStep = getStepById(experiment, currentStepId);
  const score = totalScore(scoreEvents);
  const requirementProgress = getStepRequirementProgress(
    currentStepId,
    inventoryItemIds,
    identifyAnswers,
    physical,
  );

  const goalText = finishedAt
    ? "Опыт завершён — результат готов"
    : currentStep
      ? currentStep.title
      : "Выберите опыт";

  const experimentLabel = experiment?.title ?? "Опыт не выбран";

  return (
    <button
      type="button"
      className={`tablet-holo-root${exiting ? " is-exiting" : ""}${entering ? " is-entering" : ""}`}
      onClick={onOpen}
      title="Открыть планшет"
      aria-label="Открыть планшет"
      tabIndex={exiting || entering ? -1 : 0}
      disabled={exiting || entering}
    >
      <div className="tablet-holo">
        <div className="tablet-holo-inner">
          <div className="tablet-holo-header">
            <span className="tablet-holo-badge">
              <FlaskConical size={14} color="#22d3ee" />
            </span>
            <span className="tablet-holo-title">
              <span className="tablet-holo-brand">VIRTUGENIUM</span>
              <span className="tablet-holo-brand-sub">Laboratory</span>
            </span>
            {errors.length > 0 ? (
              <span className="tablet-holo-error">
                <AlertTriangle size={11} />
                {errors.length}
              </span>
            ) : null}
            <ChevronRight size={14} color="rgba(148,163,184,0.85)" style={{ marginLeft: "auto" }} />
          </div>

          <span className={`tablet-holo-experiment${!experiment ? " is-empty" : ""}`}>
            {experimentLabel}
          </span>
          <span
            key={finishedAt ? "finished" : (currentStepId ?? "idle")}
            className="tablet-holo-goal"
          >
            {goalText}
          </span>

          {requirementProgress && requirementProgress.total > 0 ? (
            <span
              className="tablet-holo-counter"
              aria-label={`Прогресс ${requirementProgress.current} из ${requirementProgress.total}`}
            >
              {requirementProgress.current} / {requirementProgress.total}
            </span>
          ) : (
            <span className="tablet-holo-counter is-empty" aria-hidden>
              {"\u00A0"}
            </span>
          )}

          <div className="tablet-holo-score-slot">
            {experiment ? (
              <ScoreProgressBar
                score={score}
                maximumScore={experiment.maximumScore}
                fullWidth
              />
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
