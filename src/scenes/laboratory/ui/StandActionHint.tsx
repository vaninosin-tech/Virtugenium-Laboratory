import { useEffect, useRef, type CSSProperties } from "react";

import { standActionFor, takeLabel } from "../lib/standTableActions";
import { useHandStore } from "../lib/useHandStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useStandHintStore } from "../lib/useStandHintStore";

/** Offset from the cursor's hot spot, so the caption never sits under the pointer itself. */
const CURSOR_OFFSET_X = 18;
const CURSOR_OFFSET_Y = 20;

/**
 * The caption next to the cursor over a table object: what clicking it will
 * do («Прилить HNO₃ в пробирку в лапке»), or in red, why nothing will
 * («Сначала закрепите пробирку в лапке штатива»). This replaces the stand's
 * action menu — the player reads the action off the object itself.
 *
 * Position and text are written straight to the DOM (mousemove / one rAF
 * loop) rather than through React state: both change far more often than
 * anything here needs to re-render for.
 */
export function StandActionHint() {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // The 3D scene only hears the cursor leave an object while the cursor
    // is over the canvas: once the tablet or any panel is in the way (or the
    // camera flew off) no `pointerout` comes. So the caption shows only over
    // the canvas, or over DOM controls that set it themselves.
    let overScene = false;
    const handleMove = (event: MouseEvent) => {
      box.style.transform = `translate(${event.clientX + CURSOR_OFFSET_X}px, ${event.clientY + CURSOR_OFFSET_Y}px)`;
      const under = event.target as Element | null;
      overScene = under instanceof HTMLCanvasElement || !!under?.closest?.("[data-stand-hint]");
    };
    // A new zone: whatever was under the cursor is not any more.
    const unsubscribeZone = useSceneInteractionStore.subscribe((state, previous) => {
      if (state.activeTargetId !== previous.activeTargetId || state.cabinetPhase !== previous.cabinetPhase) {
        useStandHintStore.setState({ target: null, owner: null });
      }
    });
    let frame = 0;
    let shownFor: unknown = null;
    const refresh = () => {
      frame = requestAnimationFrame(refresh);
      const target = useStandHintStore.getState().target;
      // A new object under the cursor has just set its own cursor in its
      // `pointerover`; forget the tone so ours is applied over it.
      if (target !== shownFor) {
        shownFor = target;
        delete box.dataset.tone;
      }
      // Bottles and rack tubes are taken into the hand; the stand's own parts act.
      const takeable = target?.kind === "bottle" || target?.kind === "rack-tube";
      const take = takeable ? takeLabel(target) : null;
      const next =
        !target || !overScene || useHandStore.getState().held
          ? null
          : takeable
            ? take
              ? { label: take, blocked: false }
              : null
            : standActionFor(target);
      if (!next) {
        if (box.style.display !== "none") box.style.display = "none";
        return;
      }
      box.style.display = "block";
      if (box.textContent !== next.label) box.textContent = next.label;
      const tone = next.blocked ? "blocked" : "action";
      if (box.dataset.tone !== tone) {
        box.dataset.tone = tone;
        Object.assign(box.style, TONES[tone]);
        document.body.style.cursor = next.blocked ? "not-allowed" : "pointer";
      }
    };
    window.addEventListener("mousemove", handleMove);
    frame = requestAnimationFrame(refresh);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      unsubscribeZone();
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={boxRef} style={boxStyle} data-testid="stand-hint" />;
}

const TONES: Record<"action" | "blocked", Partial<CSSStyleDeclaration>> = {
  action: { borderColor: "rgba(56, 189, 248, 0.55)", color: "#e6f6ff" },
  blocked: { borderColor: "rgba(248, 113, 113, 0.7)", color: "#fecaca" },
};

const boxStyle: CSSProperties = {
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
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.35,
  pointerEvents: "none",
  whiteSpace: "nowrap",
};
