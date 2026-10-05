import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { getChainNeighbors } from "../lib/layout";
import { useNavButtonCalibrationStore, type NavButtonConfig } from "../lib/useNavButtonCalibrationStore";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { unloadTray } from "../lib/trayCarry";

/**
 * HTML overlay controls shown while focused on a piece of interactive
 * furniture (any `activeTargetId !== "overview"`): a single bottom "back"
 * chevron, shared by every cabinet/equipment/table (replaces the old top-right
 * "Вернуться к общему обзору" button — see `Laboratory.tsx`'s
 * `zonePanelStyle`, which now only shows the zone label), plus left/right
 * chain chevrons that only exist for the six reagent-family cabinets (see
 * `CABINET_CHAIN_ORDER`) and only once the camera has actually settled
 * (`cabinetPhase === "inspecting"`) — they must not appear mid-flight.
 * Rendered outside the R3F `<Canvas>`, next to `Tablet`/`CameraCalibrationPanel`.
 *
 * "Scientific HUD" visual language: dark glassy rounded-rect body, cyan
 * accent glow, stroked chevron glyphs (no text) — the bottom "back" control
 * reads as "back" purely from its down-pointing chevron + placement.
 */
/** Splits a nav-button calibration entry into the CSS `width`/`height` for the button box, so live edits from `NavButtonCalibrationPanel` (F9) resize it independently from the icon inside. */
function buttonBoxStyle(config: NavButtonConfig) {
  return { width: `${config.buttonWidth}px`, height: `${config.buttonHeight}px` };
}

/**
 * ONE canonical chevron ("<"), two equal straight strokes meeting at a
 * point — everything else is a CSS transform of this same shape, never a
 * second hand-drawn path:
 *   RIGHT  = this shape mirrored (`scaleX(-1)`)
 *   BOTTOM = this shape rotated -90° (verified: rotating the left-pointing
 *            tip (30,50) by -90° around the viewBox center (50,50) lands it
 *            at (50,70) — the bottom-center — producing "∨", not "∧")
 * The viewBox is a symmetric 100x100 box centered on the chevron's own
 * bounding box, so `preserveAspectRatio="xMidYMid meet"` centers it inside
 * ANY icon box size with no manual offsets — resizing the icon box or the
 * button box just rescales/recenters this one element.
 */
const CHEVRON_PATH = "M70,20 L30,50 L70,80";

/** Must match `.vg-hud-back`'s own `bottom` in `HUD_BUTTON_CSS`. */
const BACK_BUTTON_BOTTOM = 28;
const STACK_GAP = 12;

