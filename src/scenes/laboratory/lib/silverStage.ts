/** Temporary diagnostic selector for the AgCl implementation. */
export function silverStage(): number {
  if (typeof window === "undefined") return 1;
  const selected = (window as Window & { __silverStage?: unknown }).__silverStage;
  return typeof selected === "number" ? selected : 1;
}
