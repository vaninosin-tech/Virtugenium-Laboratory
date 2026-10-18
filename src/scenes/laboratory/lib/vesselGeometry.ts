/** Geometry of the authored ContentsVolume liquid body, in metres and millilitres. */
export interface VesselGeometry {
  readonly innerRadius: number;
  readonly cavityHeight: number;
  readonly capacityMl: number;
  areaAtHeight(z: number): number;
  volumeFromHeight(h: number): number;
  heightFromVolume(volumeMl: number): number;
  cellLiquidFraction(box: readonly [number, number, number, number, number, number], surfaceHeight: number): number;
}

// LabTestTube.glb: ContentsVolume has a 7 mm spherical bottom from y=.0005
// to .0075 and a cylinder ending at .0555. Coordinates here start at .0005.
const radius = 0.007;
const height = 0.055;
const hemisphereM3 = 2 * Math.PI * radius ** 3 / 3;
const square = (n: number) => n * n;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const volumeM3 = (h: number) => h <= radius
  ? Math.PI * square(h) * (radius - h / 3)
  : hemisphereM3 + Math.PI * square(radius) * (h - radius);

/** Fraction of a voxel clipped by the bowl, cylinder and horizontal surface. */
function sampledFraction(box: readonly [number, number, number, number, number, number], surface: number): number {
  const [x0, x1, y0, y1, z0, z1] = box;
  if (x1 <= x0 || y1 <= y0 || z1 <= z0 || surface <= y0 || y1 <= 0 || y0 >= height) return 0;
  const bottom = Math.max(0, y0), top = Math.min(y1, height, surface);
  if (top <= bottom) return 0;
  const corners = [[x0, z0], [x0, z1], [x1, z0], [x1, z1]];
  if (bottom >= radius && top === y1 && corners.every(([x, z]) => x * x + z * z <= radius * radius))
    return (top - bottom) / (y1 - y0);
  const steps = 8;
  let inside = 0;
  for (let iy = 0; iy < steps; iy++) {
    const y = bottom + (iy + 0.5) / steps * (top - bottom);
    const r2 = y < radius ? 2 * radius * y - y * y : radius * radius;
    for (let ix = 0; ix < steps; ix++) {
      const x = x0 + (ix + 0.5) / steps * (x1 - x0);
      for (let iz = 0; iz < steps; iz++) {
        const z = z0 + (iz + 0.5) / steps * (z1 - z0);
        if (x * x + z * z <= r2) inside++;
      }
    }
  }
  return inside / (steps ** 3) * (top - bottom) / (y1 - y0);
}

export const tubeVessel: VesselGeometry = {
  innerRadius: radius,
  cavityHeight: height,
  // Gameplay accepts at most 5 mL; the authored 55 mm body geometrically holds more.
  capacityMl: 5,
  areaAtHeight(z) {
    if (!(z > 0) || z > height) return 0;
    return Math.PI * (z < radius ? 2 * radius * z - z * z : square(radius));
  },
  volumeFromHeight(h) {
    if (!(h > 0)) return 0;
    return volumeM3(clamp(h, 0, height)) * 1e6;
  },
  heightFromVolume(ml) {
    if (!(ml > 0)) return 0;
    const volume = Math.min(ml, this.volumeFromHeight(height)) * 1e-6;
    if (volume >= hemisphereM3)
      return Math.min(height, radius + (volume - hemisphereM3) / (Math.PI * square(radius)));
    let lo = 0, hi = radius;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (volumeM3(mid) < volume) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  },
  cellLiquidFraction: sampledFraction,
};
