import type { CSSProperties } from "react";

import "./tabletFonts.css";

/**
 * Tablet UI kit — finger-friendly dark theme for the lab simulator screen.
 * Stack: React + shared style objects (no Tailwind in this stand).
 */
export const typography = {
  fontFamilyBase: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif',
  fontFamilyMono: '"JetBrains Mono", Consolas, "Courier New", monospace',
  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
  /** Body copy — WCAG-friendly on dark slate */
  sizeBody: 16,
  sizeTitle: 22,
  sizeScreen: 24,
  sizeCaption: 14,
  sizeNav: 15,
} as const;

export const colors = {
  bg: "rgba(15, 23, 42, 0.96)",
  bgElevated: "rgba(30, 41, 59, 0.88)",
  bgInset: "rgba(2, 6, 23, 0.45)",
  bgScreen: "rgba(15, 23, 42, 0.98)",
  bgCard: "rgba(51, 65, 85, 0.55)",
  /** slate-800/40 — Clean Sci-Fi property cards */
  bgSlate800_40: "rgba(30, 41, 59, 0.4)",
  border: "rgba(148, 163, 184, 0.22)",
  /** slate-700/50 */
  borderSlate700_50: "rgba(51, 65, 85, 0.5)",
  borderStrong: "rgba(6, 182, 212, 0.55)",
  /** cyan-500 — active fills */
  accent: "#06b6d4",
  /** cyan-400 — bright labels / brand */
  accentBright: "#22d3ee",
  accentSoft: "rgba(6, 182, 212, 0.18)",
  accentInk: "#0f172a",
  textPrimary: "#f1f5f9",
  textMuted: "#cbd5e1",
  /** Pure white for WCAG contrast on dark slate */
  textPure: "#ffffff",
  success: "#34d399",
  successSoft: "rgba(52, 211, 153, 0.16)",
  warning: "#fbbf24",
  warningSoft: "rgba(251, 191, 36, 0.16)",
  danger: "#f87171",
  dangerSoft: "rgba(248, 113, 113, 0.16)",
  bezel: "#2a3331",
  bezelEdge: "#1a201f",
  bezelHighlight: "#3d4744",
  screenGlow: "rgba(255, 255, 255, 0.08)",
} as const;

/** Touch / layout constants for tablet ergonomics. */
export const touch = {
  minTarget: 48,
  comfortableTarget: 52,
  navTarget: 52,
  gap: 12,
  pad: 16,
  safeTop: "max(8px, env(safe-area-inset-top))",
  safeBottom: "max(12px, env(safe-area-inset-bottom))",
  safeLeft: "max(8px, env(safe-area-inset-left))",
  safeRight: "max(8px, env(safe-area-inset-right))",
  textMaxWidth: 650,
  sliderMaxWidth: 380,
} as const;

/**
 * Physical face ≈ 250 × 172 mm (length × width), landscape on screen.
 */
export const tabletChrome = {
  heightPx: 720,
  expandedWidth: 1046,
  viewportInset: 40,
} as const;

export const panelStyle: CSSProperties = {
  backgroundColor: colors.bgElevated,
  border: `1px solid ${colors.border}`,
  borderRadius: 14,
  padding: touch.pad,
};

export const cardStyle: CSSProperties = {
  ...panelStyle,
  backgroundColor: colors.bgCard,
  minHeight: touch.comfortableTarget,
};

export const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: touch.comfortableTarget,
  padding: "12px 22px",
  backgroundColor: colors.accent,
  color: colors.accentInk,
  borderRadius: 12,
  cursor: "pointer",
  border: "none",
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeBody,
  fontWeight: typography.weightSemibold,
  boxShadow: "0 0 0 1px rgba(6, 182, 212, 0.45), 0 0 16px rgba(6, 182, 212, 0.25)",
};

export const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: touch.comfortableTarget,
  padding: "12px 20px",
  backgroundColor: colors.bgInset,
  color: colors.textPrimary,
  borderRadius: 12,
  cursor: "pointer",
  border: `1px solid ${colors.borderStrong}`,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeBody,
  fontWeight: typography.weightMedium,
};

export const dangerButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  color: colors.danger,
  borderColor: "rgba(248, 113, 113, 0.55)",
  backgroundColor: colors.dangerSoft,
};

