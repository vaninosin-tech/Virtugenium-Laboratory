import { useEffect, type CSSProperties } from "react";

import { CABINETS, EQUIPMENT, type HotspotTargetId } from "../lib/layout";
import { useCabinetOpenStore } from "../lib/useCabinetOpenStore";
import {
  CALIBRATION_PRESETS,
  SHARED_CABINET_IDS,
  useCameraCalibrationStore,
  type CalibrationPresetId,
  type MoveDirection,
} from "../lib/useCameraCalibrationStore";
import { NumberField } from "./devmenu/NumberField";

/** Every preset with a real openable door/sash — reagent cabinets and the two equipment pieces alike — auto-opened while its preset is being calibrated (see the effect below). */
const CABINET_PRESET_IDS = new Set<CalibrationPresetId>([
  ...CABINETS.map((cabinet) => cabinet.id),
  ...EQUIPMENT.map((equipment) => equipment.id),
]);

const STEP_OPTIONS = [0.01, 0.05, 0.1] as const;

function fmt(n: number): string {
  return n.toFixed(3);
}

/**
 * Dev-only camera calibration HUD (F8). Renders nothing outside `import.meta.env.DEV`
 * so no calibration UI/code path is reachable in production builds. Edits go through
 * `useCameraCalibrationStore`; `CameraRig` previews them live while the panel is open
 * and reads saved overrides afterward — this component only dispatches store actions.
 */
