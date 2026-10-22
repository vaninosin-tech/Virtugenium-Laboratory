import type { CSSProperties } from "react";

import "./tabletFonts.css";

/**
 * Tablet typography system. IBM Plex Sans for all normal UI text (titles,
 * body, buttons, navigation); JetBrains Mono reserved for technical
 * readouts (chemical formulas, equations, scores/progress counters) so
 * experimental data reads as visually distinct from instructional copy.
 * Unbounded (the reagent-cabinet category-label font) is intentionally
 * absent here — this tablet doesn't use it anywhere.
 */
export const typography = {
  fontFamilyBase: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif',
  fontFamilyMono: '"JetBrains Mono", Consolas, "Courier New", monospace',
  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
} as const;

export const colors = {
  bg: "rgba(15, 23, 42, 0.94)",
  bgElevated: "rgba(30, 41, 59, 0.7)",
  bgInset: "rgba(0, 0, 0, 0.28)",
  border: "rgba(255, 255, 255, 0.1)",
  borderStrong: "rgba(56, 189, 248, 0.4)",
  accent: "#38bdf8",
  accentSoft: "rgba(56, 189, 248, 0.14)",
  textPrimary: "#e2e8f0",
  textMuted: "#94a3b8",
  success: "#34d399",
  successSoft: "rgba(52, 211, 153, 0.14)",
  warning: "#fbbf24",
  warningSoft: "rgba(251, 191, 36, 0.14)",
  danger: "#f87171",
  dangerSoft: "rgba(248, 113, 113, 0.14)",
} as const;

export const panelStyle: CSSProperties = {
  backgroundColor: colors.bgElevated,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 16,
};

export const cardStyle = panelStyle;

export const primaryButtonStyle: CSSProperties = {
  padding: "10px 18px",
  backgroundColor: colors.accent,
  color: "#0f172a",
  borderRadius: 8,
  cursor: "pointer",
  border: "none",
  fontFamily: typography.fontFamilyBase,
  fontSize: 15,
  fontWeight: typography.weightMedium,
};

export const ghostButtonStyle: CSSProperties = {
  padding: "8px 16px",
  backgroundColor: colors.bgInset,
  color: colors.textPrimary,
  borderRadius: 8,
  cursor: "pointer",
  border: `1px solid ${colors.border}`,
  fontFamily: typography.fontFamilyBase,
  fontSize: 15,
  fontWeight: typography.weightMedium,
};

export const dangerButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  color: colors.danger,
  borderColor: "rgba(248, 113, 113, 0.4)",
};

// The only current caller (`EquationTab`'s coefficient/formula/charge
// fields) is chemistry data entry, so this uses the mono/formula font
// directly rather than needing a per-call override.
export const inputStyle: CSSProperties = {
  padding: "6px 8px",
  backgroundColor: colors.bgInset,
  color: "white",
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightRegular,
  fontSize: 15,
};

export const mutedTextStyle: CSSProperties = {
  color: colors.textMuted,
  fontFamily: typography.fontFamilyBase,
  fontSize: 15,
  fontWeight: typography.weightRegular,
  lineHeight: 1.5,
};

export const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: typography.fontFamilyBase,
  fontSize: 18,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
};

/**
 * Full-screen moments only (e.g. the results takeover) — the compact
 * per-tab header bar in `TabletOverlay` keeps its existing smaller size, so
 * as not to force a layout change to that bar just to fit a 26-30px title.
 */
export const screenTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: typography.fontFamilyBase,
  fontSize: 28,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
};

/**
 * Technical/experimental data — chemical formulas, equations, scores,
 * progress counters, measurements — rendered in JetBrains Mono so it reads
 * as visually distinct from instructional body copy, per the tablet
 * typography spec. Use `formulaStyle` for formulas/equations specifically
 * (Regular weight per spec) and `technicalValueStyle` for numeric readouts
 * (Medium weight).
 */
export const technicalValueStyle: CSSProperties = {
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightMedium,
};

export const formulaStyle: CSSProperties = {
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightRegular,
};

/** Track for a horizontal progress bar; pair with `progressFillStyle`. */
export const progressTrackStyle: CSSProperties = {
  width: "100%",
  height: 6,
  borderRadius: 999,
  backgroundColor: colors.bgInset,
  overflow: "hidden",
};

export const progressFillStyle = (ratio: number, color: string = colors.accent): CSSProperties => ({
  width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`,
  height: "100%",
  borderRadius: 999,
  backgroundColor: color,
  transition: "width 0.2s ease",
});

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger";

const BADGE_COLORS: Record<BadgeVariant, { fg: string; bg: string }> = {
  neutral: { fg: colors.textMuted, bg: colors.bgInset },
  accent: { fg: colors.accent, bg: colors.accentSoft },
  success: { fg: colors.success, bg: colors.successSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};

export const badgeStyle = (variant: BadgeVariant = "neutral"): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 9px",
  borderRadius: 999,
  fontFamily: typography.fontFamilyBase,
  fontSize: 12,
  fontWeight: typography.weightMedium,
  lineHeight: 1.4,
  color: BADGE_COLORS[variant].fg,
  backgroundColor: BADGE_COLORS[variant].bg,
  whiteSpace: "nowrap",
});

export const navItemStyle = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 12px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  fontFamily: typography.fontFamilyBase,
  fontSize: 13,
  fontWeight: active ? typography.weightSemibold : typography.weightMedium,
  textAlign: "left",
  color: active ? "#0f172a" : colors.textMuted,
  backgroundColor: active ? colors.accent : "transparent",
  transition: "background-color 0.15s ease, color 0.15s ease",
});

export const scrollAreaStyle: CSSProperties = {
  overflowY: "auto",
  flex: 1,
  paddingRight: 4,
};
