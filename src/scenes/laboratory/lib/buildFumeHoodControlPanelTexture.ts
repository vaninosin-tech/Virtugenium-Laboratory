import * as THREE from "three";

/**
 * `Page_Display` in `FumeHood_Modern_MASTER.blend` is the same donor plate
 * mesh vertex-copied from the reagent cabinets (confirmed from the glb's own
 * node data: identical scale `[0.1, 0.235, 0.003]`), so it shares the exact
 * same physical proportions as `buildControlPanelTexture.ts`'s screen — same
 * canvas size keeps texel density consistent across every touchscreen in
 * the lab rather than picking a new ratio for no reason.
 */
export const SCREEN_CANVAS_WIDTH = 512;
export const SCREEN_CANVAS_HEIGHT = 1204;

const COLOR_BACKGROUND = "#0c0f12";
const COLOR_OFF_TEXT = "#5a6066";
const COLOR_OFF_TEXT_DIM = "#3b4045";
const COLOR_ON_TEXT = "#f1f4f5";
const COLOR_HAIRLINE = "rgba(255,255,255,0.08)";
const COLOR_PRESSED_FILL = "rgba(255,255,255,0.07)";

const FONT_FAMILY_READY = '"Rajdhani", "Exo 2", sans-serif';
const FONT_FAMILY_FALLBACK = "Arial, \"Segoe UI\", sans-serif";

/**
 * Two equal halves with a hairline gap between them — top is the light
 * button, bottom is the extraction-fan button. No temperature/page readout
 * on this screen (this panel is purely decorative per spec: only the two
 * functions, no numbers/graphs/menus).
 */
const LIGHT_ZONE = { top: 0.04, bottom: 0.48 };
const FAN_ZONE = { top: 0.52, bottom: 0.96 };
const ZONE_SIDE_MARGIN = 0.1;
const ZONE_CARD_RADIUS = 26;

/**
 * Same `flipY`-on-`CanvasTexture` reasoning as `buildControlPanelTexture.ts`:
 * canvas row 0 (top of the drawn image) samples at UV.v = 1, so a hit-test
 * against `event.uv.y` needs the inverse of the draw-space zone fractions.
 */
export const FAN_ZONE_UV = { min: 1 - FAN_ZONE.bottom, max: 1 - FAN_ZONE.top };
export const LIGHT_ZONE_UV = { min: 1 - LIGHT_ZONE.bottom, max: 1 - LIGHT_ZONE.top };
export const ZONE_UV_X_RANGE = { min: ZONE_SIDE_MARGIN, max: 1 - ZONE_SIDE_MARGIN };

const FAN_ACCENT = "#5fd8e6";
const FAN_GLOW = "rgba(95,216,230,0.35)";
const LIGHT_ACCENT = "#ffcd85";
const LIGHT_GLOW = "rgba(255,205,133,0.36)";

export interface FumeHoodPanelState {
  readonly fanOn: boolean;
  readonly fanHover: boolean;
  readonly fanPressed: boolean;
  /** Radians — the blade assembly's current spin angle, advanced continuously while `fanOn` (see `useFumeHoodControlPanel`'s per-frame loop). Meaningless while off. */
  readonly fanRotation: number;
  readonly lightOn: boolean;
  readonly lightHover: boolean;
  readonly lightPressed: boolean;
  /** Draws with the system font stack until the real webfont is confirmed loaded (see `loadControlPanelFonts`). */
  readonly fontsReady: boolean;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * Three curved blades around a hub — drawn as vector strokes, not a font
 * glyph, so it stays crisp at any canvas size. `rotation` (radians) spins
 * the whole blade assembly around the hub — driven from `useFumeHoodControlPanel`'s
 * per-frame loop while the fan is ON, the same "always-running" read as the
 * design mockup's spinning-fan CSS animation, just baked into the redrawn
 * canvas instead.
 */
function drawFanIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, rotation: number) {
  const s = size / 64;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.5, 4.5 * s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * 2 * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-3 * s, -11 * s, -12 * s, -18 * s, -22 * s, -17 * s);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 5.5 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Bulb outline with a base and filament hint; radiating rays only appear when lit. */
function drawLampIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
  lit: boolean,
) {
  const s = size / 64;
  const tx = (x: number) => cx + (x - 32) * s;
  const ty = (y: number) => cy + (y - 32) * s;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.5, 4.5 * s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(tx(32), ty(8));
  ctx.bezierCurveTo(tx(22.6), ty(8), tx(15.5), ty(15.6), tx(15.5), ty(24.6));
  ctx.bezierCurveTo(tx(15.5), ty(31), tx(19.2), ty(34.8), tx(22.2), ty(38.6));
  ctx.bezierCurveTo(tx(24), ty(40.9), tx(24.3), ty(43.4), tx(24.3), ty(46.5));
  ctx.lineTo(tx(39.7), ty(46.5));
  ctx.bezierCurveTo(tx(39.7), ty(43.4), tx(40), ty(40.9), tx(41.8), ty(38.6));
  ctx.bezierCurveTo(tx(44.8), ty(34.8), tx(48.5), ty(31), tx(48.5), ty(24.6));
  ctx.bezierCurveTo(tx(48.5), ty(15.6), tx(41.4), ty(8), tx(32), ty(8));
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tx(26), ty(52));
  ctx.lineTo(tx(38), ty(52));
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tx(27.5), ty(58));
  ctx.lineTo(tx(36.5), ty(58));
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tx(27), ty(30));
  ctx.lineTo(tx(37), ty(24));
  ctx.stroke();

  if (lit) {
    ctx.beginPath();
    ctx.moveTo(tx(32), ty(0));
    ctx.lineTo(tx(32), ty(5));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tx(9), ty(9));
    ctx.lineTo(tx(12.5), ty(12.5));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tx(55), ty(9));
    ctx.lineTo(tx(51.5), ty(12.5));
    ctx.stroke();
  }
}

