import type { CSSProperties, ReactNode } from "react";

import { colors, tabletChrome, typography } from "./tabletStyles";

type BezelSize = "expanded";

interface TabletBezelProps {
  readonly size?: BezelSize;
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly title?: string;
  readonly asButton?: boolean;
  readonly className?: string;
}

/**
 * Physical tablet chrome — camera and home mark sit on the side bezels.
 */
export function TabletBezel({ children, onClick, title, asButton, className }: TabletBezelProps) {
  const Tag = asButton ? "button" : "div";

  return (
    <Tag
      onClick={onClick}
      title={title}
      className={className}
      style={{
        ...shellStyle,
        ...expandedShellStyle,
        ...(asButton ? buttonResetStyle : null),
      }}
    >
      <div style={sideRailStyle} aria-hidden>
        <div style={cameraDotStyle} />
      </div>
      <div style={screenFrameStyle}>
        <div style={screenGlassStyle}>{children}</div>
      </div>
      <div style={sideRailStyle} aria-hidden>
        <div style={homeBarStyle} />
      </div>
    </Tag>
  );
}

const shellStyle: CSSProperties = {
  position: "absolute",
  zIndex: 20,
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  gap: 8,
  padding: "2px 10px",
  background: `linear-gradient(160deg, ${colors.bezelHighlight} 0%, ${colors.bezel} 42%, ${colors.bezelEdge} 100%)`,
  borderRadius: 22,
  border: `1px solid ${colors.bezelEdge}`,
  boxShadow: "0 18px 40px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255,255,255,0.12)",
  fontFamily: typography.fontFamilyBase,
};

const expandedShellStyle: CSSProperties = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: tabletChrome.expandedWidth,
  maxWidth: `calc(100vw - ${tabletChrome.viewportInset}px)`,
  height: tabletChrome.heightPx,
  maxHeight: `calc(100vh - ${tabletChrome.viewportInset}px)`,
  zIndex: 30,
  padding: "2px 10px",
};

const buttonResetStyle: CSSProperties = {
  cursor: "pointer",
  textAlign: "left",
  appearance: "none",
  WebkitAppearance: "none",
};

const sideRailStyle: CSSProperties = {
  width: 14,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cameraDotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "radial-gradient(circle at 35% 35%, #6b7572, #111716 70%)",
  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)",
  flexShrink: 0,
};

const screenFrameStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  borderRadius: 14,
  padding: 2,
  background: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(0,0,0,0.25))",
  boxSizing: "border-box",
  display: "flex",
};

const screenGlassStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  flex: 1,
  minHeight: 0,
  borderRadius: 12,
  overflow: "hidden",
  backgroundColor: colors.bgScreen,
  boxShadow: `inset 0 0 0 1px ${colors.border}`,
};

/** Vertical home mark — same language as the old bottom bar, on the side. */
const homeBarStyle: CSSProperties = {
  width: 4,
  height: 72,
  borderRadius: 999,
  backgroundColor: "rgba(255,255,255,0.22)",
  flexShrink: 0,
};
