import "./controlPanelScreenFonts.css";

/**
 * Canvas `fillText` silently falls back to a default font if the requested
 * `@font-face` family isn't loaded yet at draw time — same race as
 * `loadCabinetFonts.ts` (category labels), same fix: force the fetch via
 * `document.fonts.load` regardless of DOM usage, since nothing renders this
 * text as real DOM elements.
 */
const FONT_SPECS = ['600 32px "Rajdhani"', '600 32px "Exo 2"'];

let controlPanelFontsReady: Promise<void> | null = null;

export function loadControlPanelFonts(): Promise<void> {
  controlPanelFontsReady ??= Promise.all(FONT_SPECS.map((spec) => document.fonts.load(spec))).then(() => undefined);
  return controlPanelFontsReady;
}
