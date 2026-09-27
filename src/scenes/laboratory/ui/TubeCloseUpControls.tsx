import type { CSSProperties } from "react";

import { useHeatingStore } from "../lib/useHeatingStore";
import { useTubeCloseUpStore } from "../lib/useTubeCloseUpStore";

/**
 * The way back out of the tube close-up. Hidden while heating: the heating
 * panel has its own «Отойти от штатива», and the close-up then belongs to it.
 */
export function TubeCloseUpControls() {
  const viewing = useTubeCloseUpStore((state) => state.viewing);
  const setViewing = useTubeCloseUpStore((state) => state.setViewing);
  const heating = useHeatingStore((state) => state.active);

  if (!viewing || heating) return null;
  return (
    <div style={panelStyle}>
      <span>Осмотр пробирки</span>
      <button type="button" style={buttonStyle} onClick={() => setViewing(false)}>
        Отойти
      </button>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  // Top, not bottom: the zone's own navigation buttons own the bottom edge,
  // and the flame under the tube sits low in the close-up frame.
  top: 70,
  transform: "translateX(-50%)",
  zIndex: 11,
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(56, 189, 248, 0.35)",
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(8, 14, 26, 0.94))",
  color: "#d6f3ff",
  fontSize: 13,
  fontWeight: 600,
};

const buttonStyle: CSSProperties = {
  padding: "6px 16px",
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.35)",
  backgroundColor: "rgba(15, 23, 42, 0.8)",
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
