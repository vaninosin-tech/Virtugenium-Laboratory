import { useEffect, type CSSProperties } from "react";

import { REAGENTS } from "../../../entities/laboratory/reagents";
import { useNavButtonCalibrationStore, type InspectionButtonConfig } from "../lib/useNavButtonCalibrationStore";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { TRAY_CAPACITY, useReagentStorageStore } from "../lib/useReagentStorageStore";
import { clickWorkbenchRackTube } from "../lib/standTableActions";
import { useStandHintStore } from "../lib/useStandHintStore";
import { useTestTubeDragStore } from "../lib/useTestTubeDragStore";
import { useTestTubeHoverStore } from "../lib/useTestTubeHoverStore";
import { TEST_TUBE_TRAY_CAPACITY, tubeSlotRowCol, useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";

/**
 * Contents label for a filled-but-still-empty tube's button (no `reagentId`
 * yet — see `StoredTestTube`'s own doc, set once the held tube gets hovered
 * near a workbench jar). A filled-AND-loaded tube shows that reagent's own
 * `formula` instead (`REAGENTS[reagentId].formula`, the same field a jar's
 * shelf label uses) — see `TubeContentsButton`'s `label`.
 */
const TEST_TUBE_CONTENTS_PLACEHOLDER = "—";

/**
 * HTML overlay for reagent bottle inspection: the background tint (blur
 * itself is a `DepthOfField` postprocessing pass added in `Laboratory.tsx`,
 * gated on the same `inspectedId` — which now stays set for the WHOLE
 * return flight, not just while actively inspecting, so the blur doesn't
 * cut out mid-animation) plus the ОСТАВИТЬ/ВЗЯТЬ buttons. The buttons
 * disappear the instant ОСТАВИТЬ/ESC is pressed (`isClosing`) even though
 * the tint/blur linger until the bottle actually reaches the shelf. ESC is
 * equivalent to ОСТАВИТЬ; this listener only fires while actively
 * inspecting (not once a return is already in progress), and only while a
 * reagent is inspected at all, so it never intercepts ESC's other meanings
 * (returning from a cabinet, etc. — see `CameraRig`).
 *
 * Button size/position come from `useNavButtonCalibrationStore`'s
 * `inspectionButtons` (F9 panel, "INSPECTION BUTTONS" section) instead of
 * hardcoded CSS, so they're live-tunable without a rebuild.
 */
export function ReagentInspectionOverlay() {
  const inspectedId = useReagentInspectionStore((state) => state.inspectedId);
  const isClosing = useReagentInspectionStore((state) => state.isClosing);
  const isTaking = useReagentInspectionStore((state) => state.isTaking);
  const canShake = useReagentInspectionStore((state) => state.canShake);
  const isShaking = useReagentInspectionStore((state) => state.isShaking);
  const isShakeLocked = useReagentInspectionStore((state) => state.isShakeLocked);
  const requestShake = useReagentInspectionStore((state) => state.requestShake);
  const requestClose = useReagentInspectionStore((state) => state.requestClose);
  const requestTake = useReagentInspectionStore((state) => state.requestTake);
  const kind = useReagentInspectionStore((state) => state.kind);
  const leaveConfig = useNavButtonCalibrationStore((state) => state.inspectionButtons.left);
  const takeConfig = useNavButtonCalibrationStore((state) => state.inspectionButtons.right);
  const trayItemCount = useReagentStorageStore((state) => state.trayItems.length);
  const trayTestTubeCount = useTestTubeStorageStore((state) => state.trayTestTubes.length);
  const canTake = kind === "test-tube" ? trayTestTubeCount < TEST_TUBE_TRAY_CAPACITY : trayItemCount < TRAY_CAPACITY;
  // A "holder" (e.g. the workbench test tube rack itself) is a fixed prop —
  // there's nothing to add to a tray, so it only ever gets ОСТАВИТЬ.
  const showTakeButton = kind !== "holder";
  const workbenchTubeCount = useTestTubeStorageStore((state) => state.workbenchTestTubes.length);
  // `leaveConfig.offsetX` is tuned for the reagent/test-tube layout, where
  // ОСТАВИТЬ sits to one side of ВЗЯТЬ. A "holder" never shows ВЗЯТЬ, so it
  // gets its own centered copy instead of inheriting that side-offset —
  // without touching the shared calibration the other two kinds still use.
  const leaveButtonConfig = kind === "holder" ? { ...leaveConfig, offsetX: 0 } : leaveConfig;

  useEffect(() => {
    if (!inspectedId || isClosing || isTaking) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [inspectedId, isClosing, isTaking, requestClose]);

  // A tube picked up from the button grid stays held well after the holder
  // itself has fully closed (that's the whole point — see the button's own
  // `onClick` doc) and its button, along with the OTHER Escape handler
  // above (which only runs while `inspectedId` is set), is long gone by
  // then. This one is NOT gated on `inspectedId`, so Escape still drops the
  // tube back into its slot however far into the "table" view the player
  // has since wandered.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") useTestTubeDragStore.getState().release();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!inspectedId) return null;

  return (
    <>
      <div style={tintStyle} />
      {!isClosing && !isTaking && (
        <>
          {kind === "holder" && (
            <div style={tubeButtonGridStyle(leaveButtonConfig)}>
              {TUBE_SLOT_INDICES.map((index) => (
                <TubeContentsButton key={index} index={index} filled={index < workbenchTubeCount} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={requestClose}
            disabled={isShakeLocked}
            data-dev-pick-id="inspection:left"
            style={buttonPositionStyle(leaveButtonConfig, leaveButtonStyle)}
          >
            ОСТАВИТЬ
          </button>
          {showTakeButton && (
            <button
              type="button"
              disabled={!canTake || isShakeLocked}
              aria-disabled={!canTake || isShakeLocked}
              onClick={canTake ? requestTake : undefined}
              data-dev-pick-id="inspection:right"
              style={buttonPositionStyle(takeConfig, canTake && !isShakeLocked ? takeActiveButtonStyle : takeButtonStyle)}
            >
              ВЗЯТЬ
            </button>
          )}
          {/* Keep the control visible throughout the liquid-settling tail,
              but use the short control lock so it lights up as soon as the
              deliberate tilt is over. */}
          {(canShake || isShaking) && kind === "reagent" && (
            <button type="button" onClick={requestShake} disabled={isShakeLocked}
              aria-label="Покачать" aria-busy={isShaking}
              style={{ ...baseButtonStyle, position: "absolute", left: "50%",
                top: `max(12px, calc(${Math.min(leaveConfig.top, takeConfig.top)}% - 54px))`,
                transform: "translateX(-50%)", padding: "10px 20px", borderRadius: 12,
                fontSize: 14, cursor: isShakeLocked ? "default" : "pointer", opacity: isShakeLocked ? 0.6 : 1 }}>
              ПОКАЧАТЬ
            </button>
          )}
        </>
      )}
    </>
  );
}

/** 2 rows × 8 columns — the rack's own physical layout (see `useTestTubeStorageStore`'s slot-grid doc). */
const TUBE_GRID_ROWS = 2;
const TUBE_GRID_COLS = 8;
const TUBE_SLOT_INDICES = Array.from({ length: TUBE_GRID_ROWS * TUBE_GRID_COLS }, (_, index) => index);

/**
 * Every button is this exact size regardless of its label — a fixed grid
 * cell, not shrink-to-fit, so every button reads as the same size at a
 * glance. Sized deliberately roomy (not the tightest fit for a short
 * placeholder) so a real, longer chemical formula has enough width/height
 * to actually read in full most of the time — see `tubeButtonLabelStyle`'s
 * doc for what still happens if one doesn't fit even at this size.
 */
const TUBE_BUTTON_WIDTH = 130;
const TUBE_BUTTON_HEIGHT = 70;
const TUBE_GRID_GAP = 8;
const TUBE_GRID_HEIGHT = TUBE_BUTTON_HEIGHT * TUBE_GRID_ROWS + TUBE_GRID_GAP * (TUBE_GRID_ROWS - 1);

/**
 * One button per physical hole in the rack — hovering it highlights (and
 * raises) the matching 3D tube via the SAME `useTestTubeHoverStore` the tube
 * itself reads (`InspectableTestTubeSlot`), so the two stay in sync no
 * matter which side the player hovers from. An empty hole's button is
 * present (so the 2×8 grid always looks the same) but inert — nothing to
 * show or hover yet. Clicking it toggles `useTestTubeDragStore`: picks the
 * tube up (it follows the cursor in 3D — see `InspectableTestTubeSlot`) if
 * nothing else is being held right now, or drops it back in its slot if
 * it's the one already held. Clicking a DIFFERENT tube's button while one
 * is held just switches which one follows the cursor — the previous one's
 * `isHeld` flips false on its own and it animates back into place.
 */
function TubeContentsButton({ index, filled }: { readonly index: number; readonly filled: boolean }) {
  const instanceId = `workbench-tube-slot-${index}`;
  const hovered = useTestTubeHoverStore((state) => filled && state.hoveredInstanceId === instanceId);
  const held = useTestTubeDragStore((state) => filled && state.heldInstanceId === instanceId);
  // SAME `tubeSlotRowCol` the 3D tube's own position comes from
  // (`computeTubeSlotLocalOffset`) — row 1 (fills first) lands in grid row
  // 1 (the TOP, via `TUBE_GRID_ROWS - row`), so this button grid always
  // matches both "top row fills first" and where each tube actually stands
  // in the rack.
  const { row, col } = tubeSlotRowCol(index);
  const contents = useTestTubeStorageStore((state) => state.workbenchTestTubes[index]?.contents);
  // Every reagent in the tube, in the order it went in — a mixture reads as
  // "Cu + HNO₃" rather than hiding everything but the first thing poured.
  const formula = contents?.length
    ? contents
        .map((id) => REAGENTS[id as keyof typeof REAGENTS]?.formula ?? id)
        .join(" + ")
    : undefined;
  const label = filled ? (formula ?? TEST_TUBE_CONTENTS_PLACEHOLDER) : "";

  return (
    <button
      type="button"
      tabIndex={filled ? 0 : -1}
      // No native `title` tooltip — this ships as a packaged desktop app
      // (see `src-tauri`), not a page viewed in a browser chrome, so a
      // browser-hover tooltip isn't a UI affordance to lean on here. The
      // button is sized generously (`TUBE_BUTTON_WIDTH`/`_HEIGHT`) so most
      // real labels fit outright; anything that still doesn't just
      // truncates with "…" (`tubeButtonLabelStyle`'s line-clamp).
      style={{
        ...tubeButtonBaseStyle,
        gridRow: TUBE_GRID_ROWS - row,
        gridColumn: col + 1,
        cursor: filled ? "pointer" : "default",
        ...(filled ? undefined : tubeButtonEmptyStyle),
        ...(hovered ? tubeButtonHoveredStyle : undefined),
        ...(held ? tubeButtonHeldStyle : undefined),
      }}
      // Same `clickWorkbenchRackTube` a direct click on the tube itself uses in the
      // 3D view (`InspectableTestTubeSlot`) — this button and that click are
      // two entry points to the identical behavior.
      onClick={filled ? () => clickWorkbenchRackTube(index, instanceId) : undefined}
      // Its caption comes from `StandActionHint`, which otherwise shows only over the 3D scene.
      data-stand-hint
      onPointerEnter={
        filled
          ? () => {
              useTestTubeHoverStore.getState().setHovered(instanceId);
              useStandHintStore.getState().show(instanceId, { kind: "rack-tube", location: "workbench", index });
            }
          : undefined
      }
      onPointerLeave={
        filled
          ? () => {
              useTestTubeHoverStore.getState().clearIfHovered(instanceId);
              useStandHintStore.getState().hide(instanceId);
            }
          : undefined
      }
    >
      <span style={tubeButtonLabelStyle}>{label}</span>
    </button>
  );
}

/** Positioned as a block sitting just above ОСТАВИТЬ (anchored to the SAME `leaveConfig.top` the button itself uses, so the two move together under F8 tuning) — "under the holder" in the sense that the rack floats above this whole row while inspected. */
function tubeButtonGridStyle(leaveConfig: InspectionButtonConfig): CSSProperties {
  return {
    position: "absolute",
    left: "50%",
    top: `max(12px, calc(${leaveConfig.top}% - ${TUBE_GRID_HEIGHT + 24}px))`,
    transform: "translateX(-50%)",
    zIndex: 15,
    display: "grid",
    gridTemplateColumns: `repeat(${TUBE_GRID_COLS}, ${TUBE_BUTTON_WIDTH}px)`,
    gridTemplateRows: `repeat(${TUBE_GRID_ROWS}, ${TUBE_BUTTON_HEIGHT}px)`,
    gap: TUBE_GRID_GAP,
  };
}

const tubeButtonBaseStyle: CSSProperties = {
  width: TUBE_BUTTON_WIDTH,
  height: TUBE_BUTTON_HEIGHT,
  zIndex: 15,
  pointerEvents: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 6px",
  borderRadius: 8,
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(8, 14, 26, 0.96))",
  border: "1px solid rgba(56, 189, 248, 0.35)",
  color: "#7fd4ff",
  cursor: "default",
};

/**
 * ONE fixed font size for every button, filled or empty, short label or
 * long — a size that varied per label (an earlier version stepped it down
 * for longer text) made neighboring buttons look visually inconsistent,
 * which is exactly the "same size" the player asked for in the first place.
 * A label that STILL doesn't fit within `TUBE_LABEL_MAX_LINES` lines at this
 * size (rare now that the button itself is bigger) is truncated with "…"
 * (`WebkitLineClamp`) rather than overflowing the button.
 */
const TUBE_LABEL_MAX_LINES = 4;
const tubeButtonLabelStyle: CSSProperties = {
  width: "100%",
  fontSize: 12,
  lineHeight: 1.25,
  fontFamily: "monospace",
  textAlign: "center",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  display: "-webkit-box",
  WebkitLineClamp: TUBE_LABEL_MAX_LINES,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const tubeButtonHoveredStyle: CSSProperties = {
  border: "1px solid rgba(56, 189, 248, 0.9)",
  boxShadow: "0 0 14px rgba(56, 189, 248, 0.45)",
  color: "#e0f6ff",
};

/** The tube currently picked up and following the cursor — a distinct green accent (matching ВЗЯТЬ's own color elsewhere) so it reads as "active/held" at a glance, separate from a plain hover. */
const tubeButtonHeldStyle: CSSProperties = {
  border: "1px solid rgba(74, 222, 128, 0.9)",
  boxShadow: "0 0 14px rgba(34, 197, 94, 0.5)",
  color: "#4ade80",
};

/** No tube in this hole — present so the grid always shows the full 2×8 shape, but dimmed and non-interactive (`pointerEvents: none`). */
const tubeButtonEmptyStyle: CSSProperties = {
  opacity: 0.35,
  pointerEvents: "none",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  color: "#64748b",
};

/** Each button is independently centered on its own `offsetX` from the viewport's horizontal center (not laid out as a flex pair), matching how the F9 panel edits them one at a time. */
function buttonPositionStyle(config: InspectionButtonConfig, base: CSSProperties): CSSProperties {
  return {
    ...base,
    position: "absolute",
    left: `calc(50% + ${config.offsetX}px)`,
    top: `${config.top}%`,
    transform: "translateX(-50%)",
    width: config.width,
    height: config.height,
    fontSize: config.fontSize,
  };
}

/** Darkening + cyan atmospheric tint — the actual blur is a separate GPU postprocessing pass (`DepthOfField` in Laboratory.tsx); this is just the color wash. `pointerEvents: none` so it never blocks the drag-rotation handlers underneath. */
const tintStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 12,
  pointerEvents: "none",
  background: "rgba(8, 20, 36, 0.32)",
  boxShadow: "inset 0 0 180px rgba(0, 0, 0, 0.4)",
};

const baseButtonStyle: CSSProperties = {
  zIndex: 15,
  pointerEvents: "auto",
  borderRadius: 18,
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "0.08em",
  fontFamily: "monospace",
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(8, 14, 26, 0.96))",
  border: "1px solid rgba(56, 189, 248, 0.5)",
  color: "#7fd4ff",
};

const leaveButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  cursor: "pointer",
  boxShadow: "0 0 20px rgba(56, 189, 248, 0.3)",
};

/** ВЗЯТЬ, active: a distinct green accent (vs. ОСТАВИТЬ's cyan) so the two read as different actions at a glance. */
const takeActiveButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  cursor: "pointer",
  color: "#4ade80",
  border: "1px solid rgba(74, 222, 128, 0.5)",
  boxShadow: "0 0 20px rgba(34, 197, 94, 0.3)",
};

/** ВЗЯТЬ, disabled (tray full): dimmed opacity, muted color, no glow, and the native `disabled` attribute (blocks clicks and shows the platform's not-allowed cursor). */
const takeButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  opacity: 0.4,
  cursor: "not-allowed",
  color: "#94a3b8",
  border: "1px solid rgba(148, 163, 184, 0.35)",
};
