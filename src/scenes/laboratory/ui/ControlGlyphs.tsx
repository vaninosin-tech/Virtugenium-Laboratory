import type { CSSProperties } from "react";

/**
 * Drawn controls for `ControlsHint`: a mouse with the pressed button lit,
 * a pointer for "hover", and keyboard keycaps. They sit straight on the
 * scene with no panel behind them, so every shape gets a wide dark stroke
 * underneath — the same outline the hint's text gets from `paint-order`.
 *
 * Colour lives only on the controls, never on the hint's (white) text: a
 * deep blue body with light cyan edges and a light cyan pressed button, in
 * the tablet's own cyan accent family — "what to press" reads apart from
 * "what happens" at a glance.
 */
export type ControlKey = "mouse" | "lmb" | "rmb" | "lmb2" | "hover" | "esc" | "e";

const OUTLINE = "rgba(0, 0, 0, 0.7)";
/** Edges, the pressed button, the pointer (Tailwind sky-300). */
const INK = "#7dd3fc";
/**
 * Deep blue inside the mouse body and the keycap, so the light pressed button
 * stands out. Near-opaque on purpose: it also hides the inner half of the dark
 * outline stroke, which otherwise smears into a black band inside the body.
 */
const BODY_FILL = "rgba(16, 52, 96, 0.92)";
const GLYPH_HEIGHT = 36;

/** Mouse body centred on x = cx: 16 wide, y 1.5…26.5, buttons split at y = 13 (tall buttons, so the unpressed one still shows at small sizes). */
function mouseBody(cx: number): string {
  const l = cx - 8;
  const r = cx + 8;
  return `M${l} 9.5 A8 8 0 0 1 ${r} 9.5 V18.5 A8 8 0 0 1 ${l} 18.5 Z`;
}

function pressedButton(cx: number, side: "left" | "right"): string {
  return side === "left"
    ? `M${cx} 1.5 A8 8 0 0 0 ${cx - 8} 9.5 V13 H${cx} Z`
    : `M${cx} 1.5 A8 8 0 0 1 ${cx + 8} 9.5 V13 H${cx} Z`;
}

function divider(cx: number): string {
  return `M${cx} 1.5 V13 M${cx - 8} 13 H${cx + 8}`;
}

interface Drawing {
  /** viewBox width; height is always 28. */
  readonly width: number;
  /** Closed shapes: outlined dark, filled with `BODY_FILL`, edged white. */
  readonly bodies?: readonly string[];
  /** Solid white areas standing on their own (the pointer): outlined dark. */
  readonly solids?: readonly string[];
  /** Solid white areas inside a body (a pressed button): no outline of their own. */
  readonly innerSolids?: readonly string[];
  /** Open white lines, outlined dark. */
  readonly lines?: readonly string[];
  /** White lines inside a body: no dark outline of their own (the body's dark glass is behind them). */
  readonly innerLines?: readonly string[];
}

function mouse(pressed: "left" | "right"): Drawing {
  return { width: 20, bodies: [mouseBody(10)], innerSolids: [pressedButton(10, pressed)], innerLines: [divider(10)] };
}

const DRAWINGS: Record<Exclude<ControlKey, "esc" | "e" | "lmb2">, Drawing> = {
  // Moving the mouse: the body with its wheel, between left/right motion chevrons.
  mouse: {
    width: 32,
    bodies: [mouseBody(16)],
    innerLines: ["M16 5.5 V9"],
    lines: ["M5 11 L2 14 L5 17", "M27 11 L30 14 L27 17"],
  },
  lmb: mouse("left"),
  rmb: mouse("right"),
  hover: { width: 22, solids: ["M5 2.5 V22 L9.8 17.4 L13.2 25 L16.2 23.7 L12.9 16.2 H19.5 Z"] },
};

function Glyph({ drawing }: { readonly drawing: Drawing }) {
  const { width, bodies = [], solids = [], innerSolids = [], lines = [], innerLines = [] } = drawing;
  const round = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

  return (
    <svg
      width={(width / 28) * GLYPH_HEIGHT}
      height={GLYPH_HEIGHT}
      viewBox={`-1 -1 ${width + 2} 30`}
      style={svgStyle}
      aria-hidden
    >
      {/* Dark outline under everything, so the white reads on light walls too. */}
      <g fill="none" stroke={OUTLINE} strokeWidth={5} {...round}>
        {[...bodies, ...solids, ...lines].map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {bodies.map((d) => (
        <path key={d} d={d} fill={BODY_FILL} />
      ))}
      {[...solids, ...innerSolids].map((d) => (
        <path key={d} d={d} fill={INK} />
      ))}
      <g fill="none" stroke={INK} strokeWidth={1.4} {...round}>
        {[...bodies, ...solids, ...lines, ...innerLines].map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

export function ControlGlyph({ control }: { readonly control: ControlKey }) {
  if (control === "esc") return <span style={keycapStyle}>Esc</span>;
  if (control === "e") return <span style={keycapStyle}>E</span>;
  if (control === "lmb2") {
    return (
      <span style={pairStyle}>
        <Glyph drawing={DRAWINGS.lmb} />
        <span style={timesStyle}>×2</span>
      </span>
    );
  }
  return <Glyph drawing={DRAWINGS[control]} />;
}

const svgStyle: CSSProperties = { display: "block", overflow: "visible" };

const pairStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3 };

const timesStyle: CSSProperties = { fontSize: 16, fontWeight: 700, color: INK };

const keycapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 28,
  minWidth: 42,
  padding: "0 7px",
  boxSizing: "border-box",
  border: `2px solid ${INK}`,
  borderRadius: 6,
  // The key's lower lip, so it reads as a key rather than a label.
  boxShadow: `0 3px 0 ${INK}, 0 0 0 1px ${OUTLINE}, 0 4px 0 1px ${OUTLINE}`,
  background: BODY_FILL,
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1,
  WebkitTextStroke: "0",
};
