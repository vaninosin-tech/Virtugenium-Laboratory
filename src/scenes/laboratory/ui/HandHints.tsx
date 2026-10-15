import { useEffect, useRef, type CSSProperties } from "react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { HAND, useHandStore } from "../lib/useHandStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useTubeCloseUpStore } from "../lib/useTubeCloseUpStore";
import { ControlGlyph, type ControlKey } from "./ControlGlyphs";
// Golos Text (ParaType, SIL OFL 1.1) — built for on-screen Russian; self-hosted for the offline Tauri build.
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/700.css";

/** Below-right of the held item, so the caption never covers it. */
const OFFSET_X = 26;
const OFFSET_Y = 26;

/**
 * The caption next to the item in the hand (VL-015): what a click does here
 * («Закрепить пробирку в лапке штатива»), or in red, why not. The cursor is
 * gone while holding, so it follows the item rather than the mouse.
 * Position and text go straight to the DOM from one rAF loop.
 */
export function HeldItemHint() {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let frame = 0;
    const refresh = () => {
      frame = requestAnimationFrame(refresh);
      const action = useHandStore.getState().held ? HAND.action : null;
      if (!action) {
        if (box.style.display !== "none") box.style.display = "none";
        return;
      }
      box.style.display = "block";
      box.style.transform = `translate(${HAND.screen.x + OFFSET_X}px, ${HAND.screen.y + OFFSET_Y}px)`;
      if (box.textContent !== action.label) box.textContent = action.label;
      const tone = action.blocked ? "blocked" : "action";
      if (box.dataset.tone !== tone) {
        box.dataset.tone = tone;
        box.style.borderColor = action.blocked ? "rgba(248, 113, 113, 0.7)" : "rgba(56, 189, 248, 0.55)";
        box.style.color = action.blocked ? "#fecaca" : "#e6f6ff";
      }
    };
    frame = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <div ref={boxRef} style={hintStyle} data-testid="held-hint" />;
}

interface Row {
  readonly controls: readonly ControlKey[];
  /** Where/how, after the drawn control: «у лапки», «по предмету». */
  readonly at?: string;
  readonly what: string;
}

/**
 * The controls for what the player is doing right now, bottom right:
 * looking round the room, at a zone, or with something in the hand.
 */
export function ControlsHint() {
  const held = useHandStore((state) => state.held);
  const closeUpViewing = useTubeCloseUpStore((state) => state.viewing);
  const tabletOpen = useLaboratoryStore((state) => state.tabletOpen);
  const heating = useHeatingStore((state) => state.active);
  const target = useSceneInteractionStore((state) => state.activeTargetId);
  const phase = useSceneInteractionStore((state) => state.cabinetPhase);
  const locked = useSceneInteractionStore((state) => state.isPointerLocked);
  const aimDisabled = useSceneInteractionStore((state) => state.aimDisabled);

  // The tablet and the heating panel carry their own instructions.
  if (tabletOpen || heating) return null;

  // Kept to a word or two each: the drawn control already says most of it.
  let rows: readonly Row[];
  if (held?.kind === "workbench-tube") {
    rows = [
      { controls: ["mouse"], what: "вести" },
      { controls: ["lmb"], at: "у лапки", what: "закрепить" },
      { controls: ["mouse"], at: "к склянке", what: "набрать" },
      { controls: ["rmb"], what: "вернуть" },
    ];
  } else if (held) {
    rows = [
      { controls: ["mouse"], what: "вести" },
      { controls: ["lmb"], at: "у цели", what: held.kind === "bottle" ? "налить" : "закрепить / перелить" },
      { controls: ["rmb", "esc"], what: "вернуть" },
    ];
  } else if (target === "overview" && phase === "room") {
    rows = !locked
      ? [{ controls: ["lmb"], what: "осмотр" }]
      : aimDisabled
        ? [
            { controls: ["mouse"], what: "осмотр" },
            { controls: ["rmb"], what: "вернуть прицел" },
            { controls: ["esc"], what: "курсор" },
          ]
        : [
            { controls: ["mouse"], what: "осмотр" },
            { controls: ["lmb"], what: "подойти" },
            { controls: ["rmb"], what: "убрать прицел" },
            { controls: ["esc"], what: "курсор" },
          ];
  } else if (phase === "inspecting" && target !== "fume-hood") {
    rows = [
      { controls: ["lmb"], at: "по предмету", what: "на поднос" },
      { controls: ["esc"], what: "к обзору" },
    ];
  } else {
    rows = closeUpViewing
      ? [{ controls: ["q", "esc"], what: "отойти от пробирки" }]
      : [
          { controls: ["lmb"], at: "по предмету", what: "взять" },
          { controls: ["hover"], at: "наведите", what: "подсказка" },
          { controls: ["q"], what: "ближе к пробирке" },
          { controls: ["esc"], what: "к обзору" },
        ];
  }

  // E works everywhere in the lab; with something in the hand the rows stay about the hand.
  const shown: readonly Row[] = held ? rows : [...rows, { controls: ["e"], what: "планшет" }];

  return (
    <div style={panelStyle} data-testid="controls-hint">
      {shown.map((row) => (
        <div key={`${row.controls.join("+")}:${row.what}`} style={rowStyle}>
          <span style={controlsStyle}>
            {row.controls.map((control) => (
              <ControlGlyph key={control} control={control} />
            ))}
          </span>
          <span style={textStyle}>
            {row.at ? <span style={atStyle}>{row.at} </span> : null}— {row.what}
          </span>
        </div>
      ))}
    </div>
  );
}

const hintStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  zIndex: 30,
  display: "none",
  maxWidth: 320,
  padding: "7px 11px",
  borderRadius: 9,
  border: "1px solid rgba(56, 189, 248, 0.55)",
  background: "rgba(8, 14, 26, 0.92)",
  boxShadow: "0 4px 18px rgba(0, 0, 0, 0.35)",
  color: "#e6f6ff",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.35,
  pointerEvents: "none",
  whiteSpace: "nowrap",
};

/**
 * No backing panel: the text sits straight on the scene, so it carries its own
 * contrast — one colour throughout, a dark outline drawn under the glyphs
 * (`paint-order`) and a soft shadow, readable over the white walls and the
 * dark furniture alike. The drawn controls (`ControlGlyph`) get the same
 * outline. Controls in one column, text in the next, both left-aligned.
 */
const panelStyle: CSSProperties = {
  position: "absolute",
  right: 24,
  bottom: 64,
  zIndex: 10,
  display: "grid",
  gridTemplateColumns: "auto auto",
  columnGap: 12,
  rowGap: 10,
  alignItems: "center",
  justifyItems: "start",
  color: "#ffffff",
  fontFamily: '"Golos Text", "Segoe UI", Arial, sans-serif',
  fontSize: 18,
  fontWeight: 500,
  lineHeight: 1.35,
  WebkitTextStroke: "3px rgba(0, 0, 0, 0.7)",
  paintOrder: "stroke fill",
  textShadow: "0 1px 4px rgba(0, 0, 0, 0.6)",
  pointerEvents: "none",
};

/** `display: contents` puts each row's control and text straight into the panel's two grid columns. */
const rowStyle: CSSProperties = { display: "contents" };

/** Centred in its column, so glyphs of different widths (mouse, Esc key) stack on one axis. */
const controlsStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, justifySelf: "center" };

const textStyle: CSSProperties = { whiteSpace: "nowrap" };

const atStyle: CSSProperties = { fontWeight: 700 };
