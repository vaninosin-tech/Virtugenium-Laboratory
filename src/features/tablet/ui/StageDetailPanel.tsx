import { useContext, useRef, useState, type CSSProperties } from "react";
import { AlertCircle, Check, FlaskConical, Microscope, Shield, TestTube } from "lucide-react";

import type { Experiment, ExperimentStep } from "../../../entities/laboratory";
import type { ScoreEvent } from "../../../entities/laboratory";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { isEquationStep, scoreForStep } from "../lib/experimentRuntime";
import {
  checkIdentifyAnswers,
  isIdentifyStep,
  STAGE_IDENTIFY_FIELDS,
} from "../lib/stageIdentifyConfig";
import {
  getRequiredItemsProgress,
  getStageRequiredItems,
  isPhysicalOnlyRequiredItem,
  isStageRequiredItemCollected,
  type StageRequiredKind,
} from "../lib/stageRequiredConfig";
import { usePhysicalCollectionState } from "../lib/usePhysicalCollectionState";
import { isSceneCompletedStep } from "../lib/stageSceneConfig";
import { useStageSceneState } from "../lib/useStageSceneState";
import { ComposerTextField, type ComposerFieldHandle } from "./ComposerTextField";
import { SubstanceNameKeyboard } from "./SubstanceNameKeyboard";
import { TabletCloseContext } from "./tabletCloseContext";
import {
  colors,
  mutedTextStyle,
  splitDetailActionsStyle,
  splitDetailCtaButtonStyle,
  typography,
} from "./tabletStyles";
import "./stageDetailPanel.css";

function RequiredKindIcon({
  kind,
  collected,
}: {
  readonly kind: StageRequiredKind;
  readonly collected: boolean;
}) {
  const props = { size: 16, strokeWidth: 2, "aria-hidden": true as const };
  if (collected) return <Check {...props} />;
  if (kind === "ppe") return <Shield {...props} />;
  if (kind === "reagent") return <FlaskConical {...props} />;
  if (kind === "glassware") return <TestTube {...props} />;
  return <Microscope {...props} />;
}

type StageDetailPanelProps = {
  readonly experiment: Experiment;
  readonly step: ExperimentStep | null;
  readonly stepIndex: number;
  readonly isCurrent: boolean;
  readonly isDone: boolean;
  readonly scoreEvents: readonly ScoreEvent[];
  readonly onComplete: () => void;
  readonly onOpenEquation: () => void;
};

