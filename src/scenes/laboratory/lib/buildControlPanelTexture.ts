import * as THREE from "three";

/**
 * `Page_Display`'s real physical aspect ratio (verified from the glb's own
 * scale data, not guessed): after `remapPlanarUV`'s `swapUV` fix, the
 * screen's horizontal-on-screen axis is 0.100m and its vertical axis is
 * 0.235m — width:height ≈ 0.4255 (re-measured after the proportion/mounting
 * redesign pass widened the physical screen from 68x303mm to 100x235mm).
 * 512 wide keeps the canvas at a modest, power-of-two-ish size while
 * matching that ratio (512 / 0.4255 ≈ 1203, rounded to a clean 1204) rather
 * than distorting the old 512x730 canvas onto the new, visibly wider panel.
 */
export const SCREEN_CANVAS_WIDTH = 512;
export const SCREEN_CANVAS_HEIGHT = 1204;

const COLOR_BACKGROUND = "#071018";
const COLOR_PRIMARY_TEXT = "#FFFFFF";
const COLOR_ACCENT = "#5FD7FF";
const COLOR_PRESSED_FILL = "#123349";
const COLOR_DISABLED_TEXT = "#3E4C54";

const FONT_FAMILY_READY = '"Rajdhani", "Exo 2", sans-serif';
const FONT_FAMILY_FALLBACK = "Arial, \"Segoe UI\", sans-serif";

/**
 * Vertical zones as a fraction of canvas height measured from the TOP of
 * the drawn image (0 = top, 1 = bottom) — the layout this module actually
 * draws. `UP_ZONE_UV`/`DOWN_ZONE_UV` (below) convert these into the raycast
 * UV-space thresholds a hit-test needs, so both stay derived from one
 * source instead of two hand-kept numbers drifting apart.
 */
const UP_ZONE = { top: 0.2, bottom: 0.44 };
/**
 * Vertically centered between `UP_ZONE.bottom` and `DOWN_ZONE.top` (same
 * 0.14 height as before `UP_ZONE` moved up) — kept as a literal rather than
 * a derived expression since these three zones are hand-tuned constants,
 * but re-checked by hand whenever either arrow zone moves: midpoint
 * (0.44 + 0.7) / 2 = 0.57, ± half of 0.14.
 */
const COUNTER_ZONE = { top: 0.5, bottom: 0.64 };
const DOWN_ZONE = { top: 0.7, bottom: 0.94 };

const ZONE_SIDE_MARGIN = 0.08;
const ZONE_CARD_RADIUS = 22;

/**
 * Three.js's `CanvasTexture` defaults `flipY = true`, which inverts V
 * before sampling — canvas row 0 (top of the drawn image, where this
 * module puts the temperature) ends up at UV.v = 1 (physically the top of
 * the mounted screen, since `Page_Display`'s local +Y is world-up and
 * `ControlPanel` only ever rotates around Y). Raycast UV is geometry-only
 * and unaffected by `flipY`, so a hit-test comparing `event.uv.y` against
 * these thresholds needs the *inverse* mapping of the draw-space zones
 * above: UV.v = 1 - (canvas-fraction-from-top). Verified against the
 * asset's own local-axis data (see `ReagentCabinetInstance`'s
 * `remapPlanarUV` comment), not assumed.
 */
export const UP_ZONE_UV = { min: 1 - UP_ZONE.bottom, max: 1 - UP_ZONE.top };
export const DOWN_ZONE_UV = { min: 1 - DOWN_ZONE.bottom, max: 1 - DOWN_ZONE.top };
export const ZONE_UV_X_RANGE = { min: ZONE_SIDE_MARGIN, max: 1 - ZONE_SIDE_MARGIN };

