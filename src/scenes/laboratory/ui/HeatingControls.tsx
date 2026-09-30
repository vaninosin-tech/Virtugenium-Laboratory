import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import {
  CRACK_SPREAD,
  FLAME_HALF_WIDTH,
  HEAT_ZONE_COUNT,
  WARN_SPREAD,
  bottomInFlame,
  heatSpread,
  useHeatingStore,
  zoneCentre,
} from "../lib/useHeatingStore";
import { replaceCrackedTube } from "../lib/standStationActions";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";

const reagentConfig = (id: string | undefined): ReagentContainerConfig | undefined =>
  id === undefined ? undefined : (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];

const TRACK_WIDTH = 340;
const V_HEIGHT = 130;
const V_INSET = 22;
/** The V: its left top, vertex and right top, in the SVG's pixels. */
const V_LEFT = { x: V_INSET, y: V_INSET };
const V_VERTEX = { x: TRACK_WIDTH / 2, y: V_HEIGHT - V_INSET / 2 };
const V_RIGHT = { x: TRACK_WIDTH - V_INSET, y: V_INSET };
const ELLIPSE_RX = 20;
const ELLIPSE_RY = 11;

type Point = { readonly x: number; readonly y: number };
const lerpPoint = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** -1..1 along the V → a point on it: -1 the left top, 0 the vertex, 1 the right top. */
const pointOnV = (s: number): Point =>
  s < 0 ? lerpPoint(V_VERTEX, V_LEFT, -s) : lerpPoint(V_VERTEX, V_RIGHT, s);

/** The nearest point on the V to a pointer position, as -1..1. */
const sweepAt = (p: Point): number => {
  const project = (a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const q = lerpPoint(a, b, t);
    return { t, distance: Math.hypot(p.x - q.x, p.y - q.y) };
  };
  const left = project(V_VERTEX, V_LEFT);
  const right = project(V_VERTEX, V_RIGHT);
  return left.distance < right.distance ? -left.t : right.t;
};

/** Angle of the arm a point on the V lies on, degrees, for the ellipse to lie along it. */
const armAngle = (s: number) => {
  const end = s < 0 ? V_LEFT : V_RIGHT;
  return (Math.atan2(end.y - V_VERTEX.y, end.x - V_VERTEX.x) * 180) / Math.PI;
};

/** Cold glass reads as the track, hot glass as flame orange. */
const zoneColour = (heat: number) => {
  const t = Math.min(1, Math.max(0, heat));
  return `rgba(${Math.round(40 + 215 * t)}, ${Math.round(60 + 110 * t)}, ${Math.round(80 - 30 * t)}, ${0.35 + 0.6 * t})`;
};

/**
 * The heating mini-game: the clamp is off the stand and the player drags the
 * ellipse along the V — the tube follows it through the lamp's still flame
 * (`HeldClampRig`). The V itself is the glass, zone by zone: it fills evenly
 * while the player keeps the ellipse moving and unevenly where they linger,
 * and too uneven cracks the tube. Once every zone is warm, holding the
 * ellipse at a top of the V — the tube's bottom in the flame — heats the
 * contents.
 *
 * An HTML overlay rather than a 3D control: the player needs to watch the
 * real tube and the real flame while moving it.
 */
