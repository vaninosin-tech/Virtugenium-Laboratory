import { useEffect, useRef, type CSSProperties } from "react";

import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { HAND, useHandStore } from "../lib/useHandStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";

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

type Row = readonly [keys: string, what: string];

/**
 * The controls for what the player is doing right now, bottom right:
 * looking round the room, at a zone, or with something in the hand.
 */
export function ControlsHint() {
  const held = useHandStore((state) => state.held);
  const tabletOpen = useLaboratoryStore((state) => state.tabletOpen);
  const heating = useHeatingStore((state) => state.active);
  const target = useSceneInteractionStore((state) => state.activeTargetId);
  const phase = useSceneInteractionStore((state) => state.cabinetPhase);
  const locked = useSceneInteractionStore((state) => state.isPointerLocked);

  // The tablet and the heating panel carry their own instructions.
  if (tabletOpen || heating) return null;

  let rows: readonly Row[];
  if (held?.kind === "workbench-tube") {
    rows = [
      ["Мышь", "вести пробирку"],
      ["ЛКМ у лапки", "закрепить в штативе"],
      ["К склянке", "набрать реактив"],
      ["Двойной ЛКМ", "положить на место"],
    ];
  } else if (held) {
    rows = [
      ["Мышь", "вести предмет"],
      ["ЛКМ у цели", held.kind === "bottle" ? "налить в пробирку в лапке" : "закрепить или перелить"],
      ["Двойной ЛКМ", "положить на место"],
      ["Esc", "положить на место"],
    ];
  } else if (target === "overview" && phase === "room") {
    rows = locked
      ? [
          ["Мышь", "осмотреться"],
          ["ЛКМ", "подойти к зоне под прицелом"],
          ["ПКМ", "скрыть / показать прицел"],
          ["Esc", "освободить курсор"],
        ]
      : [["ЛКМ", "продолжить осмотр"]];
  } else if (phase === "inspecting" && target !== "fume-hood") {
    rows = [
      ["ЛКМ по предмету", "взять на поднос"],
      ["Назад / Esc", "к общему виду"],
    ];
  } else {
    rows = [
      ["ЛКМ по предмету", "взять в руку"],
      ["Наведите", "подсказка, что будет"],
      ["Назад / Esc", "к общему виду"],
    ];
  }

  return (
    <div style={panelStyle} data-testid="controls-hint">
      {rows.map(([keys, what]) => (
        <div key={keys} style={rowStyle}>
          <span style={keyStyle}>{keys}</span>
          <span>{what}</span>
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

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 20,
  bottom: 64,
  zIndex: 10,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid rgba(56, 189, 248, 0.25)",
  background: "rgba(8, 14, 26, 0.72)",
  color: "#cbd5e1",
  fontSize: 12,
  lineHeight: 1.4,
  pointerEvents: "none",
};

const rowStyle: CSSProperties = { display: "flex", gap: 10, justifyContent: "space-between" };

const keyStyle: CSSProperties = { color: "#7dd3fc", fontWeight: 700, whiteSpace: "nowrap" };
