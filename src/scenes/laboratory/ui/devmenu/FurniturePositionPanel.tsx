import type { CSSProperties } from "react";

import { useDevMenuStore } from "../../lib/useDevMenuStore";
import {
  FURNITURE_IDS,
  FURNITURE_LABELS,
  useFurniturePositionStore,
  type FurnitureId,
} from "../../lib/useFurniturePositionStore";
import { NumberField } from "./NumberField";

const AXIS_LABELS = ["X", "Y", "Z"] as const;
const NUDGE_STEP = 0.05;

/**
 * New capability (not a reskin of an existing F-key panel): cabinets,
 * equipment, and the workbench have no runtime-editable position anywhere
 * else — `layout.ts`'s static constants are the sole source today. This
 * reads/writes `useFurniturePositionStore`, which every furniture renderer
 * (`ReagentCabinetInstance`, `FumeHood`, `PPECabinet`, `WorkbenchInstance`)
 * now consults instead of the raw `layout.ts` values. Selection comes either
 * from clicking a piece in the 3D view (`CameraRig`'s dev-menu raycast, via
 * `useDevMenuStore.selectFurniture`) or the dropdown below.
 */
export function FurniturePositionPanel() {
  const selectedId = useDevMenuStore((state) => state.selectedFurnitureId) ?? "table";
  const selectFurniture = useDevMenuStore((state) => state.selectFurniture);
  const override = useFurniturePositionStore((state) => state.getOverride(selectedId));
  const setPositionAxis = useFurniturePositionStore((state) => state.setPositionAxis);
  const setRotationY = useFurniturePositionStore((state) => state.setRotationY);
  const reset = useFurniturePositionStore((state) => state.reset);
  const resetAll = useFurniturePositionStore((state) => state.resetAll);
  const save = useFurniturePositionStore((state) => state.save);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={noteStyle}>
        Кликните и потяните шкаф, вытяжку или стол в 3D-сцене, чтобы передвинуть его по полу (высоту Y и поворот
        настраивайте ниже) — либо выберите объект из списка ниже и подвиньте его полями/ползунками.
      </div>

      <label style={rowStyle}>
        <span style={labelStyle}>Объект</span>
        <select
          value={selectedId}
          onChange={(event) => selectFurniture(event.target.value as FurnitureId)}
          style={selectStyle}
        >
          {FURNITURE_IDS.map((id) => (
            <option key={id} value={id}>
              {FURNITURE_LABELS[id]}
            </option>
          ))}
        </select>
      </label>

      {AXIS_LABELS.map((label, axis) => (
        <div key={label} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              style={stepBtnStyle}
              onClick={() => setPositionAxis(selectedId, axis as 0 | 1 | 2, override.position[axis] - NUDGE_STEP)}
            >
              −
            </button>
            <NumberField
              value={override.position[axis]}
              step={NUDGE_STEP}
              onCommit={(value) => setPositionAxis(selectedId, axis as 0 | 1 | 2, value)}
            />
            <button
              style={stepBtnStyle}
              onClick={() => setPositionAxis(selectedId, axis as 0 | 1 | 2, override.position[axis] + NUDGE_STEP)}
            >
              +
            </button>
            <input
              type="range"
              min={-5}
              max={5}
              step={NUDGE_STEP}
              value={override.position[axis]}
              onChange={(event) => setPositionAxis(selectedId, axis as 0 | 1 | 2, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      ))}

      {override.rotationY !== null && (
        <div style={rowStyle}>
          <span style={labelStyle}>Rot Y</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button style={stepBtnStyle} onClick={() => setRotationY(selectedId, override.rotationY! - 0.05)}>
              −
            </button>
            <NumberField value={override.rotationY} step={0.05} onCommit={(value) => setRotationY(selectedId, value)} />
            <button style={stepBtnStyle} onClick={() => setRotationY(selectedId, override.rotationY! + 0.05)}>
              +
            </button>
            <input
              type="range"
              min={-Math.PI}
              max={Math.PI}
              step={0.02}
              value={override.rotationY}
              onChange={(event) => setRotationY(selectedId, parseFloat(event.target.value))}
              style={sliderStyle}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button style={saveBtnStyle} onClick={save}>
          SAVE
        </button>
        <button
          style={btnStyle}
          onClick={() => {
            const text = JSON.stringify({ position: override.position, rotationY: override.rotationY }, null, 2);
            void navigator.clipboard?.writeText(text).catch(() => {});
          }}
        >
          COPY VALUES
        </button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btnStyle} onClick={() => reset(selectedId)}>
          RESET CURRENT
        </button>
        <button style={btnStyle} onClick={resetAll}>
          RESET ALL
        </button>
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const labelStyle: CSSProperties = { color: "#94a3b8", width: 60, flexShrink: 0 };

const noteStyle: CSSProperties = {
  fontSize: 10,
  color: "#94a3b8",
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

const sliderStyle: CSSProperties = {
  flex: 1,
  minWidth: 40,
};
