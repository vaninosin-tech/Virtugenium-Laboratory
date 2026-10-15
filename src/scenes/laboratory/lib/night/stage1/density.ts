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

function cottonOctaves(x: number, y: number, z: number): [number, number, number] {
  const wx = valueNoise(x * 27 + 3.1, y * 20 + 7.2, z * 27 + 1.7) - 0.5;
  const wy = valueNoise(x * 29 + 9.7, y * 22 + 2.3, z * 29 + 5.1) - 0.5;
  const wz = valueNoise(x * 23 + 4.8, y * 18 + 8.4, z * 23 + 2.7) - 0.5;
  const qx = (x + wx * 0.027) * 105;
  const qy = (y + wy * 0.027) * 68;
  const qz = (z + wz * 0.027) * 105;
  return [valueNoise(qx, qy, qz),
    valueNoise(qx * 2.3 + 8, qy * 2.3 + 3, qz * 2.3 + 5),
    valueNoise(qx * 5.1 + 1, qy * 5.1 + 6, qz * 5.1 + 9)];
}

export function fractalNoise(x: number, y: number, z: number): number {
  const [fold, shred, hair] = cottonOctaves(x, y, z);
  return clamp01(0.48 * fold + 0.33 * shred + 0.19 * hair);
}

export function cottonDensity(concentration: number, materialX: number,
  materialY: number, materialZ: number): number {
  const c = Number.isFinite(concentration) ? Math.max(0, concentration) : 0;
  if (c <= 0) return 0;
  const normalized = c / (c + 0.23);
  const [fold, shred, hair] = cottonOctaves(materialX, materialY, materialZ);
  const detail = 0.48 * fold + 0.33 * shred + 0.19 * hair - 0.5;
  const erosion = smoothThreshold(normalized, 0.18, 0.46)
    * smoothThreshold(shred * 0.65 + hair * 0.35, 0.13, 0.38);
  return clamp01(smoothThreshold(c, 0.018, 0.065)
    * smoothThreshold(normalized + detail * 0.72, 0.12, 0.25)
    * (0.28 + 0.72 * smoothThreshold(normalized, 0.16, 0.57))
    * (0.36 + 0.64 * erosion));
}
