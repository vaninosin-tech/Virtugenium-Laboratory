import type { CSSProperties } from "react";

import {
  useNavButtonCalibrationStore,
  type InspectionBottleConfig,
  type InspectionButtonConfig,
  type InspectionButtonSide,
  type NavButtonConfig,
  type NavButtonKey,
} from "../lib/useNavButtonCalibrationStore";
import { NumberField } from "./devmenu/NumberField";

const BUTTONS: { key: NavButtonKey; label: string }[] = [
  { key: "left", label: "LEFT BUTTON" },
  { key: "right", label: "RIGHT BUTTON" },
  { key: "bottom", label: "BOTTOM BUTTON" },
];

const FIELDS: { field: keyof NavButtonConfig; label: string; min: number; max: number }[] = [
  { field: "buttonWidth", label: "Button W", min: 20, max: 400 },
  { field: "buttonHeight", label: "Button H", min: 20, max: 400 },
  { field: "triangleWidth", label: "Icon W", min: 4, max: 200 },
  { field: "triangleHeight", label: "Icon H", min: 4, max: 200 },
];

const SIDE_DISTANCE_MIN = 40;
const SIDE_DISTANCE_MAX = 400;

const INSPECTION_BUTTON_SIDES: { key: InspectionButtonSide; label: string }[] = [
  { key: "left", label: "ОСТАВИТЬ" },
  { key: "right", label: "ВЗЯТЬ" },
];

const INSPECTION_FIELDS: { field: keyof InspectionButtonConfig; label: string; min: number; max: number }[] = [
  { field: "width", label: "Width", min: 100, max: 600 },
  { field: "height", label: "Height", min: 30, max: 220 },
  { field: "offsetX", label: "Offset X", min: -600, max: 600 },
  { field: "top", label: "Top %", min: 30, max: 95 },
  { field: "fontSize", label: "Text Size", min: 10, max: 48 },
];

const INSPECTION_BOTTLE_FIELDS: { field: keyof InspectionBottleConfig; label: string; min: number; max: number; step: number }[] = [
  { field: "x", label: "Bottle X", min: -1, max: 1, step: 0.01 },
  { field: "y", label: "Bottle Y", min: -1, max: 1, step: 0.01 },
  { field: "z", label: "Bottle Z", min: 0.2, max: 2, step: 0.01 },
  { field: "scale", label: "Scale", min: 0.2, max: 6, step: 0.05 },
];

/**
 * Dev-only nav-button calibration HUD (F9), independent from the F8 camera
 * calibration panel (`CameraCalibrationPanel`). Edits `useNavButtonCalibrationStore`
 * directly, which `InspectionControls` reads live — no draft/commit split needed
 * since button/triangle size has no expensive side effect to preview.
 */