function Chevron({
  width,
  height,
  mirrored,
  rotated,
}: {
  width: number;
  height: number;
  mirrored?: boolean;
  rotated?: boolean;
}) {
  const classNames = ["vg-hud-icon-group"];
  if (mirrored) classNames.push("vg-hud-icon-group--mirrored");
  if (rotated) classNames.push("vg-hud-icon-group--rotated");
  return (
    <span className={classNames.join(" ")} style={{ width, height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" className="vg-hud-svg-icon">
        <path d={CHEVRON_PATH} className="vg-hud-chevron-path" />
      </svg>
    </span>
  );
}

export function InspectionControls({ onBack }: { readonly onBack: () => void }) {
  const activeTargetId = useSceneInteractionStore((state) => state.activeTargetId);
  const cabinetPhase = useSceneInteractionStore((state) => state.cabinetPhase);
  const focusedCabinetId = useSceneInteractionStore((state) => state.focusedCabinetId);
  const requestCabinetSwitch = useSceneInteractionStore((state) => state.requestCabinetSwitch);
  const navButtonValues = useNavButtonCalibrationStore((state) => state.values);
  const sideDistance = useNavButtonCalibrationStore((state) => state.sideDistance);
  // Triangle size is independent of button size — driven directly by triangleWidth/triangleHeight
  // (F9 panel "Triangle W/H"), not derived as a fraction of buttonWidth/buttonHeight.
  const sideIconWidth = navButtonValues.left.triangleWidth;
  const sideIconHeight = navButtonValues.left.triangleHeight;
  const backIconWidth = navButtonValues.bottom.triangleWidth;
  const backIconHeight = navButtonValues.bottom.triangleHeight;

  // Hidden outright mid-flight ("focusing"/"returning") — covers the
  // initial room→cabinet approach, the return-to-room flight, AND a
  // chain-switch (which is also just "focusing", see CameraRig's
  // startSwitchingCabinet/advanceCabinetSwitchClose) — every button
  // disappears for that whole transition, not just the side chevrons, and
  // reappears once the camera actually settles.
  const controlsSettled = cabinetPhase === "room" || cabinetPhase === "inspecting";
  const showBack = activeTargetId !== "overview" && controlsSettled;
  const showChainArrows = cabinetPhase === "inspecting" && focusedCabinetId !== null;
  const { prevId, nextId } = showChainArrows ? getChainNeighbors(focusedCabinetId!) : { prevId: null, nextId: null };
  const isInspectingReagent = useReagentInspectionStore((state) => state.inspectedId !== null);

  // Things are carried on the tray (VL-017): at the table or the hood
  // everything on it can be put down at once (one by one: a click on it).
  const bottlesOnTray = useReagentStorageStore((state) => state.trayItems.length > 0);
  const tubesOnTray = useTestTubeStorageStore((state) => state.trayTestTubes.length > 0);
  const standOnTray = useBunsenStandStorageStore((state) => state.onTray);
  const lampOnTray = useBurnerStore((state) => state.place === "tray");
  const trayLoaded = bottlesOnTray || tubesOnTray || standOnTray || lampOnTray;
  const unloadPlace = activeTargetId === "table" ? "workbench" : activeTargetId === "fume-hood" ? "fumeHood" : null;

  // Nav conflicts with reagent inspection (its own ОСТАВИТЬ/ВЗЯТЬ + drag
  // rotation own the screen while a bottle is being examined) — hidden
  // rather than merely disabled, matching how it already vanishes mid-flight.
  if (!showBack || isInspectingReagent) return null;

  return (
    <>
      <style>{HUD_BUTTON_CSS}</style>
      {prevId && (
        <button
          type="button"
          onClick={() => requestCabinetSwitch(prevId)}
          className="vg-hud-btn vg-hud-side vg-hud-side--left"
          aria-label="Предыдущий шкаф"
          data-dev-pick-id="nav:left"
          style={{ ...buttonBoxStyle(navButtonValues.left), left: sideDistance }}
        >
          <Chevron width={sideIconWidth} height={sideIconHeight} />
        </button>
      )}
      {nextId && (
        <button
          type="button"
          onClick={() => requestCabinetSwitch(nextId)}
          className="vg-hud-btn vg-hud-side vg-hud-side--right"
          aria-label="Следующий шкаф"
          data-dev-pick-id="nav:right"
          style={{ ...buttonBoxStyle(navButtonValues.right), right: sideDistance }}
        >
          {/* Mirrors the LEFT chevron's own geometry (not a separately-drawn "right" shape) — see Chevron. */}
          <Chevron width={sideIconWidth} height={sideIconHeight} mirrored />
        </button>
      )}
      {unloadPlace && trayLoaded && (
        <button
          type="button"
          onClick={() => unloadTray(unloadPlace)}
          className="vg-hud-btn vg-hud-transfer"
          aria-label={unloadPlace === "workbench" ? "Выгрузить поднос на стол" : "Выгрузить поднос в вытяжной шкаф"}
          // Sits directly on top of the back button, so it follows whatever
          // height the F9 panel gives that one instead of a fixed offset.
          style={{ bottom: BACK_BUTTON_BOTTOM + navButtonValues.bottom.buttonHeight + STACK_GAP }}
        >
          Выгрузить поднос
        </button>
      )}
      <button
        type="button"
        onClick={onBack}
        className="vg-hud-btn vg-hud-back"
        aria-label="Назад"
        data-dev-pick-id="nav:bottom"
        style={buttonBoxStyle(navButtonValues.bottom)}
      >
        {/* Same canonical chevron, rotated -90° — not a separately hand-drawn down icon. */}
        <Chevron width={backIconWidth} height={backIconHeight} rotated />
      </button>
    </>
  );
}

/**
 * Plain `<style>` tag (not CSS Modules/styled-components in this codebase)
 * so idle/hover/active can use real pseudo-classes — inline `CSSProperties`
 * objects can't express `:hover`/`:active`. Class names are `vg-hud-*`
 * prefixed to stay collision-free against the rest of the overlay.
 *
 * Chevrons are a single stroked SVG `<path>` (see CHEVRON_PATH), not a
 * filled clip-path shape or text glyph — `preserveAspectRatio="xMidYMid
 * meet"` plus `.vg-hud-btn`'s flex centering keeps it centered with no
 * manual offsets, at any button/icon size.
 */
const HUD_BUTTON_CSS = `
@keyframes vg-hud-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.vg-hud-btn {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(8, 14, 26, 0.9));
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.12), inset 0 0 12px rgba(56, 189, 248, 0.05);
  transition: box-shadow 120ms ease, border-color 120ms ease, transform 80ms ease;
  /* Runs once whenever a button is freshly mounted — appearing after camera
     settle, or a side chevron toggling on/off across chain neighbors — since
     a CSS *animation* (unlike a transition) always plays on insertion, no
     extra mount-state bookkeeping needed for the fade-in. */
  animation: vg-hud-fade-in 260ms ease;
}
.vg-hud-btn:hover {
  border-color: rgba(94, 220, 255, 0.75);
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.5), inset 0 0 16px rgba(56, 189, 248, 0.14);
}
.vg-hud-btn:active {
  transform: scale(0.96);
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.2), inset 0 0 10px rgba(56, 189, 248, 0.08);
}

/* Side buttons: the long axis is vertical, so "wider" means taller.
   Width/height come from inline style (useNavButtonCalibrationStore) so
   left/right stay independently adjustable via the F9 panel. The left/right
   distance-from-center also comes from inline style (sideDistance), so
   the two can only ever move together, mirror-symmetrically. */
.vg-hud-side {
  top: 50%;
  transform: translateY(-50%);
  border-radius: 20px;
}
.vg-hud-side:active {
  transform: translateY(-50%) scale(0.96);
}

/* Back button: the long axis is horizontal, so "wider" means longer left-right, and it stays low, near the bottom edge. Width/height come from inline style. */
.vg-hud-back {
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 20px;
}
.vg-hud-back:active {
  transform: translateX(-50%) scale(0.96);
}

/* Stacked directly above the back button, same horizontal centering. Unlike
   the chevron buttons this one is text, so it sizes to its own content. */
.vg-hud-transfer {
  left: 50%;
  transform: translateX(-50%);
  padding: 0 20px;
  height: 40px;
  border-radius: 20px;
  color: #d6f3ff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.vg-hud-transfer:active {
  transform: translateX(-50%) scale(0.96);
}

/* Chevron nav icon: one SVG <path>, stroked only (no fill) — see CHEVRON_PATH
   above. .vg-hud-btn's flex centering + preserveAspectRatio="xMidYMid meet"
   center it automatically at any button/icon size, with no manual offsets.
   The mirrored/rotated wrappers transform this same path for RIGHT/BOTTOM,
   so all three can never drift apart into different hand-drawn shapes. */
.vg-hud-icon-group {
  flex-shrink: 0;
  transform-origin: center center;
}
.vg-hud-icon-group--mirrored {
  transform: scaleX(-1);
}
.vg-hud-icon-group--rotated {
  transform: rotate(-90deg);
}
.vg-hud-svg-icon {
  display: block;
  overflow: visible;
}
/* A button's icon can reach past the button itself: clicks go to the button,
   never to its insides — the «Назад» icon used to swallow clicks on the
   «Выгрузить поднос» button stacked above it. */
.vg-hud-btn * {
  pointer-events: none;
}
.vg-hud-chevron-path {
  fill: none;
  stroke: #7fd4ff;
  stroke-width: 12;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 3px rgba(127, 212, 255, 0.55));
  transition: stroke 120ms ease, filter 120ms ease;
}
.vg-hud-btn:hover .vg-hud-chevron-path {
  stroke: #d6f3ff;
  filter: drop-shadow(0 0 7px rgba(148, 226, 255, 0.9));
}
`;