export function HeatingControls() {
  const active = useHeatingStore((state) => state.active);
  const sweep = useHeatingStore((state) => state.sweep);
  const zones = useHeatingStore((state) => state.zones);
  const started = useHeatingStore((state) => state.started);
  const phase = useHeatingStore((state) => state.phase);
  const heatProgress = useHeatingStore((state) => state.heatProgress);
  const setSweep = useHeatingStore((state) => state.setSweep);
  const grab = useHeatingStore((state) => state.grab);
  const exit = useHeatingStore((state) => state.exit);

  const standInHood = useBunsenStandStorageStore((state) => state.onFumeHood);
  const hoodTubes = useTestTubeStorageStore((state) =>
    standInHood ? state.fumeHoodTestTubes : state.workbenchTestTubes,
  );
  const attachedTubeSlotIndex = useBunsenStandStorageStore((state) => state.attachedTubeSlotIndex);

  const trackRef = useRef<SVGSVGElement>(null);
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
  const inFlame = phase === "heating" && bottomInFlame(sweep);
  const preheatRatio = zones.reduce((sum, heat) => sum + heat, 0) / HEAT_ZONE_COUNT;

  const sweepFromEvent = (clientX: number, clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = TRACK_WIDTH / rect.width;
    setSweep(sweepAt({ x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale }));
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (cracked) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    grab();
    sweepFromEvent(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    sweepFromEvent(event.clientX, event.clientY);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const hint = cracked
    ? "Пробирка треснула: стекло прогрето неравномерно."
    : phase === "preheat"
      ? started
        ? "Водите эллипс по V, пока стекло не прогреется равномерно."
        : "Возьмите эллипс и водите пробирку по V через пламя."
      : phase === "heating"
        ? "Прогрев выполнен. Держите дно пробирки в пламени — у верха V."
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

      <svg
        ref={trackRef}
        width={TRACK_WIDTH}
        height={V_HEIGHT}
        viewBox={`0 0 ${TRACK_WIDTH} ${V_HEIGHT}`}
        style={trackStyle(cracked)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        aria-label="Положение пробирки в пламени"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={sweep}
      >
        <polyline
          points={[V_LEFT, V_VERTEX, V_RIGHT].map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="rgba(8, 20, 32, 0.95)"
          strokeWidth={22}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* The glass, zone by zone, laid along the V. */}
        {zones.map((heat, index) => {
          const centre = zoneCentre(index);
          const from = pointOnV(centre - ZONE_HALF_SPAN);
          const to = pointOnV(centre + ZONE_HALF_SPAN);
          const crossesVertex = centre - ZONE_HALF_SPAN < 0 && centre + ZONE_HALF_SPAN > 0;
          const points = crossesVertex ? [from, V_VERTEX, to] : [from, to];
          return (
            <polyline
              key={index}
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={zoneColour(heat)}
              strokeWidth={12}
              strokeLinecap="butt"
            />
          );
        })}
        {/* The tops of the V: the tube's bottom in the flame. */}
        {[V_LEFT, V_RIGHT].map((p, index) => (
          <circle
            key={index}
            cx={p.x}
            cy={p.y}
            r={16}
            fill={phase === "heating" ? "rgba(255, 179, 71, 0.18)" : "none"}
            stroke={phase === "heating" ? "rgba(255, 179, 71, 0.8)" : "rgba(255, 179, 71, 0.35)"}
            strokeWidth={1.5}
            strokeDasharray={phase === "heating" ? undefined : "3 3"}
          />
        ))}
        <ellipse
          cx={pointOnV(sweep).x}
          cy={pointOnV(sweep).y}
          rx={ELLIPSE_RX}
          ry={ELLIPSE_RY}
          transform={`rotate(${armAngle(sweep)} ${pointOnV(sweep).x} ${pointOnV(sweep).y})`}
          fill={cracked ? "rgba(248, 113, 113, 0.35)" : inFlame ? "rgba(110, 231, 168, 0.3)" : "rgba(127, 212, 255, 0.25)"}
          stroke={cracked ? "#f87171" : inFlame ? "#6ee7a8" : "#7fd4ff"}
          strokeWidth={2.5}
        />
      </svg>

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
          <button type="button" style={primaryButtonStyle} onClick={replaceCrackedTube}>
            Заменить пробирку
          </button>
        ) : null}
        <button type="button" style={exitButtonStyle} onClick={exit}>
          Вернуть лапку в штатив
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
  display: "block",
  cursor: cracked ? "not-allowed" : "grab",
  touchAction: "none",
  opacity: cracked ? 0.5 : 1,
});

/** Half of one zone's stretch along the V — matches `zoneCentre`'s spacing, less a hairline gap. */
const ZONE_HALF_SPAN = (1 - FLAME_HALF_WIDTH) / HEAT_ZONE_COUNT - 0.012;

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
