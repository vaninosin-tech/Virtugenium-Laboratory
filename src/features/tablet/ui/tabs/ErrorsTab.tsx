import { useState, type CSSProperties } from "react";
import { AlertTriangle, BookOpen, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck } from "lucide-react";

import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import { THEORY_LINK_BY_ERROR_CODE, TOR_ERROR_CATALOG } from "../../lib/errorCatalog";
import {
  colors,
  ghostButtonStyle,
  mutedTextStyle,
  panelStyle,
  sectionTitleStyle,
  touch,
  typography,
} from "../tabletStyles";

const ERROR_LABELS: Record<string, string> = {
  "invalid-data": "Некорректные данные",
  "item-not-found": "Предмет не найден",
  "action-not-allowed": "Действие недопустимо на этом шаге",
  "wrong-order": "Нарушен порядок действий",
  "safety-violation": "Нарушение техники безопасности",
  "incorrect-equation": "Неверное уравнение реакции",
};

/** «Ошибки» — attempt log + catalogue; each entry links to theory. */
export function ErrorsTab() {
  const errors = useLaboratoryStore((state) => state.errors);
  const pushTabletSection = useLaboratoryStore((state) => state.pushTabletSection);
  const setTheoryFocusId = useLaboratoryStore((state) => state.setTheoryFocusId);
  const [openId, setOpenId] = useState<string | null>(null);

  const openTheory = (reagentId: string | null | undefined) => {
    setTheoryFocusId(reagentId ?? null);
    pushTabletSection("theory");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1, minHeight: 0 }}>
      <section>
        <h3 style={{ ...sectionTitleStyle, marginBottom: 12 }}>Ошибки текущей попытки</h3>
        {errors.length === 0 ? (
          <div style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 14, minHeight: 64 }}>
            <ShieldCheck size={28} color={colors.success} />
            <p style={{ ...mutedTextStyle, margin: 0 }}>Пока пусто — список пополняется по мере нарушений.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {errors.map((error, index) => (
              <div key={`${error.code}-${index}`} style={liveErrorStyle}>
                <AlertTriangle size={24} color={colors.danger} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, maxWidth: touch.textMaxWidth }}>
                  <h4 style={{ margin: 0, fontSize: typography.sizeBody, color: colors.danger, fontWeight: 700 }}>
                    {ERROR_LABELS[error.code] ?? error.code}
                  </h4>
                  <p style={{ ...mutedTextStyle, margin: "6px 0 0" }}>{error.message}</p>
                  <button
                    type="button"
                    style={{ ...theoryLinkStyle, marginTop: 10 }}
                    onClick={() => openTheory(THEORY_LINK_BY_ERROR_CODE[error.code])}
                  >
                    <BookOpen size={14} />
                    К теории
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <h3 style={{ ...sectionTitleStyle, marginBottom: 8 }}>Справочник ошибок</h3>
        <p style={{ ...mutedTextStyle, margin: "0 0 12px" }}>
          Каталог из ТЗ. У каждой ошибки есть ссылка на теорию.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {TOR_ERROR_CATALOG.map((entry) => {
            const open = openId === entry.id;
            return (
              <div key={entry.id} style={plaqueStyle(open)}>
                <button
                  type="button"
                  style={plaqueHeaderStyle}
                  onClick={() => setOpenId(open ? null : entry.id)}
                  aria-expanded={open}
                >
                  <span style={alertIconStyle}>
                    <ShieldAlert size={26} color={colors.warning} />
                  </span>
                  <span style={{ flex: 1, fontSize: typography.sizeBody, fontWeight: 700, lineHeight: 1.35 }}>
                    {entry.title}
                  </span>
                  {open ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
                </button>
                {open && (
                  <div style={plaqueBodyStyle}>
                    <div style={illustrationSlotStyle} aria-hidden>
                      <AlertTriangle size={40} color={colors.warning} style={{ opacity: 0.85 }} />
                      <span style={{ fontSize: typography.sizeCaption, color: colors.textMuted }}>
                        Схема / иллюстрация
                      </span>
                    </div>
                    <div style={{ maxWidth: touch.textMaxWidth, flex: 1, minWidth: 0 }}>
                      <p style={{ ...mutedTextStyle, margin: "0 0 10px", color: colors.danger, fontWeight: 600 }}>
                        {entry.shortNotice}
                      </p>
                      <p style={{ ...mutedTextStyle, margin: "0 0 12px" }}>{entry.rationale}</p>
                      <button
                        type="button"
                        style={theoryLinkStyle}
                        onClick={() => openTheory(entry.theoryReagentId)}
                      >
                        <BookOpen size={14} />
                        К теории
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const liveErrorStyle: CSSProperties = {
  ...panelStyle,
  borderColor: "rgba(248, 113, 113, 0.45)",
  backgroundColor: colors.dangerSoft,
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  minHeight: touch.comfortableTarget,
};

const theoryLinkStyle: CSSProperties = {
  ...ghostButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 36,
  padding: "6px 12px",
  color: colors.accentBright,
  borderColor: colors.borderStrong,
};

const plaqueStyle = (open: boolean): CSSProperties => ({
  borderRadius: 16,
  border: `1px solid ${open ? "rgba(251, 191, 36, 0.55)" : colors.border}`,
  backgroundColor: open ? "rgba(251, 191, 36, 0.08)" : colors.bgElevated,
  overflow: "hidden",
});

const plaqueHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  width: "100%",
  minHeight: 64,
  padding: "14px 16px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  color: colors.textPrimary,
  fontFamily: typography.fontFamilyBase,
};

const alertIconStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.warningSoft,
  flexShrink: 0,
};

const plaqueBodyStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  padding: "0 16px 16px",
  flexWrap: "wrap",
};

const illustrationSlotStyle: CSSProperties = {
  width: 160,
  minHeight: 120,
  borderRadius: 14,
  border: `1px dashed rgba(251, 191, 36, 0.45)`,
  backgroundColor: colors.bgInset,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flexShrink: 0,
};
