import type { CSSProperties } from "react";
import {
  AlertTriangle,
  BookOpen,
  FileText,
  FlaskConical,
  ListChecks,
  LogOut,
  PenLine,
  Settings,
  Star,
} from "lucide-react";

import type { TabletSection } from "../../../stores/laboratory/types";
import { colors, navItemStyle, technicalValueStyle } from "./tabletStyles";

interface SidebarItem {
  readonly section: TabletSection;
  readonly label: string;
  readonly icon: typeof FlaskConical;
}

const ITEMS: readonly SidebarItem[] = [
  { section: "tasks", label: "Опыты", icon: FlaskConical },
  { section: "description", label: "Описание", icon: FileText },
  { section: "stages", label: "Этапы", icon: ListChecks },
  { section: "theory", label: "Теория", icon: BookOpen },
  { section: "errors", label: "Ошибки", icon: AlertTriangle },
  { section: "answer", label: "Ответ", icon: PenLine },
  { section: "settings", label: "Настройки", icon: Settings },
];

interface TabletSidebarProps {
  readonly activeSection: TabletSection;
  readonly onSelect: (section: TabletSection) => void;
  readonly errorCount: number;
  readonly score: number;
  readonly maximumScore: number;
  readonly onRequestExit: () => void;
}

/** Left-hand icon+label navigation rail replacing the old horizontal tab bar. */
export function TabletSidebar({
  activeSection,
  onSelect,
  errorCount,
  score,
  maximumScore,
  onRequestExit,
}: TabletSidebarProps) {
  return (
    <div style={railStyle}>
      <nav style={navStyle}>
        {ITEMS.map(({ section, label, icon: Icon }) => {
          const active = section === activeSection;
          return (
            <button key={section} style={navItemStyle(active)} onClick={() => onSelect(section)}>
              <Icon size={16} />
              <span style={{ flex: 1 }}>{label}</span>
              {section === "errors" && errorCount > 0 && (
                <span style={active ? countBadgeActiveStyle : countBadgeStyle}>{errorCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={footerStyle}>
        {maximumScore > 0 && (
          <div style={scoreRowStyle}>
            <Star size={13} color={colors.warning} fill={colors.warning} />
            <span style={scoreTextStyle}>
              {score} / {maximumScore}
            </span>
          </div>
        )}
        <button style={exitButtonStyle} onClick={onRequestExit}>
          <LogOut size={14} />
          Выход в меню
        </button>
      </div>
    </div>
  );
}

const railStyle: CSSProperties = {
  width: 168,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  borderRight: `1px solid ${colors.border}`,
  paddingRight: 12,
};

const navStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const footerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 10,
  borderTop: `1px solid ${colors.border}`,
};

const scoreRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 12px",
};

const scoreTextStyle: CSSProperties = {
  ...technicalValueStyle,
  color: colors.textMuted,
  fontSize: 12,
};

const exitButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 12px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  color: colors.danger,
  backgroundColor: "transparent",
};

const countBadgeStyle: CSSProperties = {
  minWidth: 16,
  padding: "1px 5px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  textAlign: "center",
  color: colors.danger,
  backgroundColor: colors.dangerSoft,
};

const countBadgeActiveStyle: CSSProperties = {
  ...countBadgeStyle,
  color: "#7f1d1d",
  backgroundColor: "rgba(15, 23, 42, 0.25)",
};
