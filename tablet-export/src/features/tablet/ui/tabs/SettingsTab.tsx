import { Volume2, VolumeX } from "lucide-react";

import { useSettingsStore } from "../../../../shared/lib/useSettingsStore";
import { colors, ghostButtonStyle, mutedTextStyle, panelStyle, sectionTitleStyle } from "../tabletStyles";

/** "Настройки" — volume/mute, reachable from the tablet per the release scope. */
export function SettingsTab() {
  const volume = useSettingsStore((state) => state.volume);
  const muted = useSettingsStore((state) => state.muted);
  const setVolume = useSettingsStore((state) => state.setVolume);
  const toggleMuted = useSettingsStore((state) => state.toggleMuted);

  return (
    <div style={panelStyle}>
      <h3 style={sectionTitleStyle}>Звук</h3>

      <div style={{ display: "flex", justifyContent: "space-between", margin: "14px 0 8px" }}>
        <label style={{ fontSize: 13, color: "#cbd5e1" }}>Общая громкость</label>
        <span style={mutedTextStyle}>{volume}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        disabled={muted}
        onChange={(event) => setVolume(Number(event.target.value))}
        style={{ width: "100%" }}
      />

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#cbd5e1" }}>
          {muted ? <VolumeX size={16} color={colors.textMuted} /> : <Volume2 size={16} color={colors.accent} />}
          Звук {muted ? "выключен" : "включён"}
        </span>
        <button style={ghostButtonStyle} onClick={toggleMuted}>
          {muted ? "Включить" : "Выключить"}
        </button>
      </div>
    </div>
  );
}
