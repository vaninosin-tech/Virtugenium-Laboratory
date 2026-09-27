import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import {
  CRACK_SPREAD,
  FLAME_HALF_WIDTH,
  HEAT_ZONE_COUNT,
  TARGET_HALF_WIDTH,
  WARN_SPREAD,
  heatSpread,
  useHeatingStore,
  zoneCentre,
} from "../lib/useHeatingStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";

const reagentConfig = (id: string | undefined): ReagentContainerConfig | undefined =>
  id === undefined ? undefined : (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

const TRACK_WIDTH = 340;
const KNOB_SIZE = 26;

/** -1..1 track position → percentage from the track's left edge. */
const percent = (value: number) => `${((value + 1) / 2) * 100}%`;

/** Cold glass reads as the track, hot glass as flame orange. */
const zoneColour = (heat: number) => {
  const t = Math.min(1, Math.max(0, heat));
  return `rgba(${Math.round(40 + 215 * t)}, ${Math.round(60 + 110 * t)}, ${Math.round(80 - 30 * t)}, ${0.35 + 0.6 * t})`;
};

/**
 * The heating mini-game: the player drags the knob (the tube's position over
 * the flame) and follows the oval as it slowly crosses from one end to the
 * other. The strip under the track is the glass itself, zone by zone — it
 * fills evenly while the player follows and unevenly when they lag or hold
 * still, and too uneven cracks the tube. Once every zone is warm the oval
 * parks in the flame and holding the knob in it heats the contents.
 *
 * An HTML overlay rather than a 3D control on the stand: the player needs to
 * watch the real tube and the real flame while cranking, so the control has
 * to live outside the view it is acting on.
 */
export function HeatingControls() {
  const active = useHeatingStore((state) => state.active);
  const sweep = useHeatingStore((state) => state.sweep);
  const zones = useHeatingStore((state) => state.zones);
  const target = useHeatingStore((state) => state.target);
  const started = useHeatingStore((state) => state.started);
  const phase = useHeatingStore((state) => state.phase);
  const heatProgress = useHeatingStore((state) => state.heatProgress);
  const setSweep = useHeatingStore((state) => state.setSweep);
  const grab = useHeatingStore((state) => state.grab);
  const exit = useHeatingStore((state) => state.exit);
  const restartPreheat = useHeatingStore((state) => state.restartPreheat);

  const hoodTubes = useTestTubeStorageStore((state) => state.fumeHoodTestTubes);
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);

  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Contents are still a single reagent id per tube (`StoredTestTube`), so a
  // solid on its own means nothing has been poured onto it yet.
  const clampedTube =
    attachedTubeSlotIndex === null ? undefined : hoodTubes[attachedTubeSlotIndex];
  const nothingToReact =
    clampedTube !== undefined &&
    clampedTube.contents.length > 0 &&
    clampedTube.contents.every((id) => reagentConfig(id)?.contentsKind === "solid");

  if (!active) return null;

  const cracked = phase === "cracked";
  const spread = heatSpread(zones);
  const warming = phase === "preheat" && spread >= WARN_SPREAD;
  const onTarget = Math.abs(sweep - target) <= TARGET_HALF_WIDTH;
  const preheatRatio = zones.reduce((sum, heat) => sum + heat, 0) / HEAT_ZONE_COUNT;

  const sweepFromEvent = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return;
    setSweep(((clientX - rect.left) / rect.width) * 2 - 1);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cracked) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    grab();
    sweepFromEvent(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    sweepFromEvent(event.clientX);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const hint = cracked
    ? "Пробирка треснула: стекло прогрето неравномерно."
    : phase === "preheat"
      ? started
        ? "Ведите пробирку за овалом, пока стекло не прогреется равномерно."
        : "Возьмите кружок и ведите пробирку за овалом через пламя."
      : phase === "heating"
        ? "Прогрев выполнен. Удерживайте пробирку в пламени."
        : nothingToReact
          ? "Пробирка нагрета, но реагировать нечему."
          : "Содержимое нагрето.";

  return (
    <div style={panelStyle(cracked)}>
      <span style={hintStyle(cracked)}>{hint}</span>
      {warming ? <span style={warningStyle}>Стекло греется неравномерно — не задерживайтесь в пламени!</span> : null}
      {nothingToReact && !cracked ? (
        <span style={warningStyle}>
          В пробирке только твёрдый реактив — кислоту приливают до нагрева.
        </span>
      ) : null}

      <div
        ref={trackRef}
        style={trackStyle(cracked)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        aria-label="Положение пробирки над пламенем"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={sweep}
      >
        <div style={flameMarkStyle} aria-hidden />
        {phase !== "done" && !cracked ? <div style={targetStyle(target, onTarget)} aria-hidden /> : null}
        <div style={knobStyle(sweep, cracked)} aria-hidden />
      </div>

      {/* The glass, zone by zone, on the same axis as the track above. */}
      <div style={glassStripStyle} aria-hidden>
        {zones.map((heat, index) => (
          <div key={index} style={zoneStyle(zoneCentre(index), heat)} />
        ))}
      </div>

      <div style={progressTrackStyle} aria-hidden>
        <div
          style={progressFillStyle(
            phase === "preheat" || cracked ? preheatRatio : heatProgress,
            spread / CRACK_SPREAD,
          )}
        />
      </div>

      <div style={buttonRowStyle}>
        {cracked ? (
          <button type="button" style={primaryButtonStyle} onClick={() => restartPreheat()}>
            Заменить пробирку и прогреть заново
          </button>
        ) : null}
        <button type="button" style={exitButtonStyle} onClick={exit}>
          Отойти от штатива
        </button>
      </div>
    </div>
  );
}

const panelStyle = (cracked: boolean): CSSProperties => ({
  position: "absolute",
  // Bottom-right, off the tube: the close-up centres the tube and puts its
  // bottom — the copper, the flame — low on screen, which a bottom-centre
  // panel covered exactly while the player was meant to be watching it.
  right: 24,
  bottom: 64,
  zIndex: 11,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  padding: "14px 20px",
  borderRadius: 14,
  border: `1px solid ${cracked ? "rgba(248, 113, 113, 0.6)" : "rgba(56, 189, 248, 0.35)"}`,
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(8, 14, 26, 0.94))",
  boxShadow: cracked ? "0 0 28px rgba(248, 113, 113, 0.35)" : "0 0 24px rgba(56, 189, 248, 0.18)",
  color: "#d6f3ff",
  fontSize: 13,
  fontWeight: 600,
});

