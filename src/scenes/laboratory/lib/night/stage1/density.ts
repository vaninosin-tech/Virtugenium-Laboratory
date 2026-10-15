export const clamp01 = (value: number): number => Number.isFinite(value)
  ? Math.max(0, Math.min(1, value)) : 0;

export function smoothThreshold(value: number, low: number, high: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)
    || high <= low) return 0;
  const t = clamp01((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

export function hash3(x: number, y: number, z: number): number {
  if (![x, y, z].every(Number.isFinite)) return 0;
  const phase = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return phase - Math.floor(phase);
}

export function valueNoise(x: number, y: number, z: number): number {
  if (![x, y, z].every(Number.isFinite)) return 0;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smoothThreshold(x - ix, 0, 1);
  const fy = smoothThreshold(y - iy, 0, 1);
  const fz = smoothThreshold(z - iz, 0, 1);
  let result = 0;
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++)
    for (let dx = 0; dx <= 1; dx++)
      result += hash3(ix + dx, iy + dy, iz + dz)
        * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  return clamp01(result);
}

export function fractalNoise(x: number, y: number, z: number): number {
  const warp = valueNoise(x * 4 + 3.1, y * 4, z * 4) - 0.5;
  const qx = x + warp * 0.09, qy = y + warp * 0.09, qz = z - warp * 0.09;
  return clamp01(0.64 * valueNoise(qx * 11, qy * 11, qz * 11)
    + 0.25 * valueNoise(qx * 23, qy * 23, qz * 23)
    + 0.11 * valueNoise(qx * 47, qy * 47, qz * 47));
}

export function cottonDensity(concentration: number, materialX: number,
  materialY: number, materialZ: number): number {
  const c = Number.isFinite(concentration) ? Math.max(0, concentration) : 0;
  if (c <= 0) return 0;
  const detail = fractalNoise(materialX, materialY, materialZ) - 0.5;
  return clamp01(smoothThreshold(c, 0.04, 0.8)
    * smoothThreshold(c + detail * 0.4, 0.2, 0.95));
}
