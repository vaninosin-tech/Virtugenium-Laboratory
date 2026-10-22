import { useCallback, useState, type CSSProperties } from "react";
import { Lock } from "lucide-react";

import type { EquationAnswer, EquationArrow } from "../../../../entities/equation";
import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import {
  getExperimentById,
  getStepById,
  isEquationStep,
  parseMolecularEquation,
} from "../../lib/experimentRuntime";
import { tokenizeComposerText } from "../../lib/composerText";
import { advanceStep } from "../../lib/stepActions";
import { ChemicalKeyboard } from "../ChemicalKeyboard";
import { ExperimentBriefPanel } from "../ExperimentBriefPanel";
import {
  colors,
  mutedTextStyle,
  primaryButtonStyle,
  sectionTitleStyle,
  typography,
} from "../tabletStyles";
import {
  TABLET_COMPOSER_DISPLAY_HEIGHT,
  TABLET_SPEC_PAD_WIDTH,
} from "../tabletComposerLayout";
import "../scoreProgress.css";

const SUBSCRIPT_TO_DIGIT: Readonly<Record<string, string>> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": "+",
  "₋": "-",
};

const SUPERSCRIPT_TO_ASCII: Readonly<Record<string, string>> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
};

const normalizeMolecularText = (text: string): string =>
  text
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋]/g, (char) => SUBSCRIPT_TO_DIGIT[char] ?? char)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, (char) => SUPERSCRIPT_TO_ASCII[char] ?? char);

const toAnswer = (molecularText: string): EquationAnswer | null => {
  const trimmed = normalizeMolecularText(molecularText).trim();
  if (!trimmed) return null;
  const arrow: EquationArrow = trimmed.includes("<->") ? "<->" : "->";
  if (!trimmed.includes("->") && !trimmed.includes("<->")) return null;
  const parsed = parseMolecularEquation(trimmed);
  if (parsed.reactants.length === 0 || parsed.products.length === 0) return null;
  return {
    reactants: parsed.reactants,
    products: parsed.products,
    arrow,
  };
};

/**
 * Equation entry via chemical keyboard. Observations live on a following page.
 */
