import "./cabinetLabelFonts.css";

/**
 * Canvas `fillText` silently falls back to a default font if the requested
 * `@font-face` family isn't loaded yet at draw time — CSS `@font-face`
 * declarations are lazy by default (only fetched once something rendered
 * in the DOM actually uses them), and nothing in this app renders category
 * text as real DOM text, so importing the CSS above alone would never
 * trigger a fetch. `document.fonts.load` forces the fetch regardless of
 * DOM usage; callers await the returned promise before drawing.
 */
const FONT_SPECS = ['600 32px "Unbounded"', '600 32px "Exo 2"', '400 32px "Russo One"'];

let cabinetFontsReady: Promise<void> | null = null;

export function loadCabinetFonts(): Promise<void> {
  cabinetFontsReady ??= Promise.all(FONT_SPECS.map((spec) => document.fonts.load(spec))).then(() => undefined);
  return cabinetFontsReady;
}
