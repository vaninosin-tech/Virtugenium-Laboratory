import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FlaskConical, RotateCcw, Settings, X } from "lucide-react";

import type { EntityId } from "../../../entities/laboratory";
import { mustChooseExperiment, useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import {
  isSectionLockedWithoutTask,
  type TabletSection,
} from "../../../stores/laboratory/types";
import { getExperimentById, totalScore } from "../lib/experimentRuntime";
import { ResultsPanel } from "./ResultsPanel";
import { TabletCloseContext } from "./tabletCloseContext";
import { ScoreProgressBar } from "./ScoreProgressBar";
import { TabletBezel } from "./TabletBezel";
import { EquationTab } from "./tabs/EquationTab";
import { ErrorsTab } from "./tabs/ErrorsTab";
import { ObservationsTab } from "./tabs/ObservationsTab";
import { StagesTab } from "./tabs/StagesTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { TasksTab } from "./tabs/TasksTab";
import { TheoryTab } from "./tabs/TheoryTab";
import { TransferTab } from "./tabs/TransferTab";
import { colors, dangerButtonStyle, ghostButtonStyle, panelStyle, touch, typography } from "./tabletStyles";
import "./scoreProgress.css";

const SECTION_TITLES: Record<TabletSection, string> = {
  tasks: "Опыты",
  stages: "Этапы",
  theory: "Теория",
  errors: "Ошибки",
  answer: "Уравнение",
  observations: "Признаки реакции",
  transfer: "Перенос в вытяжной шкаф",
  settings: "Настройки",
};

/** Results takeover only on main work panels after a finished attempt. */
// "errors" too: finishing the last step lands there, and the result has to be what the player sees then.
const RESULT_TAKEOVER_SECTIONS: readonly TabletSection[] = ["tasks", "stages", "answer", "observations", "errors"];

type TabletOverlayProps = {
  /** When false, skip TabletBezel — R3F mesh already provides the chassis. */
  readonly chrome?: boolean;
  /** Extra class for open/close animation on the bezel shell. */
  readonly shellClassName?: string;
  /** Restores scene controls before the overlay is closed by the same user gesture. */
  readonly onClose?: () => void;
};

/**
 * Expanded tablet — linear flow with a back stack (no sidebar).
 */
export function TabletOverlay({ chrome = true, shellClassName, onClose }: TabletOverlayProps) {
  const navigate = useNavigate();
  const tabletSection = useLaboratoryStore((state) => state.tabletSection);
  const tabletHistory = useLaboratoryStore((state) => state.tabletHistory);
  const finishedAt = useLaboratoryStore((state) => state.finishedAt);
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const scoreEvents = useLaboratoryStore((state) => state.scoreEvents);
  const closeTablet = useLaboratoryStore((state) => state.closeTablet);
  const setTabletSection = useLaboratoryStore((state) => state.setTabletSection);
  const pushTabletSection = useLaboratoryStore((state) => state.pushTabletSection);
  const goBackTablet = useLaboratoryStore((state) => state.goBackTablet);
  const clearAssignment = useLaboratoryStore((state) => state.clearAssignment);
  const closeLocked = useLaboratoryStore(mustChooseExperiment);

  const [confirmingExit, setConfirmingExit] = useState(false);
  const [focusedStepId, setFocusedStepId] = useState<EntityId | null>(currentStepId);

  // Follow the store's current step/experiment — adjusted during render
  // instead of in an effect, so a stale focused step never briefly commits.
  const focusSyncKey = `${currentStepId ?? ""}:${selectedExperimentId ?? ""}`;
  const [lastFocusSyncKey, setLastFocusSyncKey] = useState(focusSyncKey);
  if (focusSyncKey !== lastFocusSyncKey) {
    setLastFocusSyncKey(focusSyncKey);
    setFocusedStepId(currentStepId);
  }

  useEffect(() => {
    if (isSectionLockedWithoutTask(tabletSection, selectedExperimentId)) {
      setTabletSection("tasks");
    }
  }, [tabletSection, selectedExperimentId, setTabletSection]);

  const experiment = getExperimentById(selectedExperimentId);
  const score = totalScore(scoreEvents);
  const showResults = Boolean(finishedAt && RESULT_TAKEOVER_SECTIONS.includes(tabletSection));
  const canGoBack = tabletSection !== "tasks" || tabletHistory.length > 0;

  const handleExitConfirmed = () => {
    navigate("/");
  };

  const handleClose = () => {
    // Pointer Lock may only be requested from a user activation. Run this
    // callback synchronously from the close-button click, before the tablet's
    // exit animation starts, so returning to mouse-look needs no extra click.
    onClose?.();
    closeTablet();
  };

  const renderContext = () => {
    switch (tabletSection) {
      case "tasks":
        return <TasksTab />;
      case "stages":
        return (
          <StagesTab
            focusedStepId={focusedStepId}
            onFocusStep={setFocusedStepId}
          />
        );
      case "theory":
        return <TheoryTab />;
      case "errors":
        return <ErrorsTab />;
      case "answer":
        return <EquationTab />;
      case "observations":
        return <ObservationsTab />;
      case "transfer":
        return <TransferTab />;
      case "settings":
        return <SettingsTab />;
      default:
        return null;
    }
  };

  const screen = (
    <div className="tablet-ui" style={frameStyle}>
      <div style={mainColumnStyle}>
        <header style={headerStyle}>
          <div style={headerLeftStyle}>
            {canGoBack && !showResults ? (
              <button
                type="button"
                style={iconButtonStyle}
                onClick={goBackTablet}
                aria-label="Назад"
                title="Назад"
              >
                <ArrowLeft size={18} />
              </button>
            ) : null}
            <span style={headerTitleStyle}>
              <FlaskConical size={20} color={colors.accentBright} />
              {confirmingExit ? "Выход" : showResults ? "Результат" : SECTION_TITLES[tabletSection]}
            </span>
          </div>
          <div style={headerRightStyle}>
            {selectedExperimentId ? (
              <div className="tablet-score-appear">
                <ScoreProgressBar score={score} maximumScore={experiment?.maximumScore ?? 0} />
              </div>
            ) : null}
            {selectedExperimentId ? (
              <button
                type="button"
                style={iconButtonStyle}
                onClick={clearAssignment}
                aria-label="Сброс опыта"
                title="Сброс опыта"
              >
                <RotateCcw size={18} />
              </button>
            ) : (
              <span style={headerSlotStyle} aria-hidden />
            )}
            <button
              type="button"
              style={iconButtonStyle}
              onClick={() => pushTabletSection("settings")}
              aria-label="Настройки"
              title="Настройки"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              style={textActionStyle}
              onClick={() => setConfirmingExit(true)}
            >
              Выход
            </button>
            <button
              style={closeLocked ? { ...closeButtonStyle, opacity: 0.35, cursor: "not-allowed" } : closeButtonStyle}
              onClick={closeLocked ? undefined : handleClose}
              disabled={closeLocked}
              aria-label={closeLocked ? "Сначала выберите опыт" : "Свернуть планшет"}
              title={closeLocked ? "Сначала выберите опыт" : undefined}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div style={workspaceStyle}>
          {!showResults ? (
            <div style={contextBodyStyle}>
              <div key={tabletSection} className="tablet-section-pane">
                {renderContext()}
              </div>
            </div>
          ) : null}

          {(confirmingExit || showResults) && (
            <div
              className="tablet-dialog-fade"
              style={contextOverlayStyle}
              role="dialog"
              aria-modal="true"
            >
              {confirmingExit ? (
                <div style={{ ...panelStyle, textAlign: "center", maxWidth: 360 }}>
                  <p style={{ margin: "0 0 16px", color: colors.textPrimary }}>
                    Выйти в главное меню? Прогресс текущей попытки будет потерян.
                  </p>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                    <button style={dangerButtonStyle} onClick={handleExitConfirmed}>
                      Да, выйти
                    </button>
                    <button style={ghostButtonStyle} onClick={() => setConfirmingExit(false)}>
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <ResultsPanel />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const content = <TabletCloseContext.Provider value={handleClose}>{screen}</TabletCloseContext.Provider>;
  if (!chrome) return content;
  return <TabletBezel className={shellClassName}>{content}</TabletBezel>;
}

const frameStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  height: "100%",
  minHeight: 0,
  paddingTop: "max(12px, env(safe-area-inset-top))",
  paddingRight: "max(14px, env(safe-area-inset-right))",
  paddingBottom: "max(14px, env(safe-area-inset-bottom))",
  paddingLeft: "max(14px, env(safe-area-inset-left))",
  backgroundColor: colors.bg,
  boxSizing: "border-box",
  fontFamily: typography.fontFamilyBase,
};

const mainColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexShrink: 0,
  minHeight: touch.minTarget,
  gap: 8,
};

const headerLeftStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  flex: 1,
};

const headerRightStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
  marginLeft: "auto",
};

const HEADER_BTN = 36;

const headerSlotStyle: CSSProperties = {
  width: HEADER_BTN,
  height: HEADER_BTN,
  flexShrink: 0,
};

const headerTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: typography.sizeTitle,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
};

const iconButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  width: HEADER_BTN,
  height: HEADER_BTN,
  minWidth: HEADER_BTN,
  minHeight: HEADER_BTN,
  padding: 0,
  borderRadius: 10,
  border: `1px solid ${colors.borderStrong}`,
  backgroundColor: colors.bgInset,
  color: colors.textPrimary,
  cursor: "pointer",
  flexShrink: 0,
};

const textActionStyle: CSSProperties = {
  ...iconButtonStyle,
  width: HEADER_BTN * 2,
  minWidth: HEADER_BTN * 2,
  padding: "0 8px",
  fontFamily: typography.fontFamilyBase,
  fontSize: 13,
  fontWeight: typography.weightMedium,
  color: colors.danger,
};

const closeButtonStyle: CSSProperties = {
  ...iconButtonStyle,
};

const workspaceStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const contextBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  display: "flex",
  flexDirection: "column",
};

const contextOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
  backgroundColor: "rgba(15, 23, 42, 0.82)",
  borderRadius: 14,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
};
