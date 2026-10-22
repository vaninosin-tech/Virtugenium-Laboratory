import { useState, type CSSProperties } from "react";
import { Lock } from "lucide-react";

import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import {
  getExperimentById,
  getStepById,
  isEquationStep,
} from "../../lib/experimentRuntime";
import { advanceStep } from "../../lib/stepActions";
import { ExperimentBriefPanel } from "../ExperimentBriefPanel";
import {
  colors,
  ghostButtonStyle,
  mutedTextStyle,
  primaryButtonStyle,
  sectionTitleStyle,
  typography,
} from "../tabletStyles";
import {
  TABLET_COMPOSER_BOARD_HEIGHT,
  TABLET_COMPOSER_DISPLAY_HEIGHT,
  TABLET_SPEC_PAD_WIDTH,
} from "../tabletComposerLayout";
import "../scoreProgress.css";

/**
 * Same layout as EquationTab: brief panel (flex) + composer.
 * Choice board height matches ChemicalKeyboard so Описание / NO DATA stay identical.
 */
export function ObservationsTab() {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const draft = useLaboratoryStore((state) => state.equationDraft);
  const setEquationObservation = useLaboratoryStore((state) => state.setEquationObservation);
  const addScoreEvent = useLaboratoryStore((state) => state.addScoreEvent);
  const clearErrorsForStep = useLaboratoryStore((state) => state.clearErrorsForStep);
  const pushTabletSection = useLaboratoryStore((state) => state.pushTabletSection);

  const experiment = getExperimentById(selectedExperimentId);
  const currentStep = getStepById(experiment, currentStepId);
  const observationBlocks = experiment?.observationBlocks ?? [];
  const { observations } = draft;

  const [stepIndex, setStepIndex] = useState(0);

  // Reset to the first observation block whenever the assignment/step
  // changes — adjusted during render (React's sanctioned pattern for state
  // that tracks another value) instead of in an effect, so the stale index
  // never briefly commits before the reset fires.
  const resetKey = `${selectedExperimentId ?? ""}:${currentStepId ?? ""}:${observationBlocks.length}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setStepIndex(0);
  }

  if (!experiment || !currentStep || !isEquationStep(currentStep)) {
    return (
      <div style={emptyStateStyle}>
        <span style={emptyIconBadgeStyle} aria-hidden>
          <Lock size={22} color={colors.accent} />
        </span>
        <h3 style={{ ...sectionTitleStyle, fontSize: 18, textAlign: "center" }}>Признаки недоступны</h3>
        <p style={{ ...mutedTextStyle, margin: "10px 0 0", textAlign: "center" }}>
          Сначала запишите и подтвердите уравнение реакции.
        </p>
        <button
          type="button"
          style={{ ...primaryButtonStyle, marginTop: 16, width: "100%" }}
          onClick={() => pushTabletSection("answer")}
        >
          К уравнению
        </button>
      </div>
    );
  }

  if (observationBlocks.length === 0) {
    return (
      <div style={emptyStateStyle}>
        <p style={{ ...mutedTextStyle, margin: 0, textAlign: "center" }}>
          В этом опыте нет качественных признаков.
        </p>
        <button
          type="button"
          style={{ ...primaryButtonStyle, marginTop: 16 }}
          onClick={() => {
            advanceStep(experiment, currentStep);
            pushTabletSection("errors");
          }}
        >
          Завершить шаг
        </button>
      </div>
    );
  }

  const safeIndex = Math.min(stepIndex, observationBlocks.length - 1);
  const block = observationBlocks[safeIndex]!;
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === observationBlocks.length - 1;
  const selectedId = observations[block.id];
  const selectedOption = block.options.find((option) => option.id === selectedId) ?? null;
  const hasAnswer = Boolean(selectedOption);

  const handleFinish = () => {
    if (!hasAnswer) return;
    clearErrorsForStep(currentStep.id);

    // Temporary: accept any selected signs as correct while the UI is iterated.
    const now = new Date().toISOString();
    for (const item of observationBlocks) {
      addScoreEvent({
        ruleId: `obs-${item.id}`,
        points: item.points,
        stepId: currentStep.id,
        createdAt: now,
      });
    }

    advanceStep(experiment, currentStep);
    pushTabletSection("errors");
  };

  const handleNext = () => {
    if (!hasAnswer) return;
    if (isLast) {
      handleFinish();
      return;
    }
    setStepIndex(safeIndex + 1);
  };

  const handleBack = () => {
    if (isFirst) return;
    setStepIndex(safeIndex - 1);
  };

  return (
    <div style={rootStyle}>
      <ExperimentBriefPanel title="Определите признаки" description={experiment.description} />

      <div style={composerStyle}>
        <div style={displayRowStyle}>
          <div style={displayStyle} aria-live="polite" aria-label={block.title}>
            <span style={displayTextStyle}>
              {selectedOption ? (
                <>
                  {block.title}: «{selectedOption.label}»
                </>
              ) : (
                <span style={placeholderStyle}>{block.title}: выберите вариант ответа</span>
              )}
            </span>
          </div>

          <button
            type="button"
            style={ctaStyle(hasAnswer)}
            disabled={!hasAnswer}
            onClick={handleNext}
          >
            {isLast ? "Завершить" : "Далее"}
          </button>
        </div>

        <div style={shellStyle}>
          <div style={boardStyle} role="listbox" aria-label={block.title}>
            {block.options.map((option, optionIndex) => {
              const selected = selectedId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  style={optionKeyStyle(selected)}
                  onClick={() => setEquationObservation(block.id, option.id)}
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <span style={optionIndexStyle(selected)}>{optionIndex + 1}</span>
                  <span style={optionTextStyle(selected)}>{option.label}</span>
                </button>
              );
            })}
          </div>

          <div style={padStyle} role="group" aria-label="Навигация по признакам">
            <span style={padTitleStyle}>ПРИЗНАК</span>
            <div style={padCounterBoxStyle}>
              <span style={padCounterStyle}>
                {safeIndex + 1} / {observationBlocks.length}
              </span>
            </div>
            <button
              type="button"
              style={backButtonStyle(!isFirst)}
              disabled={isFirst}
              onClick={handleBack}
            >
              Назад
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SPEC_PAD_WIDTH = TABLET_SPEC_PAD_WIDTH;

const rootStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  paddingBottom: 12,
};

const composerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flexShrink: 0,
  minWidth: 0,
  marginTop: "auto",
};

const displayRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "stretch",
  flexShrink: 0,
  minWidth: 0,
  height: TABLET_COMPOSER_DISPLAY_HEIGHT,
};

const displayStyle: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  height: "100%",
  padding: "14px 16px",
  borderRadius: 10,
  border: `1px solid ${colors.borderStrong}`,
  backgroundColor: colors.bgElevated,
  display: "flex",
  alignItems: "center",
  boxSizing: "border-box",
  overflow: "hidden",
};

const displayTextStyle: CSSProperties = {
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeBody,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
  lineHeight: 1.4,
  wordBreak: "break-word",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const placeholderStyle: CSSProperties = {
  ...displayTextStyle,
  fontWeight: typography.weightMedium,
  color: colors.textMuted,
};

const ctaStyle = (enabled: boolean): CSSProperties => ({
  ...primaryButtonStyle,
  flex: `0 0 ${SPEC_PAD_WIDTH}px`,
  width: SPEC_PAD_WIDTH,
  minWidth: SPEC_PAD_WIDTH,
  maxWidth: SPEC_PAD_WIDTH,
  alignSelf: "stretch",
  height: "100%",
  minHeight: 0,
  opacity: enabled ? 1 : 0.45,
  cursor: enabled ? "pointer" : "not-allowed",
  boxShadow: enabled ? primaryButtonStyle.boxShadow : "none",
  boxSizing: "border-box",
});

const shellStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "stretch",
  flexShrink: 0,
  minWidth: 0,
  height: TABLET_COMPOSER_BOARD_HEIGHT,
  boxSizing: "border-box",
};

const boardStyle: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgElevated,
  boxShadow: `inset 0 0 0 1px ${colors.accentSoft}`,
  overflow: "hidden",
  boxSizing: "border-box",
};

const optionKeyStyle = (selected: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 12,
  width: "100%",
  boxSizing: "border-box",
  flex: "1 1 0",
  minHeight: 0,
  padding: "8px 12px",
  borderRadius: 8,
  border: `1px solid ${selected ? colors.borderStrong : colors.border}`,
  backgroundColor: selected ? colors.accent : colors.bgInset,
  color: selected ? colors.accentInk : colors.textPrimary,
  boxShadow: selected
    ? `0 0 10px ${colors.accent}55`
    : "0 1px 0 rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: typography.fontFamilyBase,
  outline: "none",
  WebkitTapHighlightColor: "transparent",
  transition: "background-color 0.08s ease, color 0.08s ease, box-shadow 0.08s ease",
});

const optionIndexStyle = (selected: boolean): CSSProperties => ({
  flexShrink: 0,
  width: 22,
  fontFamily: typography.fontFamilyMono,
  fontSize: 14,
  fontWeight: typography.weightBold,
  lineHeight: 1.4,
  textAlign: "center",
  color: selected ? colors.accentInk : colors.textMuted,
});

const optionTextStyle = (selected: boolean): CSSProperties => ({
  flex: 1,
  minWidth: 0,
  fontSize: typography.sizeCaption,
  fontWeight: selected ? typography.weightSemibold : typography.weightMedium,
  color: selected ? colors.accentInk : colors.textPrimary,
  lineHeight: 1.4,
  textAlign: "left",
});

const padStyle: CSSProperties = {
  flex: `0 0 ${SPEC_PAD_WIDTH}px`,
  width: SPEC_PAD_WIDTH,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgElevated,
  boxShadow: `inset 0 0 0 1px ${colors.accentSoft}`,
  boxSizing: "border-box",
};

const padTitleStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: 11,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: colors.accentBright,
  textAlign: "center",
};

const padCounterBoxStyle: CSSProperties = {
  flex: "1 1 0",
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgInset,
};

const padCounterStyle: CSSProperties = {
  fontFamily: typography.fontFamilyMono,
  fontSize: 40,
  fontWeight: typography.weightBold,
  color: colors.accentBright,
  letterSpacing: "0.04em",
  lineHeight: 1,
};

const backButtonStyle = (enabled: boolean): CSSProperties => ({
  ...ghostButtonStyle,
  width: "100%",
  minHeight: 48,
  opacity: enabled ? 1 : 0.4,
  cursor: enabled ? "pointer" : "not-allowed",
});

const emptyStateStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  borderRadius: 14,
  border: `1px dashed ${colors.borderStrong}`,
  backgroundColor: colors.bgElevated,
};

const emptyIconBadgeStyle: CSSProperties = {
  width: 48,
  height: 48,
  marginBottom: 12,
  borderRadius: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.bgInset,
  border: `1px solid ${colors.border}`,
};
