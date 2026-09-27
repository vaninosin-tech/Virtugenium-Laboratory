import type { CSSProperties } from "react";
import { Star } from "lucide-react";

import { colors, technicalValueStyle, typography } from "./tabletStyles";
import "./scoreProgress.css";

type ScoreProgressBarProps = {
  readonly score: number;
  readonly maximumScore: number;
  /** Full width — for the collapsed hologram card. */
  readonly fullWidth?: boolean;
};

/** Animated score meter for the tablet top bar. */
export function ScoreProgressBar({ score, maximumScore, fullWidth = false }: ScoreProgressBarProps) {
  const safeMax = Math.max(0, maximumScore);
  const ratio = safeMax > 0 ? Math.min(1, Math.max(0, score / safeMax)) : 0;
  const percent = Math.round(ratio * 100);
  const label = safeMax > 0 ? `${score} / ${safeMax}` : "— / —";

  return (
    <div
      className="tablet-score-bar"
      style={fullWidth ? holoWrapStyle : wrapStyle}
      aria-label={`Баллы ${score} из ${safeMax}`}
    >
      <div style={labelRowStyle}>
        <Star size={16} color={colors.warning} fill={colors.warning} />
        <span style={valueStyle}>{label}</span>
        <span style={percentStyle}>{safeMax > 0 ? `${percent}%` : "—"}</span>
      </div>
      <div style={trackStyle}>
        <div
          className="tablet-score-bar-fill"
          style={{
            ...fillStyle,
            width: `${percent}%`,
          }}
        />
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: 220,
  minWidth: 220,
  maxWidth: 220,
  flexShrink: 0,
  margin: "0 8px 0 0",
};

const holoWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: "100%",
  minWidth: 0,
  flexShrink: 0,
  margin: 0,
};

const labelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const valueStyle: CSSProperties = {
  ...technicalValueStyle,
  fontSize: typography.sizeCaption,
  color: colors.textPrimary,
  flex: 1,
};

const percentStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: typography.weightSemibold,
  color: colors.accentBright,
};

const trackStyle: CSSProperties = {
  height: 10,
  borderRadius: 999,
  backgroundColor: colors.bgInset,
  overflow: "hidden",
  border: `1px solid ${colors.border}`,
};

const fillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: `linear-gradient(90deg, ${colors.accent} 0%, ${colors.accentBright} 55%, ${colors.warning} 100%)`,
  boxShadow: `0 0 12px ${colors.accent}88`,
  transition: "width 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
};