export function StageDetailPanel({
  experiment,
  step,
  stepIndex,
  isCurrent,
  isDone,
  scoreEvents,
  onComplete,
  onOpenEquation,
}: StageDetailPanelProps) {
  const identifyAnswers = useLaboratoryStore((state) => state.identifyAnswers);
  const setIdentifyAnswer = useLaboratoryStore((state) => state.setIdentifyAnswer);
  const clearIdentifyAnswers = useLaboratoryStore((state) => state.clearIdentifyAnswers);
  const inventoryItemIds = useLaboratoryStore((state) => state.inventoryItemIds);
  const addInventoryItem = useLaboratoryStore((state) => state.addInventoryItem);
  const removeInventoryItem = useLaboratoryStore((state) => state.removeInventoryItem);
  const physical = usePhysicalCollectionState();
  const backToLab = useContext(TabletCloseContext);
  const sceneState = useStageSceneState(step?.id ?? null);

  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [wrongFieldIds, setWrongFieldIds] = useState<readonly string[]>([]);
  const fieldRefs = useRef<Record<string, ComposerFieldHandle | null>>({});

  const identifyFields = step && isIdentifyStep(step.id) ? STAGE_IDENTIFY_FIELDS[step.id] : null;
  const awarded = step ? scoreForStep(scoreEvents, step.id) : 0;
  const keyboardEnabled = isCurrent && !isDone;

  // Reset the identify-fields UI whenever the experiment/step changes —
  // adjusted during render instead of in an effect, so stale wrong-answer
  // highlighting never briefly commits for the new step.
  const stageResetKey = `${experiment.id}:${step?.id ?? ""}`;
  const [lastStageResetKey, setLastStageResetKey] = useState(stageResetKey);
  if (stageResetKey !== lastStageResetKey) {
    setLastStageResetKey(stageResetKey);
    setWrongFieldIds([]);
    const fields = step && isIdentifyStep(step.id) ? STAGE_IDENTIFY_FIELDS[step.id] : null;
    setActiveFieldId(fields?.[0]?.id ?? null);
  }

  const handleComplete = () => {
    if (!step) return;
    if (sceneState && !sceneState.met) return;

    if (isIdentifyStep(step.id)) {
      const result = checkIdentifyAnswers(step.id, identifyAnswers);
      if (!result.ok) {
        setWrongFieldIds(result.wrongFieldIds);
        return;
      }
      setWrongFieldIds([]);
      clearIdentifyAnswers();
      onComplete();
      return;
    }

    const required = getStageRequiredItems(step.id);
    if (required && required.length > 0) {
      const progress = getRequiredItemsProgress(step.id, inventoryItemIds, physical);
      if (!progress || progress.current < progress.total) return;
    }

    onComplete();
  };

  if (!step) {
    return (
      <div style={panelStyle}>
        <p style={{ ...mutedTextStyle, margin: 0 }}>Все шаги пройдены.</p>
      </div>
    );
  }

  const showIdentify = identifyFields !== null && identifyFields !== undefined;
  const requiredItems = getStageRequiredItems(step.id);
  const requiredProgress =
    requiredItems && requiredItems.length > 0
      ? getRequiredItemsProgress(step.id, inventoryItemIds, physical)
      : null;

  // A checklist gathered by hand in the lab (PPE, reagents, glassware), not yet complete.
  const gatherInLab =
    !!requiredProgress &&
    requiredProgress.current < requiredProgress.total &&
    (requiredItems ?? []).some((item) => isPhysicalOnlyRequiredItem(step.id, item.catalogItemId));

  const canSubmitStep = (() => {
    if (!isCurrent || isDone) return false;
    if (sceneState && !sceneState.met) return false;
    if (showIdentify && identifyFields) {
      return identifyFields.every((field) => (identifyAnswers[field.id] ?? "").trim().length > 0);
    }
    if (requiredProgress) {
      return requiredProgress.current >= requiredProgress.total;
    }
    return true;
  })();

  const toggleRequiredItem = (catalogItemId: string) => {
    if (!step || !isCurrent || isDone) return;
    // Cu/HNO₃/test tubes are physical-only (see PHYSICAL_ONLY_CATALOG_IDS) —
    // the tablet no longer lets the player fake taking them; only actually
    // grabbing them in the 3D scene marks them collected.
    if (isPhysicalOnlyRequiredItem(step.id, catalogItemId)) return;
    if (inventoryItemIds.includes(catalogItemId)) {
      removeInventoryItem(catalogItemId);
    } else {
      addInventoryItem(catalogItemId);
    }
  };

  return (
    <div style={panelStyle}>
      <div className="stage-detail-scroll">
        <h3 style={headingStyle}>
          Этап {stepIndex + 1}. {step.title}
        </h3>

        <div style={sectionStyle}>
          <span style={sectionLabelStyle}>Инструкция</span>
          <p style={bodyStyle}>{step.instruction}</p>
        </div>

        {sceneState && isCurrent && !isDone ? (
          <div style={sectionStyle}>
            <span style={sectionLabelStyle}>В лаборатории</span>
            <p style={sceneRequirementStyle(sceneState.met)}>
              {sceneState.met ? (
                <Check size={16} strokeWidth={2.5} aria-hidden />
              ) : (
                <AlertCircle size={16} strokeWidth={2.5} aria-hidden />
              )}
              <span>
                {sceneState.met ? "Установка собрана верно." : sceneState.requirement.label}
              </span>
            </p>
          </div>
        ) : null}

        {showIdentify ? (
          <>
            <div style={sectionStyle}>
              <span style={sectionLabelStyle}>Описание</span>
              <p style={bodyStyle}>{experiment.description}</p>
            </div>

            <div style={fieldsWrapStyle}>
              {identifyFields.map((field) => {
                const hasError = wrongFieldIds.includes(field.id);
                return (
                  <label key={field.id} style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>{field.label}</span>
                    <ComposerTextField
                      ref={(handle) => {
                        fieldRefs.current[field.id] = handle;
                      }}
                      value={identifyAnswers[field.id] ?? ""}
                      onChange={(next) => {
                        setIdentifyAnswer(field.id, next);
                        if (wrongFieldIds.length > 0) {
                          setWrongFieldIds([]);
                        }
                      }}
                      active={activeFieldId === field.id}
                      onActivate={() => setActiveFieldId(field.id)}
                      enabled={keyboardEnabled}
                      ariaLabel={field.label}
                      invalid={hasError}
                    />
                  </label>
                );
              })}
            </div>

            <SubstanceNameKeyboard
              enabled={keyboardEnabled && activeFieldId !== null}
              onInsert={(chunk) => {
                if (activeFieldId) fieldRefs.current[activeFieldId]?.insert(chunk);
              }}
              onBackspace={() => {
                if (activeFieldId) fieldRefs.current[activeFieldId]?.backspace();
              }}
              onMoveLeft={() => {
                if (activeFieldId) fieldRefs.current[activeFieldId]?.moveLeft();
              }}
              onMoveRight={() => {
                if (activeFieldId) fieldRefs.current[activeFieldId]?.moveRight();
              }}
            />
          </>
        ) : null}

        {requiredItems && requiredItems.length > 0 ? (
          <>
            <div style={stageScrollSpacerStyle} aria-hidden />
            <div style={requiredSectionStyle}>
              <div style={requiredHeaderStyle}>
                <span style={sectionLabelStyle}>Необходимо</span>
                {requiredProgress ? (
                  <span style={requiredCounterStyle} aria-live="polite">
                    {requiredProgress.current}/{requiredProgress.total}
                  </span>
                ) : null}
              </div>
              <div className="stage-required-grid" role="list">
                {requiredItems.map((item) => {
                  const collected = isStageRequiredItemCollected(
                    step.id,
                    item.catalogItemId,
                    inventoryItemIds,
                    physical,
                  );
                  const physicalOnly = isPhysicalOnlyRequiredItem(step.id, item.catalogItemId);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`stage-required-block is-${item.kind}${collected ? " is-collected" : ""}${physicalOnly ? " is-readonly" : ""}`}
                      role="listitem"
                      aria-pressed={collected}
                      disabled={!isCurrent || isDone}
                      onClick={() => toggleRequiredItem(item.catalogItemId)}
                      title={
                        physicalOnly
                          ? collected
                            ? "Уже взято в лаборатории"
                            : "Возьмите физически в лаборатории"
                          : collected
                            ? "Убрать из подобранного"
                            : "Отметить как подобранное"
                      }
                    >
                      <span className="stage-required-block-icon">
                        <RequiredKindIcon kind={item.kind} collected={collected} />
                      </span>
                      <span className="stage-required-block-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div style={stageScrollSpacerStyle} aria-hidden />
        )}
      </div>

      <div style={splitDetailActionsStyle}>
        {isDone ? (
          <span style={{ ...mutedTextStyle, margin: 0, color: colors.success }}>
            Этап выполнен
            {awarded !== 0 ? ` · ${awarded > 0 ? "+" : ""}${awarded} Б` : ""}
          </span>
        ) : isCurrent && isEquationStep(step) ? (
          <button type="button" style={splitDetailCtaButtonStyle} onClick={onOpenEquation}>
            Перейти к уравнению и признаку
          </button>
        ) : isCurrent && isSceneCompletedStep(step.id) ? (
          // Done in the lab, closed by the lab (`SceneStepAutoAdvance`).
          <span style={{ ...mutedTextStyle, margin: 0 }}>Этап засчитается сам, когда вы выполните его в лаборатории</span>
        ) : isCurrent ? (
          <div style={actionRowStyle}>
            {/* PPE and the «Необходимо» list are collected in the lab, not here:
                back to it, until everything is in hand. */}
            {gatherInLab && backToLab ? (
              <button type="button" style={ctaButtonStyle(true)} onClick={backToLab}>
                Приступить
              </button>
            ) : null}
            <button
              type="button"
              style={ctaButtonStyle(canSubmitStep)}
              onClick={handleComplete}
              disabled={!canSubmitStep}
            >
              Выполнить шаг
            </button>
          </div>
        ) : (
          <span style={{ ...mutedTextStyle, margin: 0 }}>Сначала завершите текущий шаг</span>
        )}
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "8px 8px 8px 16px",
  boxSizing: "border-box",
  overflow: "hidden",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeTitle,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
  lineHeight: 1.3,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const requiredSectionStyle: CSSProperties = {
  ...sectionStyle,
  marginTop: 0,
  flexShrink: 0,
};

const requiredHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const requiredCounterStyle: CSSProperties = {
  fontFamily: typography.fontFamilyMono,
  fontSize: 13,
  fontWeight: typography.weightBold,
  color: colors.accentBright,
  fontVariantNumeric: "tabular-nums",
};

const stageScrollSpacerStyle: CSSProperties = {
  flex: 1,
  minHeight: 12,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: colors.accentBright,
};

const sceneRequirementStyle = (met: boolean): CSSProperties => ({
  margin: 0,
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: typography.sizeBody,
  lineHeight: 1.5,
  color: met ? colors.success : colors.accentBright,
});

const bodyStyle: CSSProperties = {
  margin: 0,
  fontSize: typography.sizeBody,
  lineHeight: 1.5,
  color: colors.textMuted,
};

const fieldsWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
};

const fieldRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flex: "0 0 auto",
  minWidth: 0,
};

const fieldLabelStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: typography.sizeCaption,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
  whiteSpace: "nowrap",
};

const actionRowStyle: CSSProperties = { display: "flex", gap: 8 };

const ctaButtonStyle = (ready: boolean): CSSProperties => ({
  ...splitDetailCtaButtonStyle,
  ...(ready
    ? {
        opacity: 1,
        cursor: "pointer",
        boxShadow: "0 0 0 1px rgba(6, 182, 212, 0.55), 0 0 20px rgba(6, 182, 212, 0.4)",
        transition: "opacity 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
      }
    : {
        opacity: 0.38,
        cursor: "not-allowed",
        boxShadow: "none",
        backgroundColor: "rgba(6, 182, 212, 0.28)",
        color: "rgba(15, 23, 42, 0.55)",
        transition: "opacity 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
      }),
});