export function EquationTab() {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const draft = useLaboratoryStore((state) => state.equationDraft);
  const setEquationMolecularText = useLaboratoryStore((state) => state.setEquationMolecularText);
  const setEquationReactants = useLaboratoryStore((state) => state.setEquationReactants);
  const setEquationProducts = useLaboratoryStore((state) => state.setEquationProducts);
  const setEquationArrow = useLaboratoryStore((state) => state.setEquationArrow);
  const pushTabletSection = useLaboratoryStore((state) => state.pushTabletSection);
  const clearErrorsForStep = useLaboratoryStore((state) => state.clearErrorsForStep);

  const experiment = getExperimentById(selectedExperimentId);
  const currentStep = getStepById(experiment, currentStepId);
  const observationBlocks = experiment?.observationBlocks ?? [];
  const molecularText = draft.molecularText;
  const canProceed = molecularText.trim().length > 0;

  const [cursor, setCursor] = useState(molecularText.length);
  const [fieldActive, setFieldActive] = useState(false);

  // Clamp the caret when `molecularText` changes for a reason other than
  // this tab's own edits (e.g. switching steps) — adjusted during render
  // (React's sanctioned pattern for state that tracks another value)
  // rather than in an effect, which would commit a stale caret for one
  // extra frame first.
  const [clampedForText, setClampedForText] = useState(molecularText);
  if (molecularText !== clampedForText) {
    setClampedForText(molecularText);
    setCursor((position) => Math.min(Math.max(0, position), molecularText.length));
  }

  /* eslint-disable react-hooks/preserve-manual-memoization --
   * The React Compiler infers `setFieldActive` (a stable useState setter,
   * conventionally omitted from deps) as a dependency for each of these and
   * bails on reconciling that with the explicit arrays below. The manual
   * deps here are correct as written; disabling rather than chasing the
   * compiler's inference to avoid introducing stale-closure bugs.
   */
  const onInsert = useCallback(
    (chunk: string) => {
      setFieldActive(true);
      const next = `${molecularText.slice(0, cursor)}${chunk}${molecularText.slice(cursor)}`;
      setEquationMolecularText(next);
      setCursor(cursor + chunk.length);
    },
    [cursor, molecularText, setEquationMolecularText],
  );

  const onBackspace = useCallback(() => {
    setFieldActive(true);
    if (cursor <= 0) return;
    const next = `${molecularText.slice(0, cursor - 1)}${molecularText.slice(cursor)}`;
    setEquationMolecularText(next);
    setCursor(cursor - 1);
  }, [cursor, molecularText, setEquationMolecularText]);

  const onClear = useCallback(() => {
    setFieldActive(true);
    setEquationMolecularText("");
    setCursor(0);
  }, [setEquationMolecularText]);

  const onMoveLeft = useCallback(() => {
    setFieldActive(true);
    setCursor((position) => Math.max(0, position - 1));
  }, []);

  const onMoveRight = useCallback(() => {
    setFieldActive(true);
    setCursor((position) => Math.min(molecularText.length, position + 1));
  }, [molecularText.length]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  if (!experiment || !currentStep || !isEquationStep(currentStep)) {
    return (
      <div style={emptyStateStyle}>
        <span style={emptyIconBadgeStyle} aria-hidden>
          <Lock size={22} color={colors.accent} />
        </span>
        <h3 style={{ ...sectionTitleStyle, fontSize: 18, textAlign: "center" }}>Ответ пока недоступен</h3>
        <p style={{ ...mutedTextStyle, margin: "10px 0 0", textAlign: "center" }}>
          Форма откроется на шаге уравнения.
        </p>
        <button
          type="button"
          style={{ ...primaryButtonStyle, marginTop: 16, width: "100%" }}
          onClick={() => pushTabletSection("stages")}
        >
          К этапам
        </button>
      </div>
    );
  }

  const handleNext = () => {
    if (!canProceed) return;
    clearErrorsForStep(currentStep.id);

    // Temporary: accept any non-empty input as correct while the equation UI is iterated.
    const answer = toAnswer(molecularText);
    if (answer) {
      setEquationReactants(answer.reactants);
      setEquationProducts(answer.products);
      setEquationArrow(answer.arrow);
    }

    if (observationBlocks.length > 0) {
      pushTabletSection("observations");
      return;
    }

    advanceStep(experiment, currentStep);
    pushTabletSection("errors");
  };

  const glyphs = tokenizeComposerText(molecularText);
  const atEnd = cursor >= molecularText.length;
  const nextLabel = observationBlocks.length > 0 ? "Далее" : "Проверить";
  const showPlaceholder = !molecularText && !fieldActive;

  return (
    <div style={rootStyle}>
      <ExperimentBriefPanel title="Запишите уравнение" description={experiment.description} />

      <div style={composerStyle}>
        <div style={displayRowStyle}>
          <div
            role="textbox"
            tabIndex={0}
            aria-live="polite"
            aria-label="Поле уравнения"
            style={{ ...displayStyle, cursor: "text" }}
            onClick={() => setFieldActive(true)}
            onFocus={() => setFieldActive(true)}
            onBlur={() => {
              if (!molecularText) setFieldActive(false);
            }}
          >
            <span style={displayTextStyle}>
              {showPlaceholder ? (
                <span style={placeholderStyle}>Наберите уравнение</span>
              ) : (
                <>
                  {glyphs.map((glyph) => {
                    const selected = !atEnd && cursor >= glyph.start && cursor < glyph.end;
                    return (
                      <span
                        key={`${glyph.start}-${glyph.end}`}
                        className={selected ? "equation-char-selected" : undefined}
                      >
                        {glyph.display === " " ? "\u00a0" : glyph.display}
                      </span>
                    );
                  })}
                  {atEnd ? (
                    <span className="equation-caret" aria-hidden>
                      _
                    </span>
                  ) : null}
                </>
              )}
            </span>
          </div>

          <button
            type="button"
            style={ctaStyle(canProceed)}
            disabled={!canProceed}
            onClick={handleNext}
          >
            {nextLabel}
          </button>
        </div>

        <ChemicalKeyboard
          onInsert={onInsert}
          onBackspace={onBackspace}
          onClear={onClear}
          onMoveLeft={onMoveLeft}
          onMoveRight={onMoveRight}
        />
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
  fontFamily: typography.fontFamilyMono,
  fontSize: 18,
  fontWeight: typography.weightSemibold,
  color: colors.textMuted,
  lineHeight: 1.4,
  wordBreak: "break-word",
};

const placeholderStyle: CSSProperties = {
  ...displayTextStyle,
  fontWeight: typography.weightMedium,
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
