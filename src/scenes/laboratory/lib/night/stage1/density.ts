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
  const warp = valueNoise(x * 19 + 3.1, y * 19 + 7.2, z * 19 + 1.7) - 0.5;
  const qx = (x + warp * 0.024) * 74;
  const qy = (y - warp * 0.012) * 42;
  const qz = (z + warp * 0.0168) * 74;
  return clamp01(0.55 * valueNoise(qx, qy, qz)
    + 0.30 * valueNoise(qx * 2.1, qy * 2.1, qz * 2.1)
    + 0.15 * valueNoise(qx * 4.3, qy * 4.3, qz * 4.3));
}

export function cottonDensity(concentration: number, materialX: number,
  materialY: number, materialZ: number): number {
  const c = Number.isFinite(concentration) ? Math.max(0, concentration) : 0;
  if (c <= 0) return 0;
  const detail = fractalNoise(materialX, materialY, materialZ) - 0.5;
  return clamp01(smoothThreshold(c, 0.012, 0.045)
    * smoothThreshold(c + detail * 0.22, 0.025, 0.135)
    * (0.42 + 0.58 * smoothThreshold(c, 0.055, 0.22)));
}
