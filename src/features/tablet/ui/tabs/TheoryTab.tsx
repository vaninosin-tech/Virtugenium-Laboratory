import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BookOpen, Droplets, FlaskConical } from "lucide-react";

import { LABORATORY_CONTENT } from "../../../../data/content/experiments";
import { THEORY_TOPICS, type TheoryBlock, type TheorySpan, type TheoryTopic } from "../../../../data/content/theory";
import type { Reagent } from "../../../../entities/laboratory";
import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import {
  colors,
  formulaStyle,
  listItemButtonStyle,
  mutedTextStyle,
  sectionTitleStyle,
  splitDetailStyle,
  splitLayoutStyle,
  splitListStyle,
  typography,
} from "../tabletStyles";
import "../scoreProgress.css";

type TheorySelection =
  | { readonly kind: "topic"; readonly topicId: string; readonly sectionId: string | null }
  | { readonly kind: "reagent"; readonly reagentId: string };

function sectionLabel(topic: TheoryTopic, sectionTitle: string): string {
  if (sectionTitle === topic.title) return "Определение";
  return sectionTitle.replace(/:$/, "");
}

function RichText({ spans }: { readonly spans: readonly TheorySpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        const style: CSSProperties = {
          ...(span.em ? { fontStyle: "italic" } : null),
          ...(span.strong ? { fontWeight: typography.weightBold } : null),
          ...(span.mark
            ? { color: colors.accentBright, fontWeight: span.strong ? typography.weightBold : typography.weightSemibold }
            : null),
        };
        if (span.em && !span.strong && !span.mark) {
          return (
            <em key={index} style={style}>
              {span.text}
            </em>
          );
        }
        if (span.strong || span.mark) {
          return (
            <strong key={index} style={style}>
              {span.text}
            </strong>
          );
        }
        if (span.em) {
          return (
            <em key={index} style={style}>
              {span.text}
            </em>
          );
        }
        return (
          <span key={index} style={style}>
            {span.text}
          </span>
        );
      })}
    </>
  );
}

