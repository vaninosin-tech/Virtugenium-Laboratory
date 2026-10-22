import type { CSSProperties } from "react";

import { colors, mutedTextStyle, sectionTitleStyle, typography } from "./tabletStyles";
import "./scoreProgress.css";

/** Full HD aspect (16:9); height matches the «Описание» block. */
const MONITOR_ASPECT = "16 / 9";

type ExperimentBriefPanelProps = {
  readonly title: string;
  readonly description: string;
};

/**
 * Shared upper workspace: title + description (scroll) + NO DATA monitor.
 * Bottom edge is a single divider shared with the keyboard / choices panel.
 */
export function ExperimentBriefPanel({ title, description }: ExperimentBriefPanelProps) {
  return (
    <div style={workspaceStyle}>
      <h3 style={workspaceTitleStyle}>{title}</h3>
      <div style={zonesStyle}>
        <div style={descriptionColumnStyle}>
          <span style={zoneLabelStyle}>Описание</span>
          <div className="equation-desc-scroll" style={descriptionScrollStyle}>
            <p style={briefDescriptionStyle}>{description}</p>
          </div>
        </div>

        <div style={monitorScreenStyle} aria-label="Запись эксперимента">
          <span style={videoPlaceholderLabelStyle}>NO DATA</span>
        </div>
      </div>
      <div style={dividerStyle} aria-hidden />
    </div>
  );
}

const workspaceStyle: CSSProperties = {
  flex: "1 1 0",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "4px 2px 0",
  overflow: "hidden",
};

const workspaceTitleStyle: CSSProperties = {
  ...sectionTitleStyle,
  margin: 0,
  flexShrink: 0,
};

const zonesStyle: CSSProperties = {
  flex: "1 1 0",
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 16,
  alignItems: "stretch",
  overflow: "hidden",
  paddingBottom: 10,
};

const descriptionColumnStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  overflow: "hidden",
};

const zoneLabelStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: colors.accentBright,
};

const descriptionScrollStyle: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  paddingRight: 8,
};

const briefDescriptionStyle: CSSProperties = {
  ...mutedTextStyle,
  margin: 0,
  maxWidth: "none",
  color: colors.textPrimary,
  lineHeight: 1.5,
};

const monitorScreenStyle: CSSProperties = {
  height: "100%",
  maxHeight: "100%",
  aspectRatio: MONITOR_ASPECT,
  width: "auto",
  alignSelf: "stretch",
  borderRadius: 14,
  backgroundColor: "#000000",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const videoPlaceholderLabelStyle: CSSProperties = {
  fontFamily: typography.fontFamilyMono,
  fontSize: 18,
  fontWeight: typography.weightBold,
  letterSpacing: "0.22em",
  color: "rgba(255, 255, 255, 0.55)",
};

const dividerStyle: CSSProperties = {
  flexShrink: 0,
  height: 1,
  width: "100%",
  backgroundColor: colors.border,
};
