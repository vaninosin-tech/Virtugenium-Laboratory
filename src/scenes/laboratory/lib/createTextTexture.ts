import * as THREE from "three";

interface TextTextureOptions {
  readonly lines: readonly string[];
  readonly backgroundColor: string;
  readonly textColor: string;
  /** Canvas pixel size — kept modest since this is a small physical plate/screen, not a UI element. */
  readonly width?: number;
  readonly height?: number;
  readonly fontWeight?: string;
  /**
   * Overrides the default system font stack — callers that need this
   * (custom `@font-face` webfonts) are responsible for making sure the
   * font is actually loaded (`document.fonts.load`/`.ready`) before this
   * runs; canvas `fillText` silently falls back to a default font if the
   * requested family isn't loaded yet, with no error and no automatic
   * re-draw once it becomes available.
   */
  readonly fontFamily?: string;
  /** Canvas 2D `letterSpacing` (e.g. `"2px"`) — unset by default, matching the previous system-font look. */
  readonly letterSpacing?: string;
}

/**
 * Confirmed Cyrillic-safe, always-available system fonts — no `@font-face`
 * involved, so there's no async font-loading race to guard against
 * (`document.fonts.ready` only matters for custom web fonts). This remains
 * the default for callers that don't pass `fontFamily` (currently the
 * ControlPanel's page-count display).
 */
const DEFAULT_FONT_STACK = "Arial, \"Segoe UI\", sans-serif";

/**
 * Renders text onto an offscreen canvas and wraps it in a `THREE.CanvasTexture`
 * — used to put player-facing text directly onto physical cabinet geometry
 * (the category sign plate, the control panel's page-count screen) instead
 * of an HTML overlay. The result is a real texture in the mesh's own
 * material, so it moves with the cabinet, respects normal depth occlusion
 * (invisible behind closed doors/shutter, through solid geometry, etc.),
 * and — when used as an `emissiveMap` — can be switched on/off by the same
 * `emissiveIntensity` the door animation already drives.
 *
 * `wrapS`/`wrapT` are set explicitly to `ClampToEdgeWrapping` — not because
 * three.js defaults to repeat (its `Texture` default is already
 * clamp-to-edge), but because the actual bug this texture was built to fix
 * was in the *mesh's own UV layout* (see `remapPlanarUV`), and being
 * explicit here removes any doubt about this texture's own contribution to
 * that.
 */
/**
 * Backing-store scale for the canvas (independent of the `width`/`height`
 * params, which stay the logical size every font-fitting calculation below
 * is written in). Without this, the canvas has exactly one texel per CSS
 * pixel regardless of the display's real pixel density, so text painted on
 * a HiDPI screen (or viewed up close on a curved label wrapped around a
 * bottle, which magnifies the texture further) reads soft/blurry — not a
 * filtering problem, an insufficient-source-resolution one. Capped at 2x:
 * higher devicePixelRatios exist (3x phones) but this texture only ever
 * backs small physical labels, so the memory cost past 2x buys no visible
 * benefit versus what `LinearMipmapLinearFilter` + anisotropy (see below)
 * already deliver.
 */
const MAX_BACKING_SCALE = 2;

export function createTextTexture({
  lines,
  backgroundColor,
  textColor,
  width = 512,
  height = 128,
  fontWeight = "600",
  fontFamily = DEFAULT_FONT_STACK,
  letterSpacing,
}: TextTextureOptions): THREE.CanvasTexture {
  const backingScale = Math.min(window.devicePixelRatio || 1, MAX_BACKING_SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * backingScale);
  canvas.height = Math.round(height * backingScale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("createTextTexture: 2D canvas context unavailable");
  }
  // Every draw call below stays written in logical (`width`/`height`) units
  // — this scale is what actually renders them onto the higher-resolution
  // backing store, so none of the existing font-size/fit math needs to
  // know the backing store is bigger than the logical size.
  ctx.scale(backingScale, backingScale);

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineCount = lines.length;
  const maxTextWidth = width * 0.92;
  let fontSize = Math.floor((height / Math.max(lineCount, 1)) * 0.6);

  // `ctx.fillText`'s own `maxWidth` param squishes text horizontally rather
  // than scaling it down proportionally, which distorts long words instead
  // of shrinking them — measure first and reduce font size (preserving
  // aspect) so the longest category name ("ОСНОВАНИЯ") shrinks cleanly
  // instead of being squeezed.
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const widestLine = Math.max(...lines.map((line) => ctx.measureText(line).width));
  if (widestLine > maxTextWidth) {
    fontSize = Math.floor(fontSize * (maxTextWidth / widestLine));
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  }

  // Set only once the final (possibly shrunk) font size is known — an
  // `em`-based value here resolves against whatever `ctx.font` size is
  // active at this point, and `measureText` above (used for the shrink
  // calculation) already reflects any letter-spacing set before it, so
  // setting this after keeps that measurement pass spacing-free and simple.
  if (letterSpacing !== undefined) {
    ctx.letterSpacing = letterSpacing;
  }

  const lineHeight = height / lineCount;
  lines.forEach((line, index) => {
    const y = lineHeight * index + lineHeight / 2;
    ctx.fillText(line, width / 2, y);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // Mipmapped minification (the default `CanvasTexture` filter is
  // `LinearFilter`/no mipmaps, which is fine head-on but aliases/shimmers
  // once the label is smaller on screen or viewed at a grazing angle — a
  // wrap-label curved around a bottle is exactly that case) plus a fixed
  // anisotropy (three.js clamps this to the GPU's real max internally, so
  // this is safe without needing renderer access here) fixes blur/shimmer
  // at an angle without touching the geometry or UVs at all.
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