const hintStyle = (cracked: boolean): CSSProperties => ({
  whiteSpace: "nowrap",
  color: cracked ? "#fca5a5" : undefined,
});

const warningStyle: CSSProperties = {
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 500,
  color: "#fcd34d",
};

const trackStyle = (cracked: boolean): CSSProperties => ({
  position: "relative",
  width: TRACK_WIDTH,
  height: 34,
  borderRadius: 17,
  border: "1px solid rgba(56, 189, 248, 0.3)",
  backgroundColor: "rgba(8, 20, 32, 0.9)",
  cursor: cracked ? "not-allowed" : "ew-resize",
  touchAction: "none",
  opacity: cracked ? 0.5 : 1,
});

const flameMarkStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: 4,
  bottom: 4,
  width: 2,
  marginLeft: -1,
  borderRadius: 1,
  backgroundColor: "rgba(255, 179, 71, 0.75)",
};

const targetStyle = (target: number, onTarget: boolean): CSSProperties => ({
  position: "absolute",
  top: 2,
  bottom: 2,
  left: percent(target - TARGET_HALF_WIDTH),
  width: `${TARGET_HALF_WIDTH * 100}%`,
  borderRadius: "50%",
  border: `2px solid ${onTarget ? "rgba(110, 231, 168, 0.95)" : "rgba(252, 211, 77, 0.9)"}`,
  backgroundColor: onTarget ? "rgba(110, 231, 168, 0.15)" : "rgba(252, 211, 77, 0.1)",
  pointerEvents: "none",
});

const knobStyle = (sweep: number, cracked: boolean): CSSProperties => ({
  position: "absolute",
  top: (34 - 2 - KNOB_SIZE) / 2,
  left: `calc(${percent(sweep)} - ${KNOB_SIZE / 2}px)`,
  width: KNOB_SIZE,
  height: KNOB_SIZE,
  borderRadius: "50%",
  backgroundColor: cracked ? "#f87171" : "#7fd4ff",
  boxShadow: `0 0 12px ${cracked ? "rgba(248, 113, 113, 0.7)" : "rgba(127, 212, 255, 0.7)"}`,
  pointerEvents: "none",
});

const glassStripStyle: CSSProperties = {
  position: "relative",
  width: TRACK_WIDTH,
  height: 10,
};

/** Matches `zoneCentre`'s spacing: the zones span the track inset by the flame's half-width. */
const ZONE_WIDTH_PERCENT = ((1 - FLAME_HALF_WIDTH) * 100) / HEAT_ZONE_COUNT;

const zoneStyle = (centre: number, heat: number): CSSProperties => ({
  position: "absolute",
  top: 0,
  bottom: 0,
  left: `calc(${percent(centre)} - ${ZONE_WIDTH_PERCENT / 2}%)`,
  width: `calc(${ZONE_WIDTH_PERCENT}% - 2px)`,
  borderRadius: 3,
  backgroundColor: zoneColour(heat),
});

const progressTrackStyle: CSSProperties = {
  width: TRACK_WIDTH,
  height: 4,
  borderRadius: 2,
  backgroundColor: "rgba(148, 163, 184, 0.25)",
  overflow: "hidden",
};

/** Green while the glass heats evenly, sliding to red as the spread nears a crack. */
const progressFillStyle = (ratio: number, danger: number): CSSProperties => {
  const d = Math.min(1, Math.max(0, danger));
  return {
    width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`,
    height: "100%",
    backgroundColor: `rgb(${Math.round(110 + 138 * d)}, ${Math.round(231 - 118 * d)}, ${Math.round(168 - 55 * d)})`,
    transition: "width 120ms linear",
  };
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
};

const primaryButtonStyle: CSSProperties = {
  padding: "6px 16px",
  borderRadius: 8,
  border: "1px solid rgba(248, 113, 113, 0.6)",
  backgroundColor: "rgba(127, 29, 29, 0.6)",
  color: "#fee2e2",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const exitButtonStyle: CSSProperties = {
  padding: "6px 16px",
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.35)",
  backgroundColor: "rgba(15, 23, 42, 0.8)",
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