interface ZoneOptions {
  readonly isOn: boolean;
  readonly hover: boolean;
  readonly pressed: boolean;
  readonly accent: string;
  readonly glow: string;
  readonly label: string;
  readonly fontFamily: string;
  /** Radians, forwarded to `drawIcon` — only `drawFanIcon` uses it, `drawLampIcon` ignores its own trailing param. */
  readonly rotation?: number;
  readonly drawIcon: (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, rotation: number) => void;
}

function drawZone(ctx: CanvasRenderingContext2D, zone: { top: number; bottom: number }, options: ZoneOptions) {
  const x = SCREEN_CANVAS_WIDTH * ZONE_SIDE_MARGIN;
  const width = SCREEN_CANVAS_WIDTH * (1 - ZONE_SIDE_MARGIN * 2);
  const y = SCREEN_CANVAS_HEIGHT * zone.top;
  const height = SCREEN_CANVAS_HEIGHT * (zone.bottom - zone.top);
  const centerX = SCREEN_CANVAS_WIDTH / 2;

  if (options.hover || options.pressed) {
    ctx.globalAlpha = options.pressed ? 1 : 0.5;
    ctx.fillStyle = COLOR_PRESSED_FILL;
    drawRoundedRect(ctx, x, y, width, height, ZONE_CARD_RADIUS);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const iconCenterY = y + height * 0.28;
  // Sized off the zone's own height, not its (much narrower) width — this
  // panel has no side-by-side content, so height is what actually bounds
  // how big the icon/text can read.
  const iconSize = height * 0.48;

  if (options.isOn) {
    const glowRadius = width * 0.58;
    const gradient = ctx.createRadialGradient(centerX, iconCenterY, 0, centerX, iconCenterY, glowRadius);
    gradient.addColorStop(0, options.glow);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, iconCenterY, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  options.drawIcon(ctx, centerX, iconCenterY, iconSize, options.isOn ? options.accent : COLOR_OFF_TEXT, options.rotation ?? 0);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const labelY = y + height * 0.68;
  ctx.font = `700 ${Math.round(height * 0.155)}px ${options.fontFamily}`;
  ctx.fillStyle = options.isOn ? COLOR_ON_TEXT : COLOR_OFF_TEXT;
  ctx.fillText(options.label, centerX, labelY);

  const captionY = y + height * 0.85;
  ctx.font = `700 ${Math.round(height * 0.13)}px ${options.fontFamily}`;
  ctx.fillStyle = options.isOn ? options.accent : COLOR_OFF_TEXT_DIM;
  ctx.fillText(options.isOn ? "ВКЛ" : "ВЫКЛ", centerX, captionY);
}

export function buildFumeHoodControlPanelTexture(state: FumeHoodPanelState): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_CANVAS_WIDTH;
  canvas.height = SCREEN_CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("buildFumeHoodControlPanelTexture: 2D canvas context unavailable");
  }

  const fontFamily = state.fontsReady ? FONT_FAMILY_READY : FONT_FAMILY_FALLBACK;

  ctx.fillStyle = COLOR_BACKGROUND;
  ctx.fillRect(0, 0, SCREEN_CANVAS_WIDTH, SCREEN_CANVAS_HEIGHT);

  const dividerY = (SCREEN_CANVAS_HEIGHT * (FAN_ZONE.bottom + LIGHT_ZONE.top)) / 2;
  ctx.strokeStyle = COLOR_HAIRLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(SCREEN_CANVAS_WIDTH * ZONE_SIDE_MARGIN, dividerY);
  ctx.lineTo(SCREEN_CANVAS_WIDTH * (1 - ZONE_SIDE_MARGIN), dividerY);
  ctx.stroke();

  drawZone(ctx, FAN_ZONE, {
    isOn: state.fanOn,
    hover: state.fanHover,
    pressed: state.fanPressed,
    accent: FAN_ACCENT,
    glow: FAN_GLOW,
    label: "ВЫТЯЖКА",
    fontFamily,
    rotation: state.fanRotation,
    drawIcon: drawFanIcon,
  });

  drawZone(ctx, LIGHT_ZONE, {
    isOn: state.lightOn,
    hover: state.lightHover,
    pressed: state.lightPressed,
    accent: LIGHT_ACCENT,
    glow: LIGHT_GLOW,
    label: "СВЕТ",
    fontFamily,
    drawIcon: (ctx2, cx, cy, size, color) => drawLampIcon(ctx2, cx, cy, size, color, state.lightOn),
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
