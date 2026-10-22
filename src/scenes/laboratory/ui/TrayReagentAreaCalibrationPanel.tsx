import type { CSSProperties } from "react";

import { useTrayReagentAreaStore, type TrayReagentAreaConfig } from "../lib/useTrayReagentAreaStore";
import { NumberField } from "./devmenu/NumberField";

const FIELDS: { field: keyof TrayReagentAreaConfig; label: string; min: number; max: number; step: number }[] = [
  { field: "originX", label: "Origin X", min: -0.3, max: 0.3, step: 0.005 },
  { field: "originY", label: "Origin Y", min: 0, max: 0.2, step: 0.005 },
  { field: "originZ", label: "Origin Z", min: -0.2, max: 0.2, step: 0.005 },
  { field: "spacingX", label: "Spacing X", min: 0.03, max: 0.3, step: 0.005 },
  { field: "spacingZ", label: "Spacing Z", min: 0.03, max: 0.3, step: 0.005 },
  { field: "rotationY", label: "Rotation Y", min: -Math.PI, max: Math.PI, step: 0.02 },
];

/**
 * Dev-only standalone HUD (F8 → "Реагенты на подносе") for the 8 reagent
 * slots on the HELD tray — see `useTrayReagentAreaStore`'s doc for why the
 * default origin is biased right of the stopper holder. Same field-row
 * pattern as `WorkbenchReagentAreaCalibrationPanel`.
 */
export function TrayReagentAreaCalibrationPanel() {
  const isOpen = useTrayReagentAreaStore((state) => state.isOpen);
  const config = useTrayReagentAreaStore((state) => state.config);
  const setOpen = useTrayReagentAreaStore((state) => state.setOpen);
  const setField = useTrayReagentAreaStore((state) => state.setField);
  const save = useTrayReagentAreaStore((state) => state.save);
  const resetAll = useTrayReagentAreaStore((state) => state.resetAll);

  if (!import.meta.env.DEV || !isOpen) return null;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        РЕАГЕНТЫ НА ПОДНОСЕ
        <button onClick={() => setOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      </div>

      {FIELDS.map(({ field, label, min, max, step }) => (
        <div key={field} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              style={stepBtnStyle}
              onClick={() => setField(field, Math.max(min, Number((config[field] - step).toFixed(3))))}
            >
              −
            </button>
            <NumberField
              value={config[field]}
              step={step}
              onCommit={(value) => setField(field, value)}
              style={numberInputStyle}
            />
            <button
              style={stepBtnStyle}
              onClick={() => setField(field, Math.min(max, Number((config[field] + step).toFixed(3))))}
            >
              +
            </button>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={config[field]}
              onChange={(event) => setField(field, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button style={saveBtnStyle} onClick={save}>
          SAVE
        </button>
        <button
          style={btnStyle}
          onClick={() => {
            const text = JSON.stringify({ config }, null, 2);
            void navigator.clipboard?.writeText(text).catch(() => {});
          }}
        >
          COPY VALUES
        </button>
        <button style={btnStyle} onClick={resetAll}>
          RESET
        </button>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  left: 860,
  zIndex: 20,
  width: 260,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  backgroundColor: "rgba(15, 23, 42, 0.92)",
  padding: "12px 14px",
  borderRadius: 10,
  color: "#e2e8f0",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  fontSize: 12,
  fontFamily: "monospace",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontWeight: 700,
  fontSize: 13,
  color: "#38bdf8",
};

const closeBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 14,
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const labelStyle: CSSProperties = { color: "#94a3b8", width: 78, flexShrink: 0 };

const btnStyle: CSSProperties = {
  flex: 1,
  backgroundColor: "rgba(56, 189, 248, 0.12)",
  color: "#38bdf8",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 11,
  padding: "4px 8px",
};

const saveBtnStyle: CSSProperties = {
  ...btnStyle,
  backgroundColor: "#22c55e",
  color: "#0f172a",
  border: "1px solid #22c55e",
};

const stepBtnStyle: CSSProperties = {
  backgroundColor: "rgba(56, 189, 248, 0.12)",
  color: "#38bdf8",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  width: 20,
  height: 20,
  lineHeight: 1,
  padding: 0,
};

const numberInputStyle: CSSProperties = {
  width: 48,
  backgroundColor: "rgba(15, 23, 42, 0.9)",
  color: "#e2e8f0",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  fontSize: 11,
  padding: "3px 4px",
};

const sliderStyle: CSSProperties = {
  flex: 1,
  minWidth: 40,
};
