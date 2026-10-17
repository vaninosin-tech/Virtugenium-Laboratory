/** Temporary diagnostic selector for the AgCl implementation. */
export function silverStage(): number {
  if (typeof window === "undefined") return 1;
  // ?silverStage=3 in the page address selects the cohesive-floc model without touching the console.
  const fromUrl = Number(new URLSearchParams(window.location?.search ?? "").get("silverStage"));
  if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
  const selected = (window as Window & { __silverStage?: unknown }).__silverStage;
  return typeof selected === "number" ? selected : 1;
}

/** Both diagnostic views carry only the incoming NaCl (no precipitation): "tracer" renders it optically, "cells" renders every occupied concentration cell as an opaque magenta block that bypasses the optical shading. */
export const silverTracerOnly = () => { const d = silverDiagnostic(); return d === "tracer" || d === "cells"; };

/** Diagnostic view of experiment 2: "tracer" disables precipitation and shows only the incoming NaCl (?silverDiag=tracer). */
export function silverDiagnostic(): string {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location?.search ?? "").get("silverDiag");
  if (fromUrl) return fromUrl;
  const selected = (window as Window & { __silverDiag?: unknown }).__silverDiag;
  return typeof selected === "string" ? selected : "";
}
