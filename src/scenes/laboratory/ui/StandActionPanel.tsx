import type { CSSProperties } from "react";

import { useHeatingStore } from "../lib/useHeatingStore";
import { useStandStationStore } from "../lib/useStandStationStore";

/**
 * The way out of the stand's close-up. The close-up is for watching the
 * reaction; it has no menu of actions any more — everything done at the
 * stand is a click on the object it is done with, captioned on hover
 * (VL-014, `standTableActions`, `StandActionHint`).
 */
export function StandActionPanel() {
  const open = useStandStationStore((state) => state.viewing);
  const close = useStandStationStore((state) => state.close);
  const heating = useHeatingStore((state) => state.active);

  if (!open || heating) return null;
  return (
    <button type="button" style={leaveStyle} onClick={close} data-testid="stand-leave">
      Отойти от штатива
    </button>
  );
}

const leaveStyle: CSSProperties = {
  position: "absolute",
  right: 20,
  top: 20,
  zIndex: 11,
  padding: "9px 14px",
  borderRadius: 10,
  border: "1px solid rgba(56, 189, 248, 0.45)",
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(8, 14, 26, 0.95))",
  boxShadow: "0 0 18px rgba(56, 189, 248, 0.15)",
  color: "#d6f3ff",
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