export function NavButtonCalibrationPanel() {
  const isOpen = useNavButtonCalibrationStore((state) => state.isOpen);
  const selected = useNavButtonCalibrationStore((state) => state.selected);
  const values = useNavButtonCalibrationStore((state) => state.values);
  const sideDistance = useNavButtonCalibrationStore((state) => state.sideDistance);
  const setOpen = useNavButtonCalibrationStore((state) => state.setOpen);
  const setSelected = useNavButtonCalibrationStore((state) => state.setSelected);
  const setField = useNavButtonCalibrationStore((state) => state.setField);
  const setSideDistance = useNavButtonCalibrationStore((state) => state.setSideDistance);
  const inspectionButtons = useNavButtonCalibrationStore((state) => state.inspectionButtons);
  const selectedInspectionButton = useNavButtonCalibrationStore((state) => state.selectedInspectionButton);
  const setSelectedInspectionButton = useNavButtonCalibrationStore((state) => state.setSelectedInspectionButton);
  const setInspectionButtonField = useNavButtonCalibrationStore((state) => state.setInspectionButtonField);
  const resetCurrentInspectionButton = useNavButtonCalibrationStore((state) => state.resetCurrentInspectionButton);
  const inspectionBottle = useNavButtonCalibrationStore((state) => state.inspectionBottle);
  const setInspectionBottleField = useNavButtonCalibrationStore((state) => state.setInspectionBottleField);
  const resetInspectionBottle = useNavButtonCalibrationStore((state) => state.resetInspectionBottle);
  const save = useNavButtonCalibrationStore((state) => state.save);
  const resetCurrent = useNavButtonCalibrationStore((state) => state.resetCurrent);
  const resetAll = useNavButtonCalibrationStore((state) => state.resetAll);

  if (!import.meta.env.DEV || !isOpen) return null;

  const config = values[selected];
  const inspectionConfig = inspectionButtons[selectedInspectionButton];

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        NAV BUTTON CALIBRATION
        <button onClick={() => setOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {BUTTONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            style={{ ...tabBtnStyle, ...(selected === key ? activeTabBtnStyle : undefined) }}
          >
            {label.replace(" BUTTON", "")}
          </button>
        ))}
      </div>

      <div style={sectionLabelStyle}>{BUTTONS.find((b) => b.key === selected)?.label}</div>

      {FIELDS.map(({ field, label, min, max }) => (
        <div key={field} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button style={stepBtnStyle} onClick={() => setField(selected, field, Math.max(min, config[field] - 1))}>
              −
            </button>
            <NumberField value={config[field]} onCommit={(value) => setField(selected, field, value)} style={numberInputStyle} />
            <button style={stepBtnStyle} onClick={() => setField(selected, field, Math.min(max, config[field] + 1))}>
              +
            </button>
            <input
              type="range"
              min={min}
              max={max}
              value={config[field]}
              onChange={(event) => setField(selected, field, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      ))}

      <div style={sectionLabelStyle}>SIDE BUTTON DISTANCE</div>
      <div style={rowStyle}>
        <span style={labelStyle}>Distance</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            style={stepBtnStyle}
            onClick={() => setSideDistance(Math.max(SIDE_DISTANCE_MIN, sideDistance - 2))}
          >
            −
          </button>
          <NumberField value={sideDistance} onCommit={setSideDistance} style={numberInputStyle} />
          <button
            style={stepBtnStyle}
            onClick={() => setSideDistance(Math.min(SIDE_DISTANCE_MAX, sideDistance + 2))}
          >
            +
          </button>
          <input
            type="range"
            min={SIDE_DISTANCE_MIN}
            max={SIDE_DISTANCE_MAX}
            value={sideDistance}
            onChange={(event) => setSideDistance(parseFloat(event.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>
      <div style={noteStyle}>Двигает LEFT и RIGHT зеркально от центра — раздельной настройки нет.</div>

      <div style={sectionLabelStyle}>INSPECTION BUTTONS</div>
      <div style={{ display: "flex", gap: 6 }}>
        {INSPECTION_BUTTON_SIDES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSelectedInspectionButton(key)}
            style={{ ...tabBtnStyle, ...(selectedInspectionButton === key ? activeTabBtnStyle : undefined) }}
          >
            {label}
          </button>
        ))}
      </div>
      {INSPECTION_FIELDS.map(({ field, label, min, max }) => (
        <div key={field} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              style={stepBtnStyle}
              onClick={() =>
                setInspectionButtonField(
                  selectedInspectionButton,
                  field,
                  Math.max(min, inspectionConfig[field] - 1),
                )
              }
            >
              −
            </button>
            <NumberField
              value={inspectionConfig[field]}
              onCommit={(value) => setInspectionButtonField(selectedInspectionButton, field, value)}
              style={numberInputStyle}
            />
            <button
              style={stepBtnStyle}
              onClick={() =>
                setInspectionButtonField(
                  selectedInspectionButton,
                  field,
                  Math.min(max, inspectionConfig[field] + 1),
                )
              }
            >
              +
            </button>
            <input
              type="range"
              min={min}
              max={max}
              value={inspectionConfig[field]}
              onChange={(event) => setInspectionButtonField(selectedInspectionButton, field, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btnStyle} onClick={resetCurrentInspectionButton}>
          RESET CURRENT
        </button>
      </div>

      <div style={sectionLabelStyle}>INSPECTION BOTTLE POSITION</div>
      {INSPECTION_BOTTLE_FIELDS.map(({ field, label, min, max, step }) => (
        <div key={field} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              style={stepBtnStyle}
              onClick={() => setInspectionBottleField(field, Math.max(min, Number((inspectionBottle[field] - step).toFixed(2))))}
            >
              −
            </button>
            <NumberField
              value={inspectionBottle[field]}
              step={step}
              onCommit={(value) => setInspectionBottleField(field, value)}
              style={numberInputStyle}
            />
            <button
              style={stepBtnStyle}
              onClick={() => setInspectionBottleField(field, Math.min(max, Number((inspectionBottle[field] + step).toFixed(2))))}
            >
              +
            </button>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={inspectionBottle[field]}
              onChange={(event) => setInspectionBottleField(field, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={saveBtnStyle}
          onClick={save}
        >
          SAVE
        </button>
        <button
          style={btnStyle}
          onClick={() => {
            const text = JSON.stringify({ inspectionBottle }, null, 2);
            void navigator.clipboard?.writeText(text).catch(() => {});
          }}
        >
          COPY VALUES
        </button>
        <button style={btnStyle} onClick={resetInspectionBottle}>
          RESET
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button style={saveBtnStyle} onClick={save}>
          SAVE
        </button>
        <button
          style={btnStyle}
          onClick={() => {
            const text = JSON.stringify({ values, sideDistance, inspectionButtons, inspectionBottle }, null, 2);
            void navigator.clipboard?.writeText(text).catch(() => {});
          }}
        >
          COPY VALUES
        </button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btnStyle} onClick={resetCurrent}>
          RESET CURRENT
        </button>
        <button style={btnStyle} onClick={resetAll}>
          RESET ALL
        </button>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  right: 20,
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

const sectionLabelStyle: CSSProperties = {
  color: "#facc15",
  fontWeight: 700,
  fontSize: 11,
  marginTop: 2,
};

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

const tabBtnStyle: CSSProperties = { ...btnStyle };

const activeTabBtnStyle: CSSProperties = {
  backgroundColor: "#38bdf8",
  color: "#0f172a",
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
