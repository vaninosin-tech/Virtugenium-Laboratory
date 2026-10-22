import { useState, type CSSProperties } from "react";
import { CheckCircle2, Circle } from "lucide-react";

import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import { LABORATORY_CONTENT } from "../../../../data/content/experiments";
import { getItemById } from "../../lib/experimentRuntime";
import { badgeStyle, colors, mutedTextStyle, panelStyle, primaryButtonStyle, sectionTitleStyle } from "../tabletStyles";

/** "Опыты" — master-detail: pick one of the four ToR experiments to work on. */
export function TasksTab() {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const completedExperimentIds = useLaboratoryStore((state) => state.completedExperimentIds);
  const selectExperiment = useLaboratoryStore((state) => state.selectExperiment);
  const setCurrentStep = useLaboratoryStore((state) => state.setCurrentStep);
  const setTabletSection = useLaboratoryStore((state) => state.setTabletSection);

  const [previewId, setPreviewId] = useState(
    selectedExperimentId ?? LABORATORY_CONTENT.experiments[0]?.id ?? null,
  );

  const previewed = LABORATORY_CONTENT.experiments.find((experiment) => experiment.id === previewId) ?? null;
  const isActive = previewed !== null && previewed.id === selectedExperimentId;

  const handleStart = () => {
    if (!previewed) return;
    selectExperiment(previewed.id);
    setCurrentStep(previewed.steps[0]?.id ?? null);
    setTabletSection("description");
  };

  return (
    <div style={layoutStyle}>
      <div style={listStyle}>
        {LABORATORY_CONTENT.experiments.map((experiment) => {
          const isSelected = experiment.id === selectedExperimentId;
          const isCompleted = completedExperimentIds.includes(experiment.id);
          const isPreviewed = experiment.id === previewId;

          return (
            <button
              key={experiment.id}
              data-testid={`task-preview-${experiment.id}`}
              onClick={() => setPreviewId(experiment.id)}
              style={{
                ...listItemStyle,
                borderColor: isPreviewed ? colors.borderStrong : colors.border,
                backgroundColor: isPreviewed ? colors.accentSoft : colors.bgInset,
              }}
            >
              {isCompleted ? (
                <CheckCircle2 size={16} color={colors.success} />
              ) : (
                <Circle size={16} color={colors.textMuted} />
              )}
              <span style={listItemTitleStyle}>{experiment.title}</span>
              {isSelected && <span style={badgeStyle("accent")}>активен</span>}
            </button>
          );
        })}
      </div>

      {previewed && (
        <div style={detailStyle}>
          <h3 style={sectionTitleStyle}>{previewed.title}</h3>
          <p style={{ ...mutedTextStyle, margin: "8px 0 0" }}>{previewed.description}</p>

          <div style={metaRowStyle}>
            <span style={badgeStyle("neutral")}>Максимум баллов: {previewed.maximumScore}</span>
            <span style={badgeStyle("neutral")}>Шагов: {previewed.steps.length}</span>
            {completedExperimentIds.includes(previewed.id) && (
              <span style={badgeStyle("success")}>пройден</span>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <span style={{ ...mutedTextStyle, fontWeight: 600 }}>Потребуется:</span>
            <p style={{ ...mutedTextStyle, margin: "4px 0 0" }}>
              {previewed.requiredItemIds.map((id) => getItemById(id)?.name ?? id).join(", ")}
            </p>
          </div>

          <button
            data-testid={`task-start-${previewed.id}`}
            style={{ ...primaryButtonStyle, marginTop: 16, alignSelf: "flex-start" }}
            onClick={handleStart}
          >
            {isActive ? "Продолжить" : "Начать опыт"}
          </button>
        </div>
      )}
    </div>
  );
}

const layoutStyle: CSSProperties = {
  display: "flex",
  gap: 14,
  flex: 1,
  minHeight: 0,
};

const listStyle: CSSProperties = {
  width: 220,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  overflowY: "auto",
};

const listItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid",
  cursor: "pointer",
  textAlign: "left",
};

const listItemTitleStyle: CSSProperties = {
  flex: 1,
  fontSize: 12,
  fontWeight: 600,
  color: colors.textPrimary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const detailStyle: CSSProperties = {
  ...panelStyle,
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
};

const metaRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 12,
};
