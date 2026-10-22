import { Trophy } from "lucide-react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { getExperimentById, totalScore } from "../lib/experimentRuntime";
import {
  colors,
  ghostButtonStyle,
  mutedTextStyle,
  panelStyle,
  primaryButtonStyle,
  screenTitleStyle,
  technicalValueStyle,
} from "./tabletStyles";

/** "Экран результата" — shown once the active experiment attempt finishes. */
export function ResultsPanel() {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const scoreEvents = useLaboratoryStore((state) => state.scoreEvents);
  const selectExperiment = useLaboratoryStore((state) => state.selectExperiment);
  const setCurrentStep = useLaboratoryStore((state) => state.setCurrentStep);
  const setTabletSection = useLaboratoryStore((state) => state.setTabletSection);
  const resetAttempt = useLaboratoryStore((state) => state.resetAttempt);
  const openTablet = useLaboratoryStore((state) => state.openTablet);

  const experiment = getExperimentById(selectedExperimentId);
  const score = totalScore(scoreEvents);
  const maximum = experiment?.maximumScore ?? 0;
  const ratio = maximum > 0 ? score / maximum : 0;

  const grade =
    ratio >= 0.85 ? "Отлично" : ratio >= 0.65 ? "Хорошо" : ratio >= 0.4 ? "Удовлетворительно" : "Неудовлетворительно";

  const handleRepeat = () => {
    if (!experiment) return;
    selectExperiment(experiment.id);
    setCurrentStep(experiment.steps[0]?.id ?? null);
    setTabletSection("stages");
  };

  const handlePickAnother = () => {
    // resetAttempt() also flips tabletOpen back to false — reopen straight
    // onto the task list rather than dropping the visitor back into the 3D
    // scene after they just asked to pick a different experiment.
    resetAttempt();
    openTablet("tasks");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", margin: "auto", padding: "24px 0" }}>
      <Trophy size={32} color={colors.warning} />
      <h2 style={screenTitleStyle}>Опыт завершён</h2>
      <p style={{ margin: 0, ...mutedTextStyle }}>{experiment?.title}</p>

      <div style={{ ...panelStyle, textAlign: "center", minWidth: 220 }}>
        <div style={{ ...technicalValueStyle, fontSize: 32, fontWeight: 700, color: colors.accent }}>
          {score} / {maximum}
        </div>
        <div style={mutedTextStyle}>{grade}</div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button style={primaryButtonStyle} onClick={handleRepeat}>
          Повторить опыт
        </button>
        <button style={ghostButtonStyle} onClick={handlePickAnother}>
          Выбрать другой опыт
        </button>
      </div>
    </div>
  );
}
