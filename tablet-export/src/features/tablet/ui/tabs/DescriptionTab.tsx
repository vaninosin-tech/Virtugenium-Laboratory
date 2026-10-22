import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import { getExperimentById, getItemById } from "../../lib/experimentRuntime";
import { badgeStyle, formulaStyle, mutedTextStyle, panelStyle, primaryButtonStyle, sectionTitleStyle } from "../tabletStyles";

/** "Описание" — full brief for the active experiment: goal, required items, scoring cap. */
export function DescriptionTab({ onGoToTasks }: { readonly onGoToTasks: () => void }) {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={panelStyle}>
        <h3 style={sectionTitleStyle}>{experiment.title}</h3>
        <p style={{ ...mutedTextStyle, margin: "8px 0 0" }}>{experiment.description}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <span style={badgeStyle("neutral")}>Максимум баллов: {experiment.maximumScore}</span>
          <span style={badgeStyle("neutral")}>Шагов: {experiment.steps.length}</span>
        </div>
      </div>

      <div style={panelStyle}>
        <h4 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
          Необходимые реактивы и оборудование
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {experiment.requiredItemIds.map((id) => {
            const item = getItemById(id);
            return (
              <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...mutedTextStyle, color: "#e2e8f0" }}>{item?.name ?? id}</span>
                {item && "formula" in item && item.formula && (
                  <span style={{ ...mutedTextStyle, ...formulaStyle }}>{item.formula}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
