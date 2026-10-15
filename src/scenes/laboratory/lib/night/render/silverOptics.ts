/** Dimensionless Beer-Lambert optical depth for a path through AgCl suspension. */
export function silverOpticalDepth(density: number, metres: number, radius: number): number {
  if (!Number.isFinite(density) || !Number.isFinite(metres) || !Number.isFinite(radius)
    || density <= 0 || metres <= 0 || radius <= 0) return 0;
  return Math.min(32, density * 2.8 * metres / (2 * radius));
}

export function silverScatteringAlpha(depth: number): number {
  return Number.isFinite(depth) && depth > 0 ? 1 - Math.exp(-Math.min(32, depth)) : 0;
}

/** Local mass maps linearly to wet layer thickness until the tube-scale safety cap. */
export function silverSedimentThickness(localMass: number, radius: number, compaction: number): number {
  if (!Number.isFinite(localMass) || !Number.isFinite(radius) || radius <= 0 || localMass <= 0) return 0;
  const packed = 1 - 0.38 * Math.min(1, Math.max(0, Number.isFinite(compaction) ? compaction : 0));
  return Math.min(radius * 1.8, radius * 24 * localMass * packed);
}
