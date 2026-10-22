import { AlertTriangle, ShieldCheck } from "lucide-react";

import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import { colors, mutedTextStyle, panelStyle } from "../tabletStyles";

const ERROR_LABELS: Record<string, string> = {
  "invalid-data": "Некорректные данные",
  "item-not-found": "Предмет не найден",
  "action-not-allowed": "Действие недопустимо на этом шаге",
  "wrong-order": "Нарушен порядок действий",
  "safety-violation": "Нарушение техники безопасности",
  "incorrect-equation": "Неверное уравнение реакции",
};

/**
 * "Ошибки" — live per-attempt mistake log. Empty today because nothing yet
 * produces `LaboratoryError` entries (that lands with the real 3D
 * pour/heat/PPE/fume-hood interactions) — the display itself is real and
 * ready for that.
 */
export function ErrorsTab() {
  const errors = useLaboratoryStore((state) => state.errors);

  if (errors.length === 0) {
    return (
      <div style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <ShieldCheck size={18} color={colors.success} />
        <p style={{ ...mutedTextStyle, margin: 0 }}>Ошибок пока нет — так держать.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {errors.map((error, index) => (
        <div
          key={`${error.code}-${index}`}
          style={{ ...panelStyle, borderColor: "rgba(248, 113, 113, 0.4)", display: "flex", gap: 10 }}
        >
          <AlertTriangle size={16} color={colors.danger} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h4 style={{ margin: 0, fontSize: 13, color: colors.danger }}>
              {ERROR_LABELS[error.code] ?? error.code}
            </h4>
            <p style={{ ...mutedTextStyle, margin: "4px 0 0" }}>{error.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
