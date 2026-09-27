import { Trophy } from "lucide-react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { getExperimentById, gradeForScore, totalScore } from "../lib/experimentRuntime";
import {
  colors,
  ghostButtonStyle,
  mutedTextStyle,
  panelStyle,
  primaryButtonStyle,
  screenTitleStyle,
  technicalValueStyle,
} from "./tabletStyles";

/** Result screen after an attempt finishes — grades use ToR absolute floors. */
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
  const grade = gradeForScore(score, experiment?.gradeThresholds);

  const handleRepeat = () => {
    if (!experiment) return;
    selectExperiment(experiment.id);
    setCurrentStep(experiment.steps[0]?.id ?? null);
    setTabletSection("stages");
  };

  const handlePickAnother = () => {
    resetAttempt();
    openTablet("tasks");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        alignItems: "center",
        margin: "auto",
        padding: "24px 0",
      }}
    >
      <Trophy size={32} color={colors.warning} />
      <h2 style={screenTitleStyle}>Опыт завершён</h2>
      <p style={{ margin: 0, ...mutedTextStyle, textAlign: "center" }}>{experiment?.title}</p>

      <div style={{ ...panelStyle, textAlign: "center", minWidth: 220 }}>
        <div style={{ ...technicalValueStyle, fontSize: 32, fontWeight: 700, color: colors.accent }}>
          {score} / {maximum}
        </div>
        <div style={{ ...mutedTextStyle, marginTop: 4 }}>{grade}</div>
        {experiment?.gradeThresholds && (
          <p style={{ ...mutedTextStyle, margin: "10px 0 0", fontSize: 12 }}>
            Отлично ≥ {experiment.gradeThresholds.excellentMin} · Хорошо ≥{" "}
            {experiment.gradeThresholds.goodMin} · Удовл. ≥ {experiment.gradeThresholds.satisfactoryMin}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button style={primaryButtonStyle} onClick={handleRepeat}>
          Повторить опыт
        </button>
        <button style={ghostButtonStyle} onClick={handlePickAnother}>
          Выбрать другое
        </button>
      </div>
    </div>
  );
}
