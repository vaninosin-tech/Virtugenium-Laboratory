import type { CSSProperties } from "react";

import {
  useStopperHolderStore,
  type HolderInspectionStageConfig,
  type StopperHolderConfig,
  type StopperHolderKey,
} from "../lib/useStopperHolderStore";
import { NumberField } from "./devmenu/NumberField";

/** Only the workbench rack is still dev-tunable — the tray one is glued fixed into `LabTray_Metal.glb`, see `TRAY_RACK_ANCHOR`. */
const HOLDER_TABS: { key: StopperHolderKey; label: string }[] = [
  { key: "workbench", label: "WORKBENCH HOLDER" },
];

const FIELDS: { field: keyof StopperHolderConfig; label: string; min: number; max: number; step: number }[] = [
  { field: "x", label: "X", min: -1.5, max: 1.5, step: 0.01 },
  { field: "y", label: "Y", min: -0.5, max: 1.5, step: 0.01 },
  { field: "z", label: "Z", min: -1.5, max: 1.5, step: 0.01 },
  { field: "rotX", label: "Rot X", min: -Math.PI, max: Math.PI, step: 0.02 },
  { field: "rotY", label: "Rot Y", min: -Math.PI, max: Math.PI, step: 0.02 },
  { field: "rotZ", label: "Rot Z", min: -Math.PI, max: Math.PI, step: 0.02 },
  { field: "scale", label: "Scale", min: 0.2, max: 3, step: 0.05 },
];

/** Camera-relative — see `HolderInspectionStageConfig`'s own doc for the convention. */
const INSPECTION_STAGE_FIELDS: { field: keyof HolderInspectionStageConfig; label: string; min: number; max: number; step: number }[] = [
  { field: "x", label: "X", min: -1, max: 1, step: 0.01 },
  { field: "y", label: "Y", min: -1, max: 1, step: 0.01 },
  { field: "z", label: "Z", min: 0.3, max: 2.5, step: 0.01 },
  { field: "tiltX", label: "Tilt X", min: -Math.PI / 2, max: Math.PI / 2, step: 0.02 },
  { field: "scale", label: "Scale", min: 0.2, max: 3, step: 0.05 },
];

/**
 * Dev-only standalone HUD (F11) for the two `LabStopperHolder` placements —
 * `WORKBENCH HOLDER` (world-ish offset off `LAYOUT.table.position`) and
 * `TRAY HOLDER` (local offset inside the tray's own animated group). Same
 * tab + field-row pattern as `NavButtonCalibrationPanel`/`TrayCalibrationPanel`.
 */
export function StopperHolderCalibrationPanel() {
  const isOpen = useStopperHolderStore((state) => state.isOpen);
  const selected = useStopperHolderStore((state) => state.selected);
  const holders = useStopperHolderStore((state) => state.holders);
  const inspectionStage = useStopperHolderStore((state) => state.inspectionStage);
  const setOpen = useStopperHolderStore((state) => state.setOpen);
  const setSelected = useStopperHolderStore((state) => state.setSelected);
  const setField = useStopperHolderStore((state) => state.setField);
  const setInspectionStageField = useStopperHolderStore((state) => state.setInspectionStageField);
  const save = useStopperHolderStore((state) => state.save);
  const resetCurrent = useStopperHolderStore((state) => state.resetCurrent);
  const resetInspectionStage = useStopperHolderStore((state) => state.resetInspectionStage);
  const resetAll = useStopperHolderStore((state) => state.resetAll);

  if (!import.meta.env.DEV || !isOpen) return null;

  const config = holders[selected];

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        STOPPER HOLDERS
        <button onClick={() => setOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {HOLDER_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            style={{ ...tabBtnStyle, ...(selected === key ? activeTabBtnStyle : undefined) }}
          >
            {label.replace(" HOLDER", "")}
          </button>
        ))}
      </div>

      <div style={sectionLabelStyle}>{HOLDER_TABS.find((t) => t.key === selected)?.label}</div>

      {FIELDS.map(({ field, label, min, max, step }) => (
        <div key={field} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              style={stepBtnStyle}
              onClick={() => setField(selected, field, Math.max(min, Number((config[field] - step).toFixed(2))))}
            >
              −
            </button>
            <NumberField
              value={config[field]}
              step={step}
              onCommit={(value) => setField(selected, field, value)}
              style={numberInputStyle}
            />
            <button
              style={stepBtnStyle}
              onClick={() => setField(selected, field, Math.min(max, Number((config[field] + step).toFixed(2))))}
            >
              +
            </button>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={config[field]}
              onChange={(event) => setField(selected, field, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      ))}

      <div style={sectionLabelStyle}>ОСМОТР: КУДА ЛЕТИТ ДЕРЖАТЕЛЬ</div>

      {INSPECTION_STAGE_FIELDS.map(({ field, label, min, max, step }) => (
        <div key={field} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              style={stepBtnStyle}
              onClick={() =>
                setInspectionStageField(field, Math.max(min, Number((inspectionStage[field] - step).toFixed(2))))
              }
            >
              −
            </button>
            <NumberField
              value={inspectionStage[field]}
              step={step}
              onCommit={(value) => setInspectionStageField(field, value)}
              style={numberInputStyle}
            />
            <button
              style={stepBtnStyle}
              onClick={() =>
                setInspectionStageField(field, Math.min(max, Number((inspectionStage[field] + step).toFixed(2))))
              }
            >
              +
            </button>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={inspectionStage[field]}
              onChange={(event) => setInspectionStageField(field, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btnStyle} onClick={resetInspectionStage}>
          RESET ОСМОТРА
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button style={saveBtnStyle} onClick={save}>
          SAVE
        </button>
        <button
          style={btnStyle}
          onClick={() => {
            const text = JSON.stringify({ holders, inspectionStage }, null, 2);
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
  left: 300,
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
