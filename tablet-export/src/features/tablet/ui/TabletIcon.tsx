import type { CSSProperties } from "react";
import { AlertTriangle, ChevronRight, FlaskConical, Star } from "lucide-react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { getExperimentById, getStepProgress, getStepById, totalScore } from "../lib/experimentRuntime";
import { colors, progressFillStyle, progressTrackStyle, technicalValueStyle, typography } from "./tabletStyles";

/**
 * Persistent corner widget — the single functional entry point to the
 * tablet. Always visible, in any 3D zone, not just at the workbench. Shows
 * the active experiment, the step required right now, and live progress;
 * clicking (or the chevron) opens the full panel.
 */
export function TabletIcon({ onOpen }: { readonly onOpen: () => void }) {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const completedStepIds = useLaboratoryStore((state) => state.completedStepIds);
  const scoreEvents = useLaboratoryStore((state) => state.scoreEvents);
  const errors = useLaboratoryStore((state) => state.errors);
  const finishedAt = useLaboratoryStore((state) => state.finishedAt);

  const experiment = getExperimentById(selectedExperimentId);
  const currentStep = getStepById(experiment, currentStepId);
  const progress = getStepProgress(experiment, completedStepIds);
  const score = totalScore(scoreEvents);

  const goalText = finishedAt
    ? "Опыт завершён — результат готов"
    : currentStep
      ? currentStep.title
      : "Выберите опыт во вкладке «Опыты»";

  return (
    <button onClick={onOpen} style={containerStyle} title="Открыть планшет">
      <div style={headerRowStyle}>
        <span style={iconBadgeStyle}>
          <FlaskConical size={16} color={colors.accent} />
        </span>
        <span style={titleStyle}>Планшет</span>
        {errors.length > 0 && (
          <span style={errorPillStyle}>
            <AlertTriangle size={11} />
            {errors.length}
          </span>
        )}
        <ChevronRight size={16} color={colors.textMuted} style={{ marginLeft: "auto" }} />
      </div>

      {experiment && <span style={experimentTitleStyle}>{experiment.title}</span>}
      <span style={goalStyle}>{goalText}</span>

      {experiment && !finishedAt && (
        <div style={progressRowStyle}>
          <div style={progressTrackStyle}>
            <div style={progressFillStyle(progress.ratio)} />
          </div>
          <span style={progressLabelStyle}>
            {progress.completed}/{progress.total}
          </span>
        </div>
      )}

      {experiment && (
        <div style={footerRowStyle}>
          <Star size={13} color={colors.warning} fill={colors.warning} />
          <span style={scoreStyle}>
            {score} / {experiment.maximumScore} баллов
          </span>
        </div>
      )}
    </button>
  );
}

const containerStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  left: 20,
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  width: 260,
  padding: "12px 14px",
  backgroundColor: colors.bg,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: 12,
  cursor: "pointer",
  textAlign: "left",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
  // This widget is a separate root from `TabletOverlay`'s frame (it's the
  // collapsed state, shown instead of the expanded panel), so it needs its
  // own base-font application rather than inheriting one from there.
  fontFamily: typography.fontFamilyBase,
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const iconBadgeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 8,
  backgroundColor: colors.accentSoft,
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: 13,
  fontWeight: 700,
};

const errorPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "1px 7px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  color: colors.danger,
  backgroundColor: colors.dangerSoft,
};

const experimentTitleStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const goalStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.35,
};

const progressRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const progressLabelStyle: CSSProperties = {
  ...technicalValueStyle,
  color: colors.textMuted,
  fontSize: 11,
  flexShrink: 0,
};

const footerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  paddingTop: 4,
  borderTop: `1px solid ${colors.border}`,
};

const scoreStyle: CSSProperties = {
  ...technicalValueStyle,
  color: colors.textMuted,
  fontSize: 12,
};
