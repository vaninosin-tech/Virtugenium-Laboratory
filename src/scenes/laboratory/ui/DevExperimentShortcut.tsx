import type { CSSProperties } from "react";

import { devSetupExperimentOne } from "../lib/devSetupExperiment";

/**
 * DEV-only shortcut past the whole preparation phase — see
 * `devSetupExperimentOne`. Rendered as its own button rather than a tab in
 * the F8 dev menu, which is for calibration sliders, not one-shot actions.
 */
export function DevExperimentShortcut() {
  if (!import.meta.env.DEV) return null;

  return (
    <button type="button" style={buttonStyle} onClick={devSetupExperimentOne}>
      Опыт 1: всё готово
    </button>
  );
}

const buttonStyle: CSSProperties = {
  position: "absolute",
  right: 20,
  bottom: 20,
  zIndex: 12,
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid rgba(250, 204, 21, 0.5)",
  backgroundColor: "rgba(66, 52, 10, 0.85)",
  color: "#fde68a",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
