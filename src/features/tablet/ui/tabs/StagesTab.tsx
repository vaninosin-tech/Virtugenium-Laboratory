import type { CSSProperties } from "react";
import { CheckCircle2, Lock, PlayCircle } from "lucide-react";

import type { EntityId } from "../../../../entities/laboratory";
import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import {
  getExperimentById,
  getNextStepId,
  getStepById,
  isEquationStep,
  scoreForStep,
} from "../../lib/experimentRuntime";
import { advanceStep } from "../../lib/stepActions";
import { StageDetailPanel } from "../StageDetailPanel";
import {
  colors,
  listItemButtonStyle,
  mutedTextStyle,
  splitLayoutStyle,
  splitListStyle,
  typography,
} from "../tabletStyles";
import "../tabletTransitions.css";

function StepStatusIcon({
  isDone,
  isCurrent,
}: {
  readonly isDone: boolean;
  readonly isCurrent: boolean;
}) {
  if (isDone) return <CheckCircle2 size={18} color={colors.success} aria-label="Выполнено" />;
  if (isCurrent) return <PlayCircle size={18} color={colors.accentBright} aria-label="Текущий шаг" />;
  return <Lock size={18} color={colors.textMuted} aria-label="Ещё не доступен" />;
}

type StagesTabProps = {
  readonly focusedStepId: EntityId | null;
  readonly onFocusStep: (stepId: EntityId) => void;
};

/** «Этапы» — checklist left, structured detail right. */
export function StagesTab({ focusedStepId, onFocusStep }: StagesTabProps) {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const completedStepIds = useLaboratoryStore((state) => state.completedStepIds);
  const scoreEvents = useLaboratoryStore((state) => state.scoreEvents);
  const pushTabletSection = useLaboratoryStore((state) => state.pushTabletSection);

  const experiment = getExperimentById(selectedExperimentId);

  if (!experiment) {
    return (
      <div style={emptyStyle}>
        <p style={{ ...mutedTextStyle, margin: 0 }}>Опыт ещё не выбран.</p>
      </div>
    );
  }

  const canFocusStep = (stepId: EntityId) =>
    stepId === currentStepId || completedStepIds.includes(stepId);

  const resolvedFocusId =
    focusedStepId && canFocusStep(focusedStepId)
      ? focusedStepId
      : currentStepId;

  const focusedStep =
    getStepById(experiment, resolvedFocusId) ??
    getStepById(experiment, currentStepId) ??
    experiment.steps[0] ??
    null;
  const focusedIndex =
    focusedStep !== null ? experiment.steps.findIndex((step) => step.id === focusedStep.id) : -1;
  const isCurrent = focusedStep !== null && focusedStep.id === currentStepId;
  const isDone = focusedStep !== null && completedStepIds.includes(focusedStep.id);

  const handleFocusStep = (stepId: EntityId) => {
    if (!canFocusStep(stepId)) return;
    onFocusStep(stepId);
  };

  const handleCompleteStep = () => {
    if (!focusedStep || !isCurrent || isEquationStep(focusedStep)) return;
    const nextStepId = getNextStepId(experiment, focusedStep.id);
    advanceStep(experiment, focusedStep);
            if (nextStepId) {
      onFocusStep(nextStepId);
      const nextStep = getStepById(experiment, nextStepId);
      if (nextStep && isEquationStep(nextStep)) {
        pushTabletSection("answer");
      }
    }
  };

  const openEquation = () => {
    pushTabletSection("answer");
  };

  return (
    <div style={layoutStyle}>
      <div style={splitListStyle}>
        <span style={paneLabelStyle}>Этап</span>
        <ol style={listStyle}>
          {experiment.steps.map((step, index) => {
            const stepDone = completedStepIds.includes(step.id);
            const stepCurrent = step.id === currentStepId;
            const isFocused = step.id === resolvedFocusId;
            const isFuture = !stepDone && !stepCurrent;
            const stepAwarded = scoreForStep(scoreEvents, step.id);

            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => handleFocusStep(step.id)}
                  disabled={isFuture}
                  aria-disabled={isFuture}
                  title={isFuture ? "Этап ещё недоступен" : undefined}
                  style={{
                    ...listItemButtonStyle(isFocused),
                    ...(isFuture
                      ? {
                          cursor: "not-allowed",
                          opacity: 0.55,
                        }
                      : null),
                  }}
                >
                  <StepStatusIcon isDone={stepDone} isCurrent={stepCurrent} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: isFocused
                        ? colors.accentBright
                        : stepDone
                          ? colors.success
                          : stepCurrent
                            ? colors.accentBright
                            : isFuture
                              ? colors.textMuted
                              : colors.textPrimary,
                      fontSize: typography.sizeCaption,
                      fontWeight: stepCurrent || isFocused ? typography.weightSemibold : typography.weightMedium,
                      lineHeight: 1.35,
                    }}
                  >
                    {index + 1}. {step.title}
                  </span>
                  <span
                    style={{
                      ...awardTextStyle(stepAwarded > 0),
                      visibility: stepDone && stepAwarded !== 0 ? "visible" : "hidden",
                    }}
                    aria-hidden={!(stepDone && stepAwarded !== 0)}
                  >
                    {stepAwarded > 0 ? `+${stepAwarded}` : stepAwarded} Б
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div key={focusedStep?.id ?? "done"} className="tablet-stage-pane">
        <StageDetailPanel
          experiment={experiment}
          step={focusedStep}
          stepIndex={focusedIndex >= 0 ? focusedIndex : 0}
          isCurrent={isCurrent}
          isDone={isDone}
          scoreEvents={scoreEvents}
          onComplete={handleCompleteStep}
          onOpenEquation={openEquation}
        />
      </div>
    </div>
  );
}

const layoutStyle: CSSProperties = {
  ...splitLayoutStyle,
  height: "100%",
  overflow: "hidden",
};

const paneLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: colors.accentBright,
  marginBottom: 4,
};

const listStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const emptyStyle: CSSProperties = {
  padding: "4px 4px 8px 16px",
};

const awardTextStyle = (positive: boolean): CSSProperties => ({
  flexShrink: 0,
  minWidth: 44,
  textAlign: "right",
  fontFamily: typography.fontFamilyMono,
  fontSize: 11,
  fontWeight: typography.weightBold,
  fontVariantNumeric: "tabular-nums",
  color: positive ? colors.success : colors.danger,
});
