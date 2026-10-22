import type { CSSProperties } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { useSettingsStore } from "../../../../shared/lib/useSettingsStore";
import {
  colors,
  ghostButtonStyle,
  mutedTextStyle,
  panelStyle,
  sectionTitleStyle,
  touch,
  typography,
} from "../tabletStyles";

/** «Настройки» — volume with capped slider width for finger control. */
export function SettingsTab() {
  const volume = useSettingsStore((state) => state.volume);
  const muted = useSettingsStore((state) => state.muted);
  const setVolume = useSettingsStore((state) => state.setVolume);
  const toggleMuted = useSettingsStore((state) => state.toggleMuted);

  return (
    <div style={{ ...panelStyle, maxWidth: 560 }}>
      <h3 style={sectionTitleStyle}>Звук</h3>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="tablet-volume">
          Общая громкость
        </label>
        <span style={{ ...mutedTextStyle, maxWidth: "none" }}>{volume}%</span>
      </div>
      <input
        id="tablet-volume"
        type="range"
        min={0}
        max={100}
        value={volume}
        disabled={muted}
        onChange={(event) => setVolume(Number(event.target.value))}
        style={sliderStyle}
      />

      <div style={{ ...rowStyle, marginTop: 20 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, ...labelStyle }}>
          {muted ? <VolumeX size={22} color={colors.textMuted} /> : <Volume2 size={22} color={colors.accent} />}
          Звук {muted ? "выключен" : "включён"}
        </span>
        <button type="button" style={ghostButtonStyle} onClick={toggleMuted}>
          {muted ? "Включить" : "Выключить"}
        </button>
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  margin: "16px 0 10px",
  minHeight: touch.minTarget,
};

const labelStyle: CSSProperties = {
  fontSize: typography.sizeBody,
  color: colors.textPrimary,
  fontWeight: typography.weightMedium,
};

const sliderStyle: CSSProperties = {
  width: "100%",
  maxWidth: touch.sliderMaxWidth,
  height: 28,
  accentColor: colors.accent,
  cursor: "pointer",
};