function TheoryTable({ rows }: { readonly rows: Extract<TheoryBlock, { type: "table" }>["rows"] }) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={tableCellStyle(rowIndex === 0)}>
                  {cell.map((para, paraIndex) => (
                    <p key={paraIndex} style={tableParaStyle}>
                      <RichText spans={para} />
                    </p>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TheoryBlocks({ blocks }: { readonly blocks: readonly TheoryBlock[] }) {
  return (
    <div style={blocksStyle}>
      {blocks.map((block, index) => {
        if (block.type === "eq") {
          return (
            <pre key={`eq-${index}`} style={equationStyle}>
              {block.text}
            </pre>
          );
        }
        if (block.type === "img") {
          return (
            <figure key={`img-${index}`} style={figureStyle}>
              <img src={block.src} alt={block.alt} style={imageStyle} loading="lazy" />
            </figure>
          );
        }
        if (block.type === "table") {
          return <TheoryTable key={`tbl-${index}`} rows={block.rows} />;
        }
        return (
          <p key={`p-${index}`} style={paragraphStyle}>
            <RichText spans={block.spans} />
          </p>
        );
      })}
    </div>
  );
}

/** «Теория» — chapters from notes + reagent cards for deep links from errors. */
export function TheoryTab() {
  const theoryFocusId = useLaboratoryStore((state) => state.theoryFocusId);
  const setTheoryFocusId = useLaboratoryStore((state) => state.setTheoryFocusId);
  const reagents = LABORATORY_CONTENT.items.filter(
    (item): item is Reagent => item.category === "reagent",
  );

  const [selection, setSelection] = useState<TheorySelection>(() => ({
    kind: "topic",
    topicId: THEORY_TOPICS[0]?.id ?? "oxides",
    sectionId: THEORY_TOPICS[0]?.sections[0]?.id ?? null,
  }));

  // Consumes a one-shot external "jump to this topic/reagent" request (set
  // from e.g. an error message's deep link) and acknowledges it by clearing
  // `theoryFocusId` back in the shared store — a real effect, not just
  // local-state derivation, since it also has to synchronize that external
  // store's state.
  useEffect(() => {
    if (!theoryFocusId) return;
    const topic = THEORY_TOPICS.find((item) => item.id === theoryFocusId);
    if (topic) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelection({
        kind: "topic",
        topicId: topic.id,
        sectionId: topic.sections[0]?.id ?? null,
      });
      setTheoryFocusId(null);
      return;
    }
    const reagentExists = reagents.some((item) => item.id === theoryFocusId);
    if (reagentExists) {
      setSelection({ kind: "reagent", reagentId: theoryFocusId });
      setTheoryFocusId(null);
    }
  }, [theoryFocusId, reagents, setTheoryFocusId]);

  const activeTopic = useMemo(() => {
    if (selection.kind !== "topic") return null;
    return THEORY_TOPICS.find((topic) => topic.id === selection.topicId) ?? null;
  }, [selection]);

  const activeSection = useMemo(() => {
    if (!activeTopic || selection.kind !== "topic") return null;
    return (
      activeTopic.sections.find((section) => section.id === selection.sectionId) ??
      activeTopic.sections[0] ??
      null
    );
  }, [activeTopic, selection]);

  const previewedReagent =
    selection.kind === "reagent"
      ? (reagents.find((reagent) => reagent.id === selection.reagentId) ?? null)
      : null;

  return (
    <div style={splitLayoutStyle}>
      <div style={splitListStyle}>
        <span style={paneLabelStyle}>Темы</span>
        {THEORY_TOPICS.map((topic) => {
          const active = selection.kind === "topic" && selection.topicId === topic.id;
          return (
            <div key={topic.id}>
              <button
                type="button"
                onClick={() =>
                  setSelection({
                    kind: "topic",
                    topicId: topic.id,
                    sectionId: topic.sections[0]?.id ?? null,
                  })
                }
                style={listItemButtonStyle(active)}
              >
                <span style={thumbStyle(active)}>
                  <BookOpen size={16} color={colors.accentBright} />
                </span>
                <span style={{ flex: "0 1 auto", lineHeight: 1.3 }}>{topic.title}</span>
              </button>
              {active ? (
                <div style={sectionListStyle}>
                  {topic.sections.map((section) => {
                    const sectionActive = selection.sectionId === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() =>
                          setSelection({
                            kind: "topic",
                            topicId: topic.id,
                            sectionId: section.id,
                          })
                        }
                        style={sectionButtonStyle(sectionActive)}
                      >
                        {sectionLabel(topic, section.title)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        <span style={{ ...paneLabelStyle, marginTop: 14 }}>Реагенты</span>
        {reagents.map((reagent) => {
          const isPreviewed = selection.kind === "reagent" && selection.reagentId === reagent.id;
          return (
            <button
              key={reagent.id}
              type="button"
              onClick={() => setSelection({ kind: "reagent", reagentId: reagent.id })}
              style={listItemButtonStyle(isPreviewed)}
            >
              <span style={thumbStyle(isPreviewed)}>
                <Droplets size={16} color={colors.accentBright} />
              </span>
              <span style={{ flex: "0 1 auto", lineHeight: 1.3 }}>{reagent.name}</span>
            </button>
          );
        })}
      </div>

      {activeTopic && activeSection ? (
        <div style={splitDetailStyle}>
          <div style={heroCardStyle}>
            <span style={heroIconStyle}>
              <FlaskConical size={28} color={colors.accentBright} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ ...sectionTitleStyle, margin: 0 }}>{activeTopic.title}</h3>
              <p style={{ ...mutedTextStyle, margin: "6px 0 0" }}>{activeTopic.subtitle}</p>
            </div>
          </div>

          <div className="equation-desc-scroll" style={articleStyle}>
            <h4 style={articleSectionTitleStyle}>{sectionLabel(activeTopic, activeSection.title)}</h4>
            <TheoryBlocks blocks={activeSection.blocks} />
          </div>
        </div>
      ) : null}

      {previewedReagent ? (
        <div style={splitDetailStyle}>
          <div style={heroCardStyle}>
            <span style={heroIconStyle}>
              <BookOpen size={28} color={colors.accentBright} />
            </span>
            <div>
              <h3 style={sectionTitleStyle}>
                {previewedReagent.name}{" "}
                <span style={{ ...formulaStyle, fontSize: typography.sizeTitle }}>
                  ({previewedReagent.formula})
                </span>
              </h3>
              <p style={{ ...mutedTextStyle, margin: "10px 0 0" }}>{previewedReagent.description}</p>
            </div>
          </div>
          <div style={factsGridStyle}>
            <div style={factCardStyle}>
              <span style={factLabelStyle}>Состояние</span>
              <span style={factValueStyle}>{previewedReagent.state}</span>
            </div>
            <div style={factCardStyle}>
              <span style={factLabelStyle}>Цвет</span>
              <span style={factValueStyle}>{previewedReagent.color || "—"}</span>
            </div>
            <div style={factCardStyle}>
              <span style={factLabelStyle}>Прозрачность</span>
              <span style={factValueStyle}>
                {previewedReagent.transparent ? "прозрачный" : "непрозрачный"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const paneLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: colors.accentBright,
  marginBottom: 4,
  flexShrink: 0,
};

const thumbStyle = (active: boolean): CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: active ? colors.accentSoft : "transparent",
  flexShrink: 0,
});

const sectionListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "2px 0 8px 12px",
};

const sectionButtonStyle = (active: boolean): CSSProperties => ({
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  textAlign: "left",
  padding: "6px 8px",
  borderRadius: 6,
  border: "none",
  borderLeft: active ? `2px solid ${colors.accentBright}` : "2px solid transparent",
  backgroundColor: active ? colors.accentSoft : "transparent",
  color: active ? colors.accentBright : colors.textMuted,
  cursor: "pointer",
  fontFamily: typography.fontFamilyBase,
  fontSize: 12,
  fontWeight: active ? typography.weightSemibold : typography.weightMedium,
  lineHeight: 1.35,
});

const heroCardStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
  flexShrink: 0,
};

const heroIconStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.accentSoft,
  flexShrink: 0,
};

const articleStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  paddingRight: 8,
  marginTop: 4,
};

const articleSectionTitleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: typography.sizeBody,
  fontWeight: typography.weightSemibold,
  color: colors.accentBright,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const blocksStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  paddingBottom: 16,
};

const paragraphStyle: CSSProperties = {
  margin: 0,
  fontFamily: typography.fontFamilyBase,
  fontSize: typography.sizeBody,
  fontWeight: typography.weightRegular,
  color: colors.textPrimary,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
};

const equationStyle: CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgInset,
  fontFamily: typography.fontFamilyMono,
  fontSize: 14,
  fontWeight: typography.weightSemibold,
  color: colors.accentBright,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowX: "auto",
};

const figureStyle: CSSProperties = {
  margin: "4px 0 8px",
  padding: 0,
  display: "flex",
  justifyContent: "center",
};

const imageStyle: CSSProperties = {
  maxWidth: "50%",
  width: "50%",
  height: "auto",
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  backgroundColor: "#fff",
  display: "block",
};

const tableWrapStyle: CSSProperties = {
  width: "100%",
  overflowX: "auto",
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgInset,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: typography.fontFamilyBase,
  fontSize: 13,
  color: colors.textPrimary,
};

const tableCellStyle = (header: boolean): CSSProperties => ({
  border: `1px solid ${colors.border}`,
  padding: "8px 10px",
  verticalAlign: "top",
  backgroundColor: header ? colors.accentSoft : "transparent",
  fontWeight: header ? typography.weightSemibold : typography.weightRegular,
});

const tableParaStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
};

const factsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 10,
  marginTop: 18,
};
const factCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minHeight: 72,
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgInset,
  boxShadow: `inset 0 0 0 1px ${colors.accentSoft}`,
};

const factLabelStyle: CSSProperties = {
  fontSize: typography.sizeCaption,
  color: colors.textMuted,
};

const factValueStyle: CSSProperties = {
  fontSize: typography.sizeBody,
  fontWeight: typography.weightBold,
  color: colors.textPure,
};
