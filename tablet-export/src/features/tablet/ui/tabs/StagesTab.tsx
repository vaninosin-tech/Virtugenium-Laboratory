import { CheckCircle2, Circle } from "lucide-react";

import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import {
  getExperimentById,
  getStepById,
  isEquationStep,
} from "../../lib/experimentRuntime";
import { advanceStep } from "../../lib/stepActions";
import { colors, ghostButtonStyle, mutedTextStyle, panelStyle, primaryButtonStyle, sectionTitleStyle } from "../tabletStyles";

/**
 * "Этапы" — the live step checklist for the active attempt, wired to the
 * real scoring/progress state (`currentStepId`/`completedStepIds`/
 * `scoreEvents`), not yet the ToR's full physical manipulation flow (rotate
 * reagents in 4 projections, tilt to pour, preheat over the burner, toggle
 * the fume hood). Those depend on an item-selection/inventory system that
 * doesn't exist yet — this stands in for it with a plain "Выполнить шаг"
 * action so the step/scoring engine has something real to drive today.
 */
export function StagesTab({ onGoToTasks }: { readonly onGoToTasks: () => void }) {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const completedStepIds = useLaboratoryStore((state) => state.completedStepIds);
  const setTabletSection = useLaboratoryStore((state) => state.setTabletSection);

  const experiment = getExperimentById(selectedExperimentId);

  if (!experiment) {
    return (
      <div style={panelStyle}>
        <p style={mutedTextStyle}>Опыт ещё не выбран.</p>
        <button style={{ ...primaryButtonStyle, marginTop: 12 }} onClick={onGoToTasks}>
          Перейти к опытам
        </button>
      </div>
    );
  }

  const currentStep = getStepById(experiment, currentStepId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {experiment.steps.map((step, index) => {
          const isDone = completedStepIds.includes(step.id);
          const isCurrent = step.id === currentStepId;
          return (
            <li key={step.id} style={stepRowStyle}>
              {isDone ? (
                <CheckCircle2 size={16} color={colors.success} />
              ) : (
                <Circle size={16} color={isCurrent ? colors.accent : colors.textMuted} />
              )}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: isCurrent ? 600 : 400,
                  color: isDone ? colors.success : isCurrent ? colors.accent : colors.textMuted,
                }}
              >
                {index + 1}. {step.title}
              </span>
            </li>
          );
        })}
      </ol>

      {currentStep ? (
        <div style={panelStyle}>
          <h4 style={sectionTitleStyle}>{currentStep.title}</h4>
          <p style={{ ...mutedTextStyle, margin: "8px 0 14px" }}>{currentStep.instruction}</p>

          {isEquationStep(currentStep) ? (
            <button style={ghostButtonStyle} onClick={() => setTabletSection("answer")}>
              Перейти к вкладке «Ответ»
            </button>
          ) : (
            <button style={primaryButtonStyle} onClick={() => advanceStep(experiment, currentStep)}>
              Выполнить шаг
            </button>
          )}
        </div>
      ) : (
        <div style={panelStyle}>
          <p style={{ ...mutedTextStyle, margin: 0, color: colors.success }}>Все шаги пройдены.</p>
        </div>
      )}
    </div>
  );
}

const stepRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 0",
} as const;
