import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, X } from "lucide-react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import type { TabletSection } from "../../../stores/laboratory/types";
import { getExperimentById, totalScore } from "../lib/experimentRuntime";
import { ResultsPanel } from "./ResultsPanel";
import { TabletSidebar } from "./TabletSidebar";
import { EquationTab } from "./tabs/EquationTab";
import { ErrorsTab } from "./tabs/ErrorsTab";
import { DescriptionTab } from "./tabs/DescriptionTab";
import { StagesTab } from "./tabs/StagesTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { TasksTab } from "./tabs/TasksTab";
import { TheoryTab } from "./tabs/TheoryTab";
import { colors, dangerButtonStyle, ghostButtonStyle, panelStyle, typography } from "./tabletStyles";

const SECTION_TITLES: Record<TabletSection, string> = {
  tasks: "Опыты",
  description: "Описание",
  stages: "Этапы",
  theory: "Теория",
  errors: "Ошибки",
  answer: "Ответ",
  settings: "Настройки",
};

/** Experiment-flow sections a finished attempt's results screen takes over. */
const RESULT_TAKEOVER_SECTIONS: readonly TabletSection[] = ["tasks", "description", "stages", "answer"];

/**
 * The tablet's expanded panel. Anchored top-left where the collapsed widget
 * sits, sized to leave most of the 3D scene visible rather than a full-screen
 * backdrop — everything from the ToR that's reachable through the tablet
 * (experiment checklist, reference book, exit-to-menu, settings) lives
 * behind the icon+label sidebar on the left.
 */
export function TabletOverlay() {
  const navigate = useNavigate();
  const tabletOpen = useLaboratoryStore((state) => state.tabletOpen);
  const tabletSection = useLaboratoryStore((state) => state.tabletSection);
  const finishedAt = useLaboratoryStore((state) => state.finishedAt);
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const scoreEvents = useLaboratoryStore((state) => state.scoreEvents);
  const errors = useLaboratoryStore((state) => state.errors);
  const closeTablet = useLaboratoryStore((state) => state.closeTablet);
  const setTabletSection = useLaboratoryStore((state) => state.setTabletSection);

  const [confirmingExit, setConfirmingExit] = useState(false);

  if (!tabletOpen) return null;

  const experiment = getExperimentById(selectedExperimentId);
  const score = totalScore(scoreEvents);

  const handleExitConfirmed = () => {
    navigate("/");
  };

  const renderBody = () => {
    if (confirmingExit) {
      return (
        <div style={{ ...panelStyle, textAlign: "center", margin: "auto" }}>
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
      );
    }

    if (finishedAt && RESULT_TAKEOVER_SECTIONS.includes(tabletSection)) {
      return <ResultsPanel />;
    }

    switch (tabletSection) {
      case "tasks":
        return <TasksTab />;
      case "description":
        return <DescriptionTab onGoToTasks={() => setTabletSection("tasks")} />;
      case "stages":
        return <StagesTab onGoToTasks={() => setTabletSection("tasks")} />;
      case "theory":
        return <TheoryTab />;
      case "errors":
        return <ErrorsTab />;
      case "answer":
        return <EquationTab />;
      case "settings":
        return <SettingsTab />;
      default:
        return null;
    }
  };

  return (
    <div style={frameStyle}>
      <TabletSidebar
        activeSection={tabletSection}
        onSelect={setTabletSection}
        errorCount={errors.length}
        score={score}
        maximumScore={experiment?.maximumScore ?? 0}
        onRequestExit={() => setConfirmingExit(true)}
      />

      <div style={contentColumnStyle}>
        <header style={headerStyle}>
          <span style={headerTitleStyle}>
            <FlaskConical size={16} color={colors.accent} />
            {confirmingExit ? "Выход" : SECTION_TITLES[tabletSection]}
          </span>
          <button style={closeButtonStyle} onClick={closeTablet} aria-label="Закрыть планшет">
            <X size={16} />
          </button>
        </header>

        <div style={bodyStyle}>{renderBody()}</div>
      </div>
    </div>
  );
}

const frameStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  left: 20,
  zIndex: 30,
  display: "flex",
  gap: 16,
  width: 780,
  maxWidth: "calc(100vw - 40px)",
  height: 560,
  maxHeight: "calc(100vh - 40px)",
  padding: 16,
  backgroundColor: colors.bg,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: 14,
  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
  // Applied once here rather than per-component — every tablet element
  // inherits IBM Plex Sans by default; the few technical-readout spots
  // (formulas, scores) opt into JetBrains Mono explicitly instead.
  fontFamily: typography.fontFamilyBase,
};

const contentColumnStyle: CSSProperties = {
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
};

const headerTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 15,
  // SemiBold per the typography scale — this is the compact per-tab header
  // bar, not a full screen title, so it keeps its existing 15px rather than
  // the 26-30px "screen title" size (see `screenTitleStyle`), which would
  // need the bar's own height/spacing redesigned to fit.
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
};

const closeButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgInset,
  color: colors.textMuted,
  cursor: "pointer",
};

const bodyStyle: CSSProperties = {
  overflowY: "auto",
  flex: 1,
  paddingRight: 4,
  display: "flex",
  flexDirection: "column",
};