export function CameraCalibrationPanel() {
  const isOpen = useCameraCalibrationStore((state) => state.isOpen);
  const presetId = useCameraCalibrationStore((state) => state.presetId);
  const mode = useCameraCalibrationStore((state) => state.mode);
  const step = useCameraCalibrationStore((state) => state.step);
  const pose = useCameraCalibrationStore((state) => state.drafts[state.presetId]);
  const setOpen = useCameraCalibrationStore((state) => state.setOpen);
  const setPreset = useCameraCalibrationStore((state) => state.setPreset);
  const setMode = useCameraCalibrationStore((state) => state.setMode);
  const setStep = useCameraCalibrationStore((state) => state.setStep);
  const move = useCameraCalibrationStore((state) => state.move);
  const tiltHead = useCameraCalibrationStore((state) => state.tiltHead);
  const setFov = useCameraCalibrationStore((state) => state.setFov);
  const save = useCameraCalibrationStore((state) => state.save);
  const reset = useCameraCalibrationStore((state) => state.reset);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // F8 is now the unified dev menu's own hotkey (`DevMenuPanel`), which
      // drives this panel's `isOpen` — this listener only handles the
      // arrow/WASD nudge shortcuts while the panel happens to be open.
      if (!useCameraCalibrationStore.getState().isOpen) return;

      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      const map: Record<string, MoveDirection> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "forward",
        W: "forward",
        s: "back",
        S: "back",
      };
      const direction = map[event.key];
      if (!direction) return;
      event.preventDefault();
      move(direction);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [move]);

  useEffect(() => {
    if (isOpen && document.pointerLockElement) document.exitPointerLock();
  }, [isOpen]);

  // Calibrating a cabinet's inspection view needs to see it open (doors/shutter/lit
  // interior) — otherwise there's nothing to frame. Opens the real cabinet the panel
  // is bound to via the same `useCabinetOpenStore` gameplay uses, and closes it again
  // on preset switch / panel close, exactly mirroring `CameraRig.startFocusing`/`startReturning`.
  useEffect(() => {
    if (!isOpen || !CABINET_PRESET_IDS.has(presetId)) return;
    const id = presetId as HotspotTargetId;
    useCabinetOpenStore.getState().setOpen(id, true);
    return () => useCabinetOpenStore.getState().setOpen(id, false);
  }, [isOpen, presetId]);

  if (!import.meta.env.DEV || !isOpen) return null;

  const button = (label: string, onClick: () => void, style?: CSSProperties) => (
    <button onClick={onClick} style={{ ...btnStyle, ...style }}>
      {label}
    </button>
  );

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        CAMERA CALIBRATION
        <button onClick={() => setOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      </div>

      <label style={rowStyle}>
        <span style={labelStyle}>Preset</span>
        <select
          value={presetId}
          onChange={(event) => setPreset(event.target.value as typeof presetId)}
          style={selectStyle}
        >
          {CALIBRATION_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      {SHARED_CABINET_IDS.includes(presetId) && (
        <div style={noteStyle}>Save/Reset применяются сразу ко всем 6 шкафам (одинаковый подход)</div>
      )}

      <div style={rowStyle}>
        <span style={labelStyle}>Edit</span>
        <div style={{ display: "flex", gap: 6 }}>
          {button("POSITION", () => setMode("position"), mode === "position" ? activeBtnStyle : undefined)}
          {button("TARGET", () => setMode("target"), mode === "target" ? activeBtnStyle : undefined)}
        </div>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Step</span>
        <div style={{ display: "flex", gap: 6 }}>
          {STEP_OPTIONS.map((value) =>
            button(String(value), () => setStep(value), step === value ? activeBtnStyle : undefined),
          )}
          <NumberField value={step} step={0.001} onCommit={setStep} style={numberInputStyle} />
        </div>
      </div>

      <div style={dpadStyle}>
        <div />
        {button("UP", () => move("up"), dpadUpBtnStyle)}
        <div />
        {button("LEFT", () => move("left"))}
        {button("FWD", () => move("forward"))}
        {button("RIGHT", () => move("right"))}
        <div />
        {button("DOWN", () => move("down"))}
        <div />
        <div />
        {button("BACK", () => move("back"))}
        <div />
      </div>

      <div style={valuesStyle}>
        <div>
          Position: X {fmt(pose.position[0])} Y {fmt(pose.position[1])} Z {fmt(pose.position[2])}
        </div>
        <div>
          Target: X {fmt(pose.target[0])} Y {fmt(pose.target[1])} Z {fmt(pose.target[2])}
        </div>
      </div>

      <div style={labelStyle}>НАКЛОН ГОЛОВЫ</div>
      <div style={{ display: "flex", gap: 6 }}>
        {button("ВВЕРХ", () => tiltHead("up"), fovBtnStyle)}
        {button("ВНИЗ", () => tiltHead("down"), fovBtnStyle)}
      </div>

      <div style={{ ...labelStyle, marginTop: 4 }}>УГОЛ ОБЗОРА</div>
      <div style={rowStyle}>
        <span style={labelStyle}>FOV: {Math.round(pose.fov)}°</span>
        <NumberField value={pose.fov} step={1} onCommit={setFov} style={numberInputStyle} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {button("FOV УЖЕ", () => setFov(pose.fov - 1), fovBtnStyle)}
        {button("FOV ШИРЕ", () => setFov(pose.fov + 1), fovBtnStyle)}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {button("SAVE PRESET", save, saveBtnStyle)}
        {button("RESET", reset)}
        {button("COPY VALUES", () => {
          const text = JSON.stringify(
            { preset: presetId, position: pose.position, target: pose.target, fov: pose.fov },
            null,
            2,
          );
          void navigator.clipboard?.writeText(text).catch(() => {});
        })}
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

const labelStyle: CSSProperties = { color: "#94a3b8" };

const noteStyle: CSSProperties = {
  fontSize: 10,
  color: "#facc15",
  lineHeight: 1.3,
};

const selectStyle: CSSProperties = {
  flex: 1,
  backgroundColor: "rgba(15, 23, 42, 0.9)",
  color: "#e2e8f0",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  fontSize: 11,
  padding: "4px 6px",
};

const btnStyle: CSSProperties = {
  backgroundColor: "rgba(56, 189, 248, 0.12)",
  color: "#38bdf8",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 11,
  padding: "4px 8px",
};

const activeBtnStyle: CSSProperties = {
  backgroundColor: "#38bdf8",
  color: "#0f172a",
};

const saveBtnStyle: CSSProperties = {
  backgroundColor: "#22c55e",
  color: "#0f172a",
  border: "1px solid #22c55e",
};

const fovBtnStyle: CSSProperties = {
  flex: 1,
  padding: "8px 8px",
  fontSize: 12,
  fontWeight: 700,
};

const numberInputStyle: CSSProperties = {
  width: 56,
  backgroundColor: "rgba(15, 23, 42, 0.9)",
  color: "#e2e8f0",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  fontSize: 11,
  padding: "3px 4px",
};

const dpadStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 4,
  justifyItems: "stretch",
};

/** Lifts the UP button off the LEFT/FWD/RIGHT row below it so the pad reads as a cross shape instead of a flat block. */
const dpadUpBtnStyle: CSSProperties = {
  marginBottom: 6,
};

const valuesStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  fontSize: 11,
  color: "#cbd5e1",
  textAlign: "center",
};