export interface ControlPanelScreenState {
  readonly temperatureC: number;
  readonly currentPage: number;
  readonly totalPages: number;
  readonly upHover: boolean;
  readonly upPressed: boolean;
  readonly downHover: boolean;
  readonly downPressed: boolean;
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

/** Drawn as a vector path, not a font glyph — guaranteed-consistent shape/size regardless of which font in the stack actually loaded. */
function drawTriangle(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, size: number, pointingUp: boolean) {
  ctx.beginPath();
  if (pointingUp) {
    ctx.moveTo(centerX, centerY - size);
    ctx.lineTo(centerX + size, centerY + size);
    ctx.lineTo(centerX - size, centerY + size);
  } else {
    ctx.moveTo(centerX, centerY + size);
    ctx.lineTo(centerX + size, centerY - size);
    ctx.lineTo(centerX - size, centerY - size);
  }
  ctx.closePath();
  ctx.fill();
}

function drawTouchZone(
  ctx: CanvasRenderingContext2D,
  zone: { top: number; bottom: number },
  pointingUp: boolean,
  enabled: boolean,
  hover: boolean,
  pressed: boolean,
) {
  const x = SCREEN_CANVAS_WIDTH * ZONE_SIDE_MARGIN;
  const width = SCREEN_CANVAS_WIDTH * (1 - ZONE_SIDE_MARGIN * 2);
  const y = SCREEN_CANVAS_HEIGHT * zone.top;
  const height = SCREEN_CANVAS_HEIGHT * (zone.bottom - zone.top);

  // Pressed = strongest fill, hover = a faint hint of it, idle = no card at
  // all (reads as empty screen space until touched, per "easy to ignore"
  // spirit carried over from the rest of this cabinet's UI). Disabled zones
  // never show a card or highlight, only a dimmed icon.
  if (enabled && (pressed || hover)) {
    ctx.globalAlpha = pressed ? 1 : 0.45;
    ctx.fillStyle = COLOR_PRESSED_FILL;
    drawRoundedRect(ctx, x, y, width, height, ZONE_CARD_RADIUS);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const centerX = SCREEN_CANVAS_WIDTH / 2;
  const centerY = y + height / 2;
  ctx.fillStyle = enabled ? COLOR_ACCENT : COLOR_DISABLED_TEXT;
  drawTriangle(ctx, centerX, centerY, width * 0.26, pointingUp);
}

export function buildControlPanelTexture(state: ControlPanelScreenState): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_CANVAS_WIDTH;
  canvas.height = SCREEN_CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("buildControlPanelTexture: 2D canvas context unavailable");
  }

  const fontFamily = state.fontsReady ? FONT_FAMILY_READY : FONT_FAMILY_FALLBACK;

  ctx.fillStyle = COLOR_BACKGROUND;
  ctx.fillRect(0, 0, SCREEN_CANVAS_WIDTH, SCREEN_CANVAS_HEIGHT);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Temperature — primary info, always white per spec (never gray/muted).
  // Nudged slightly above the exact midpoint between the screen's top frame
  // edge (fraction 0) and the up-arrow's vertical center, rather than
  // within the old fixed TEMPERATURE_ZONE band, since the button block
  // shifted down and left a bigger gap above it.
  const upArrowCenterFraction = (UP_ZONE.top + UP_ZONE.bottom) / 2;
  const tempCenterY = SCREEN_CANVAS_HEIGHT * (upArrowCenterFraction * 0.42);
  ctx.font = `600 ${Math.round(SCREEN_CANVAS_HEIGHT * 0.12)}px ${fontFamily}`;
  ctx.fillStyle = COLOR_PRIMARY_TEXT;
  ctx.fillText(`${state.temperatureC.toFixed(1)} °C`, SCREEN_CANVAS_WIDTH / 2, tempCenterY);

  const firstPage = state.currentPage <= 1;
  const lastPage = state.currentPage >= state.totalPages;

  drawTouchZone(ctx, UP_ZONE, true, !firstPage, state.upHover, state.upPressed);

  // Page counter — also primary info (white), with a faint secondary-color
  // "PAGE" hint would add clutter the spec explicitly rules out, so it's
  // just the bare "current / total" as the example layout shows.
  const counterCenterY = SCREEN_CANVAS_HEIGHT * ((COUNTER_ZONE.top + COUNTER_ZONE.bottom) / 2);
  ctx.font = `600 ${Math.round(SCREEN_CANVAS_HEIGHT * 0.13)}px ${fontFamily}`;
  ctx.fillStyle = COLOR_PRIMARY_TEXT;
  ctx.fillText(`${state.currentPage} / ${state.totalPages}`, SCREEN_CANVAS_WIDTH / 2, counterCenterY);

  drawTouchZone(ctx, DOWN_ZONE, false, !lastPage, state.downHover, state.downPressed);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
