import type { CSSProperties } from "react";
import { MathUtils } from "three";

import { useNavButtonCalibrationStore, type HeldTrayConfig } from "../lib/useNavButtonCalibrationStore";
import { NumberField } from "./devmenu/NumberField";

type HeldTrayFieldDefinition = {
  field: keyof HeldTrayConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: "degrees";
};

const HELD_TRAY_FIELDS: HeldTrayFieldDefinition[] = [
  { field: "x", label: "Tray X", min: -1.5, max: 1.5, step: 0.01 },
  { field: "y", label: "Tray Y", min: -1.5, max: 1.5, step: 0.01 },
  { field: "z", label: "Tray Z", min: 0.1, max: 2, step: 0.01 },
  { field: "scale", label: "Tray Scale", min: 0.2, max: 3, step: 0.05 },
  { field: "rotX", label: "Rot X (°)", min: -180, max: 180, step: 1, unit: "degrees" },
  { field: "rotY", label: "Rot Y (°)", min: -180, max: 180, step: 1, unit: "degrees" },
  { field: "rotZ", label: "Rot Z (°)", min: -180, max: 180, step: 1, unit: "degrees" },
  // World scale of a REAGENT sitting on the tray — independent of the tray
  // model's own scale above. Read live (not captured once), so this applies
  // instantly to reagents already on the tray while tuning.
  { field: "reagentScale", label: "Reagent Scale", min: 0.05, max: 2, step: 0.02 },
];

function toControlValue(value: number, unit: HeldTrayFieldDefinition["unit"]): number {
  return unit === "degrees" ? MathUtils.radToDeg(value) : value;
}

function fromControlValue(value: number, unit: HeldTrayFieldDefinition["unit"]): number {
  return unit === "degrees" ? MathUtils.degToRad(value) : value;
}

/**
 * Dev-only standalone HUD (F10) for the HELD tray's camera-relative
 * transform — pulled out of the F9 nav-button panel into its own toggle so
 * it's reachable without opening/scrolling past the unrelated nav-button
 * and inspection-button sections. Edits the same `heldTray` field on
 * `useNavButtonCalibrationStore` that `LabTrayInstance` reads live; SAVE
 * persists the whole store (shared with F9), same as every other section.
 */
export function TrayCalibrationPanel() {
  const isOpen = useNavButtonCalibrationStore((state) => state.isTrayPanelOpen);
  const heldTray = useNavButtonCalibrationStore((state) => state.heldTray);
  const setOpen = useNavButtonCalibrationStore((state) => state.setTrayPanelOpen);
  const setHeldTrayField = useNavButtonCalibrationStore((state) => state.setHeldTrayField);
  const resetHeldTray = useNavButtonCalibrationStore((state) => state.resetHeldTray);
  const save = useNavButtonCalibrationStore((state) => state.save);

  if (!import.meta.env.DEV || !isOpen) return null;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        ПОДНОС — ПОЗИЦИЯ В РУКАХ
        <button onClick={() => setOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      </div>
      <div style={noteStyle}>Камера-относительная позиция подноса, пока держится в руках.</div>

      {HELD_TRAY_FIELDS.map(({ field, label, min, max, step, unit }) => (
        <div key={field} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              style={stepBtnStyle}
              onClick={() =>
                setHeldTrayField(
                  field,
                  fromControlValue(
                    Math.max(min, Number((toControlValue(heldTray[field], unit) - step).toFixed(2))),
                    unit,
                  ),
                )
              }
            >
              −
            </button>
            <NumberField
              value={Number(toControlValue(heldTray[field], unit).toFixed(unit === "degrees" ? 1 : 2))}
              step={step}
              onCommit={(value) => setHeldTrayField(field, fromControlValue(value, unit))}
              style={numberInputStyle}
            />
            <button
              style={stepBtnStyle}
              onClick={() =>
                setHeldTrayField(
                  field,
                  fromControlValue(
                    Math.min(max, Number((toControlValue(heldTray[field], unit) + step).toFixed(2))),
                    unit,
                  ),
                )
              }
            >
              +
            </button>
            <input
              type="range"
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={toControlValue(heldTray[field], unit)}
              onChange={(event) =>
                setHeldTrayField(field, fromControlValue(parseFloat(event.target.value), unit))
              }
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
            const text = JSON.stringify({ heldTray }, null, 2);
            void navigator.clipboard?.writeText(text).catch(() => {});
          }}
        >
          COPY VALUES
        </button>
        <button style={btnStyle} onClick={resetHeldTray}>
          RESET
        </button>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  left: 20,
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

const labelStyle: CSSProperties = { color: "#94a3b8", width: 72, flexShrink: 0 };

const noteStyle: CSSProperties = {
  fontSize: 10,
  color: "#94a3b8",
  lineHeight: 1.3,
};

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