export const inputStyle: CSSProperties = {
  minHeight: touch.minTarget,
  padding: "10px 12px",
  backgroundColor: colors.bgInset,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightRegular,
  fontSize: typography.sizeBody,
};

export const mutedTextStyle: CSSProperties = {
  color: colors.textMuted,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeBody,
  fontWeight: typography.weightRegular,
  lineHeight: 1.55,
  maxWidth: touch.textMaxWidth,
};

export const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeTitle,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
  lineHeight: 1.3,
};

export const screenTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeScreen,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
  lineHeight: 1.25,
};

export const technicalValueStyle: CSSProperties = {
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightMedium,
  color: "#e2e8f0",
  fontSize: typography.sizeBody,
};

export const formulaStyle: CSSProperties = {
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightBold,
  color: colors.textPure,
  fontSize: typography.sizeBody,
};

export const progressTrackStyle: CSSProperties = {
  width: "100%",
  height: 10,
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
  accent: { fg: colors.accentBright, bg: colors.accentSoft },
  success: { fg: colors.success, bg: colors.successSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};

export const badgeStyle = (variant: BadgeVariant = "neutral"): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 32,
  padding: "6px 12px",
  borderRadius: 999,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeCaption,
  fontWeight: typography.weightSemibold,
  lineHeight: 1.3,
  color: BADGE_COLORS[variant].fg,
  backgroundColor: BADGE_COLORS[variant].bg,
  whiteSpace: "nowrap",
  border: `1px solid ${BADGE_COLORS[variant].fg}33`,
});

export const navItemStyle = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: touch.navTarget,
  padding: "12px 14px",
  borderRadius: 12,
  border: active ? `1px solid ${colors.borderStrong}` : "1px solid transparent",
  cursor: "pointer",
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeNav,
  fontWeight: active ? typography.weightSemibold : typography.weightMedium,
  textAlign: "left",
  color: active ? colors.accentInk : colors.textPrimary,
  backgroundColor: active ? colors.accent : "transparent",
  transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
});

export const scrollAreaStyle: CSSProperties = {
  overflowY: "auto",
  flex: 1,
  paddingRight: 6,
  WebkitOverflowScrolling: "touch",
};

/** Shared master–detail row used by Tasks / Stages / Theory. */
export const splitLayoutStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  flex: 1,
  minHeight: 0,
  width: "100%",
};

export const splitListStyle: CSSProperties = {
  width: 220,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  paddingRight: 10,
  borderRight: `1px solid ${colors.borderSlate700_50}`,
  boxSizing: "border-box",
  minHeight: 0,
};

export const splitDetailStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "4px 4px 8px 16px",
  boxSizing: "border-box",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  backgroundColor: "transparent",
  border: "none",
};

/** Footer row under Tasks / Stages detail panes. */
export const splitDetailActionsStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 4,
  minHeight: 52,
};

export const splitDetailProgressStyle: CSSProperties = {
  margin: 0,
  fontSize: typography.sizeCaption,
  lineHeight: 1.4,
  color: colors.textMuted,
};

export const splitDetailProgressStepStyle: CSSProperties = {
  margin: "2px 0 0",
  fontSize: typography.sizeCaption,
  fontWeight: typography.weightSemibold,
  lineHeight: 1.35,
  color: colors.textPrimary,
};

/** Primary CTA — same footprint in Tasks and Stages. */
export const splitDetailCtaButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  alignSelf: "flex-start",
  minHeight: 44,
  minWidth: 220,
  padding: "10px 18px",
  whiteSpace: "nowrap",
};

export const visualGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  gap: 12,
};

/** Quiet list row — cyan left bar when active (same language as Tasks). */
export const listItemButtonStyle = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  padding: "8px 4px 8px 6px",
  borderRadius: 8,
  border: "none",
  borderLeft: active ? `3px solid ${colors.accentBright}` : "3px solid transparent",
  backgroundColor: "transparent",
  color: colors.textPrimary,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeCaption,
  fontWeight: active ? typography.weightSemibold : typography.weightMedium,
  lineHeight: 1.35,
  transition: "border-color 0.15s ease, color 0.15s ease",
});
