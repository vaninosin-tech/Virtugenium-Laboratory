import { BookOpen } from "lucide-react";

import { LABORATORY_CONTENT } from "../../../../data/content/experiments";
import { colors, formulaStyle, mutedTextStyle, panelStyle } from "../tabletStyles";

/** "Теория" — read-only reference material about the reagents in play. */
export function TheoryTab() {
  const reagents = LABORATORY_CONTENT.items.filter((item) => item.category === "reagent");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {reagents.map((reagent) => (
        <div key={reagent.id} style={{ ...panelStyle, display: "flex", gap: 10 }}>
          <BookOpen size={16} color={colors.accent} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h4 style={{ margin: 0, fontSize: 14, color: colors.textPrimary }}>
              {reagent.name} <span style={{ ...formulaStyle, color: colors.accent }}>({reagent.formula})</span>
            </h4>
            <p style={{ ...mutedTextStyle, margin: "4px 0 0" }}>{reagent.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
