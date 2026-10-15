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

function cottonOctaves(x: number, y: number, z: number,
  birthX = x, birthY = y, birthZ = z): [number, number, number, number] {
  const shift = (birth: number, current: number) => Math.max(-0.12, Math.min(0.12, birth - current));
  let bx = x + shift(birthX, x);
  let by = y + shift(birthY, y);
  let bz = z + shift(birthZ, z);
  const wx = valueNoise(bx * 1.25 + 3.1, by * 1.25 + 7.2, bz * 1.25 + 1.7) - 0.5;
  const wy = valueNoise(bx * 1.35 + 9.7, by * 1.35 + 2.3, bz * 1.35 + 5.1) - 0.5;
  const wz = valueNoise(bx * 1.18 + 4.8, by * 1.18 + 8.4, bz * 1.18 + 2.7) - 0.5;
  bx += wx * 0.32; by += wy * 0.32; bz += wz * 0.32;
  const lobe = valueNoise(bx * 1.65, by * 1.65, bz * 1.65);
  const fold = valueNoise(bx * 3.7 + 4, by * 3.7 + 1, bz * 3.7 + 8);
  const shred = valueNoise((x + wx * 0.07) * 10 + 8,
    (y + wy * 0.07) * 10 + 3, (z + wz * 0.07) * 10 + 5);
  const hair = valueNoise((x + wx * 0.07) * 23 + 1,
    (y + wy * 0.07) * 23 + 6, (z + wz * 0.07) * 23 + 9);
  return [lobe, fold, shred, hair];
}

export function fractalNoise(x: number, y: number, z: number): number {
  const [lobe, fold, shred, hair] = cottonOctaves(x, y, z);
  return clamp01(0.35 * lobe + 0.30 * fold + 0.23 * shred + 0.12 * hair);
}

/** x/y/z are current physical coordinates in tube-radius units. */
export function cottonDensity(concentration: number, x: number, y: number, z: number,
  birthX = x, birthY = y, birthZ = z): number {
  const c = Number.isFinite(concentration) ? Math.max(0, concentration) : 0;
  if (c <= 0) return 0;
  const normalized = c / (c + 0.23);
  const [lobe, fold, shred, hair] = cottonOctaves(x, y, z, birthX, birthY, birthZ);
  const clump = smoothThreshold(0.72 * lobe + 0.28 * fold + 0.08 * normalized, 0.43, 0.57);
  const torn = smoothThreshold(0.54 * fold + 0.32 * shred + 0.14 * hair, 0.33, 0.61);
  return clamp01(smoothThreshold(c, 0.025, 0.12) * clump
    * (0.46 + 0.54 * torn) * (0.42 + 0.58 * smoothThreshold(normalized, 0.15, 0.52)));
}
