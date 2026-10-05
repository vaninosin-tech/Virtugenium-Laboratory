import { useState, type CSSProperties } from "react";

import {
  centerSizeToRect,
  rectToCenterSize,
  useWorktopZoneStore,
  WORKTOP_ZONE_IDS,
  WORKTOP_ZONE_LABELS,
  type WorktopZoneId,
} from "../../lib/useWorktopZoneStore";
import { NumberField } from "./NumberField";

const STEP = 0.01;

const FIELDS = [
  { key: "width", label: "Ширина (X)" },
  { key: "depth", label: "Глубина (Z)" },
  { key: "centerX", label: "Центр X" },
  { key: "centerZ", label: "Центр Z" },
] as const;

/** Where each zone can be seen: the hood's tray is there only while it stands there. */
const WHERE: Record<WorktopZoneId, string> = {
  table: "Столешница рабочего стола.",
  "table-tray": "Поднос, пока он стоит на столе.",
  "fume-hood": "Столешница внутри вытяжного шкафа.",
  "hood-tray": "Поднос в вытяжном шкафу — рамка видна, только когда вы у вытяжки.",
};

/**
 * F8 → «Границы» (VL-019): the rectangles a held bottle, tube, stand or lamp
 * stays inside. Each is edited as its size and centre, in its object's own
 * metres; the frame in the scene follows at once. A place is its worktop
 * and its tray together — the item goes over either, never past both.
 */
export function WorktopZonePanel() {
  const selected = useWorktopZoneStore((state) => state.selected);
  const select = useWorktopZoneStore((state) => state.select);
  const rect = useWorktopZoneStore((state) => state.zones[state.selected]);
  const setZone = useWorktopZoneStore((state) => state.setZone);
  const reset = useWorktopZoneStore((state) => state.reset);
  const save = useWorktopZoneStore((state) => state.save);
  const [note, setNote] = useState<string | null>(null);

  const values = rectToCenterSize(rect);
  const setField = (key: keyof typeof values, value: number) => setZone(selected, centerSizeToRect({ ...values, [key]: value }));

  const copy = () => {
    const zones = useWorktopZoneStore.getState().zones;
    const text = JSON.stringify(zones, (_, value: unknown) => (typeof value === "number" ? Number(value.toFixed(4)) : value), 2);
    void navigator.clipboard?.writeText(text).then(
      () => setNote("Скопировано — пришлите это, и границы станут значениями по умолчанию."),
      () => setNote(text),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={noteStyle}>
        Прямоугольники, за которые предмет в руке не выходит. Предмет ходит над столом и над подносом своего места
        вместе. Жёлтая рамка — выбранная.
      </div>

      <label style={rowStyle}>
        <span style={labelStyle}>Граница</span>
        <select value={selected} onChange={(event) => select(event.target.value as WorktopZoneId)} style={selectStyle}>
          {WORKTOP_ZONE_IDS.map((id) => (
            <option key={id} value={id}>
              {WORKTOP_ZONE_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <div style={noteStyle}>{WHERE[selected]}</div>

      {FIELDS.map(({ key, label }) => (
        <div key={key} style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button style={stepBtnStyle} onClick={() => setField(key, round(values[key] - STEP))}>
              −
            </button>
            <NumberField value={round(values[key])} step={STEP} onCommit={(value) => setField(key, value)} />
            <button style={stepBtnStyle} onClick={() => setField(key, round(values[key] + STEP))}>
              +
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          style={actionBtnStyle}
          onClick={() => {
            save();
            setNote("Сохранено в этом браузере.");
          }}
        >
          Сохранить
        </button>
        <button style={actionBtnStyle} onClick={copy}>
          Скопировать
        </button>
        <button style={actionBtnStyle} onClick={() => reset(selected)}>
          Сбросить
        </button>
      </div>
      {note && <div style={{ ...noteStyle, whiteSpace: "pre-wrap" }}>{note}</div>}
    </div>
  );
}

const round = (value: number) => Math.round(value * 10000) / 10000;

const noteStyle: CSSProperties = { fontSize: 10, color: "#94a3b8", lineHeight: 1.3 };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 };
const labelStyle: CSSProperties = { fontSize: 11 };
const selectStyle: CSSProperties = {
  backgroundColor: "rgba(15, 23, 42, 0.9)",
  color: "#e2e8f0",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  fontSize: 11,
  padding: "3px 4px",
  maxWidth: 160,
};
const stepBtnStyle: CSSProperties = {
  backgroundColor: "rgba(56, 189, 248, 0.12)",
  color: "#38bdf8",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  width: 22,
  height: 22,
};
const actionBtnStyle: CSSProperties = {
  backgroundColor: "rgba(250, 204, 21, 0.15)",
  color: "#facc15",
  border: "1px solid rgba(250, 204, 21, 0.5)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 11,
  padding: "4px 8px",
};
