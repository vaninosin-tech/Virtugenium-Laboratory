/** Stage used when nothing overrides it. Stage 1 is the earlier cloud model and stays selectable with ?silverStage=1. */
export const DEFAULT_SILVER_STAGE = 3;

/** Pure selector: a positive ?silverStage= wins, then the window override, then the default. */
export function resolveSilverStage(search: string, override: unknown): number {
  const fromUrl = Number(new URLSearchParams(search).get("silverStage"));
  if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
  return typeof override === "number" ? override : DEFAULT_SILVER_STAGE;
}

/** Selector for the AgCl implementation (default: stage 3, see DEFAULT_SILVER_STAGE). */
export function silverStage(): number {
  if (typeof window === "undefined") return 1;
  return resolveSilverStage(window.location?.search ?? "", (window as Window & { __silverStage?: unknown }).__silverStage);
}

/**
 * Stage-3 aggregation (sectional population, floc nodes, sediment curd). OFF by default: the stable baseline is
 * the accepted fine suspension. A number other than 0 in __silverAgg (or ?silverAgg=1) turns the aggregation code on;
 * it is kept intact for development. Pure part for tests: resolveSilverAggregation.
 */
export function resolveSilverAggregation(search: string, override: unknown): boolean {
  const fromUrl = new URLSearchParams(search).get("silverAgg");
  if (fromUrl !== null && fromUrl !== "" && Number.isFinite(Number(fromUrl))) return Number(fromUrl) !== 0;
  return typeof override === "number" && Number.isFinite(override) && override !== 0;
}

export function silverAggregationEnabled(): boolean {
  const search = typeof window === "undefined" ? "" : window.location?.search ?? "";
  const override = (typeof window === "undefined" ? undefined : (window as Window & { __silverAgg?: unknown }).__silverAgg)
    ?? (globalThis as { __silverAgg?: unknown }).__silverAgg;
  return resolveSilverAggregation(search, override);
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
