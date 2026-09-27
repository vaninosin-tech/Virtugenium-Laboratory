import type { CSSProperties } from "react";
import { Check, Shield } from "lucide-react";

import type { EntityId } from "../../../entities/laboratory";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";

const PPE_BADGES: readonly { readonly id: EntityId; readonly short: string }[] = [
  { id: "safety-coat", short: "Халат" },
  { id: "safety-goggles", short: "Очки" },
  { id: "safety-gloves", short: "Перчатки" },
];

/**
 * Worn PPE has nothing to render in a game with no visible body or hands, so
 * it is reported as a status badge only. Deliberately NOT a goggles vignette:
 * anything drawn over the viewport would make the player see the lab worse
 * for having followed the safety rules.
 */
export function PPEStatusOverlay() {
  const inventoryItemIds = useLaboratoryStore((state) => state.inventoryItemIds);
  const anyWorn = PPE_BADGES.some((badge) => inventoryItemIds.includes(badge.id));

  return (
    <>
      {anyWorn ? (
        <div style={badgeRowStyle} aria-label="Надетые средства защиты">
          {PPE_BADGES.map((badge) => {
            const worn = inventoryItemIds.includes(badge.id);
            return (
              <span key={badge.id} style={badgeStyle(worn)}>
                {worn ? <Check size={13} aria-hidden /> : <Shield size={13} aria-hidden />}
                {badge.short}
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

const badgeRowStyle: CSSProperties = {
  position: "absolute",
  left: 20,
  bottom: 20,
  zIndex: 10,
  display: "flex",
  gap: 6,
  pointerEvents: "none",
};

const badgeStyle = (worn: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  border: `1px solid ${worn ? "rgba(110, 231, 168, 0.5)" : "rgba(148, 163, 184, 0.3)"}`,
  backgroundColor: worn ? "rgba(18, 53, 36, 0.8)" : "rgba(15, 23, 42, 0.75)",
  color: worn ? "#6ee7a8" : "#94a3b8",
});
