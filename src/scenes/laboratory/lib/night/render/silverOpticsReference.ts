/** Shared dimensionless parameters for the stage-3 fine AgCl optical path. */
export const SILVER_FINE_OPTICS = {
  steps: 88,
  kappa: 8.0,
  albedo: 0.98,
  lightDirection: [0.45, 0.7, 0.55] as const,
  lightStrength: 0.62,
  ambient: 0.42,
  ambientBoost: 0.55,
  anisotropy: 0.35,
  isotropicFloor: 0.6,
  grainAmount: 0.10,
  grainCyclesPerCell: 2.4,
  lightTapDistance: 0.23,
  lightTaps: 2,
  rawScale: 5,
  extinctionGrey: 0.45,
  alphaStop: 0.995,
} as const;

/** Shared aggregate coefficients; density is supplied only by the aggregate field. */
export const SILVER_AGGREGATE_OPTICS = {
  kappa: 17.0, albedo: 0.96, loosePorosity: 0.55,
  grainAmount: 0.08, grainCyclesPerCell: 3.5,
  rimStrength: 0.12, lightTaps: 2, lightTapDistance: 0.18,
  multipleScatter: 0.18, sedimentAlphaScale: 0.00035,
} as const;

export type SilverOpticsMode = 0 | 1 | 2 | 3;
export interface SilverFineDump {
  nx: number; ny: number; nz: number; radius: number; bottom: number; height: number;
  mask: number[]; fine: number[]; level?: number;
}
export type Rgba = [number, number, number, number];
type Vec3 = [number, number, number];
const P = SILVER_FINE_OPTICS;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const length = (v: Vec3) => Math.hypot(...v);
const unit = (v: Vec3): Vec3 => { const n = length(v); return [v[0] / n, v[1] / n, v[2] / n]; };
const LIGHT = unit([...P.lightDirection]);

/** Matches GL_LINEAR sampling of the 3D texture, including its zero-valued outside cells. */
export function fineAt(d: SilverFineDump, grid: Vec3): number {
  const size = [d.nx, d.ny, d.nz];
  const p = grid.map((v, axis) => clamp(v * size[axis] - 0.5, 0, size[axis] - 1));
  const a = p.map(Math.floor), f = p.map((v, i) => v - a[i]);
  let sum = 0;
  for (let z = 0; z <= 1; z++) for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) {
    const ix = Math.min(d.nx - 1, a[0] + x), iy = Math.min(d.ny - 1, a[1] + y), iz = Math.min(d.nz - 1, a[2] + z);
    sum += d.fine[ix + d.nx * (iy + d.ny * iz)] * (x ? f[0] : 1 - f[0])
      * (y ? f[1] : 1 - f[1]) * (z ? f[2] : 1 - f[2]);
  }
  return sum;
}
function uvw(d: SilverFineDump, p: Vec3): Vec3 {
  return [p[0] / (2 * d.radius) + 0.5, (p[1] - d.bottom) / d.height, p[2] / (2 * d.radius) + 0.5];
}
function wet(d: SilverFineDump, p: Vec3, level: number): boolean {
  const radial = Math.hypot(p[0], p[2]);
  const bowl = d.bottom + d.radius - Math.sqrt(Math.max(0, d.radius ** 2 - radial ** 2));
  return radial < d.radius * 0.985 && p[1] >= bowl && p[1] <= level + 0.0035;
}
function grain(d: SilverFineDump, g: Vec3): number {
  const q: Vec3 = [g[0] * d.nx, g[1] * d.ny, g[2] * d.nz];
  const f = P.grainCyclesPerCell * 2 * Math.PI;
  return 1 + P.grainAmount * Math.sin(f * (q[0] + 0.37 * q[1] + 0.19 * q[2]))
    * Math.sin(f * (0.23 * q[0] - 0.41 * q[1] + q[2]));
}
function source(d: SilverFineDump, p: Vec3, c: number, towardCamera: Vec3): number {
  let lightDepth = 0;
  for (let k = 1; k <= P.lightTaps; k++) {
    const distance = d.radius * P.lightTapDistance * k;
    const q: Vec3 = [p[0] + LIGHT[0] * distance, p[1] + LIGHT[1] * distance, p[2] + LIGHT[2] * distance];
    if (wet(d, q, d.level ?? d.bottom + d.height)) lightDepth += fineAt(d, uvw(d, q)) * P.kappa * P.lightTapDistance;
  }
  const angle = clamp(LIGHT[0] * towardCamera[0] + LIGHT[1] * towardCamera[1] + LIGHT[2] * towardCamera[2], -1, 1);
  const phase = P.isotropicFloor + (1 - P.isotropicFloor) * (1 + P.anisotropy * angle) / (1 + P.anisotropy);
  const localDepth = P.kappa * c * P.lightTapDistance;
  const ambient = P.ambient + P.ambientBoost * (1 - Math.exp(-2 * localDepth));
  return Math.min(P.lightStrength + P.ambient + P.ambientBoost,
    P.albedo * (ambient + P.lightStrength * phase * Math.exp(-lightDepth)));
}

/** Front-to-back fine-only ray, with the same fixed integration and compositing as the GLSL branch. */
export function marchSilverFine(d: SilverFineDump, origin: Vec3, directionInput: Vec3,
  mode: SilverOpticsMode = 0, level = d.level ?? d.bottom + d.height): Rgba {
  const direction = unit(directionInput);
  const min: Vec3 = [-d.radius * 1.2, d.bottom - d.radius * 0.15, -d.radius * 1.2];
  const max: Vec3 = [d.radius * 1.2, d.bottom + d.height + d.radius * 0.6, d.radius * 1.2];
  const ts = min.map((v, i) => [(v - origin[i]) / (direction[i] || 1e-6), (max[i] - origin[i]) / (direction[i] || 1e-6)]);
  const entry = Math.max(0, ...ts.map(t => Math.min(...t)));
  const exit = Math.min(...ts.map(t => Math.max(...t)));
  if (exit <= entry) return [0, 0, 0, 0];
  const step = (exit - entry) / P.steps;
  let alpha = 0, radiance = 0, red = 0, blue = 0;
  const towardCamera: Vec3 = [-direction[0], -direction[1], -direction[2]];
  for (let i = 0; i < P.steps; i++) {
    const t = entry + (i + 0.5) * step;
    const p: Vec3 = [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
    if (!wet(d, p, level)) continue;
    const g = uvw(d, p), raw = fineAt(d, g);
    if (raw <= 0) continue;
    if (mode === 1) {
      const a = 1 - Math.exp(-Math.min(1, raw) * step / d.radius * P.rawScale);
      red += (1 - alpha) * a * clamp(raw, 0, 1);
      blue += (1 - alpha) * a * (1 - clamp(raw, 0, 1));
      alpha += (1 - alpha) * a;
    } else {
      const c = raw * grain(d, g);
      const a = 1 - Math.exp(-P.kappa * c * step / d.radius);
      const s = mode === 2 ? P.extinctionGrey : source(d, p, c, towardCamera);
      radiance += (1 - alpha) * a * s;
      alpha += (1 - alpha) * a;
    }
    if (alpha >= P.alphaStop) break;
  }
  if (alpha === 0) return [0, 0, 0, 0];
  if (mode === 1) return [red / alpha, 0.12, blue / alpha, alpha];
  const color = radiance / alpha;
  return [color, color, color, alpha];
}

/** P6 PPM, with alpha composited over white in modes 0/2 and over black in modes 1/3. */
export function renderSilverDump(d: SilverFineDump, mode: SilverOpticsMode, width = 120, height = 280): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + 0.5) / width * 2.4 - 1.2;
    const py = d.bottom + (1 - (y + 0.5) / height) * (d.height + 0.75 * d.radius) - 0.15 * d.radius;
    const rgba = marchSilverFine(d, [px * d.radius, py, 3 * d.radius], [0, 0, -1], mode);
    const background = mode === 1 || mode === 3 ? 0 : 1;
    for (let k = 0; k < 3; k++) pixels[3 * (y * width + x) + k] = Math.round(255 * clamp(rgba[k] * rgba[3] + background * (1 - rgba[3]), 0, 1));
  }
  const result = new Uint8Array(header.length + pixels.length);
  result.set(header); result.set(pixels, header.length);
  return result;
}

export type SilverSolidMode = 0 | 1 | 2 | 3;
export interface SilverAggregateDump extends SilverFineDump {
  /** Interleaved RGBA voxels: density, looseness, compaction, orientation. */
  aggregate: number[];
  /** Deposit height in metres, indexed x + nx*z. */
  sedimentHeight: number[];
}

export function aggregateAt(d: SilverAggregateDump, grid: Vec3): [number, number, number, number] {
  const p = [grid[0] * d.nx - 0.5, grid[1] * d.ny - 0.5, grid[2] * d.nz - 0.5]
    .map((v, i) => clamp(v, 0, [d.nx - 1, d.ny - 1, d.nz - 1][i]));
  const base = p.map(Math.floor), f = p.map((v, i) => v - base[i]);
  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let z = 0; z <= 1; z++) for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) {
    const ix = Math.min(d.nx - 1, base[0] + x), iy = Math.min(d.ny - 1, base[1] + y), iz = Math.min(d.nz - 1, base[2] + z);
    const w = (x ? f[0] : 1 - f[0]) * (y ? f[1] : 1 - f[1]) * (z ? f[2] : 1 - f[2]);
    const i = 4 * (ix + d.nx * (iy + d.ny * iz));
    for (let k = 0; k < 4; k++) result[k] += (d.aggregate[i + k] ?? 0) * w;
  }
  return result;
}

export function aggregateExtinction(density: number, looseness: number, grainValue = 1, compaction = 1): number {
  return SILVER_AGGREGATE_OPTICS.kappa * Math.max(0, density)
    * (1 - SILVER_AGGREGATE_OPTICS.loosePorosity * clamp(looseness, 0, 1))
    * (0.85 + 0.15 * clamp(compaction, 0, 1)) * grainValue;
}

export function aggregateGrain(d: SilverAggregateDump, g: Vec3, field: [number, number, number, number]): number {
  const q = [g[0] * d.nx, g[1] * d.ny, g[2] * d.nz];
  const phase = SILVER_AGGREGATE_OPTICS.grainCyclesPerCell * 2 * Math.PI;
  return 1 + SILVER_AGGREGATE_OPTICS.grainAmount * field[1]
    * Math.sin(phase * (q[0] + (0.37 + field[3] * 0.2) * q[1] + 0.19 * q[2]))
    * Math.sin(phase * (0.23 * q[0] - 0.41 * q[1] + q[2]));
}

function aggregateSource(d: SilverAggregateDump, p: Vec3, c: number, towardCamera: Vec3, level: number): number {
  const A = SILVER_AGGREGATE_OPTICS;
  let depth = 0;
  for (let k = 1; k <= A.lightTaps; k++) {
    const q: Vec3 = [p[0] + LIGHT[0] * d.radius * A.lightTapDistance * k,
      p[1] + LIGHT[1] * d.radius * A.lightTapDistance * k,
      p[2] + LIGHT[2] * d.radius * A.lightTapDistance * k];
    if (wet(d, q, level)) depth += aggregateAt(d, uvw(d, q))[0] * A.kappa * A.lightTapDistance;
  }
  const angle = clamp(LIGHT.reduce((s, v, i) => s + v * towardCamera[i], 0), -1, 1);
  const phase = P.isotropicFloor + (1 - P.isotropicFloor) * (1 + P.anisotropy * angle) / (1 + P.anisotropy);
  const ambient = P.ambient + P.ambientBoost * (1 - Math.exp(-2 * c));
  const light = P.lightStrength * phase * Math.exp(-depth);
  const multiple = A.multipleScatter * P.lightStrength * (1 - Math.exp(-depth));
  return Math.min(P.lightStrength + P.ambient + P.ambientBoost, A.albedo * (ambient + light + multiple));
}

export function sedimentHeightAt(d: SilverAggregateDump, x: number, z: number): number {
  const gx = clamp((x / d.radius + 1) * d.nx * 0.5 - 0.5, 0, d.nx - 1);
  const gz = clamp((z / d.radius + 1) * d.nz * 0.5 - 0.5, 0, d.nz - 1);
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const at = (xx: number, zz: number) => Math.max(0, d.sedimentHeight[Math.min(d.nz - 1, zz) * d.nx + Math.min(d.nx - 1, xx)] ?? 0);
  return ((at(ix, iz) * (1 - fx) + at(ix + 1, iz) * fx) * (1 - fz)
    + (at(ix, iz + 1) * (1 - fx) + at(ix + 1, iz + 1) * fx) * fz);
}

/** Numerical twin of the field-driven single ray march. Sediment uses the same height surface as the mesh. */
export function marchSilverLayers(d: SilverAggregateDump, origin: Vec3, directionInput: Vec3,
  mode: SilverOpticsMode = 0, solidMode: SilverSolidMode = 2, level = d.level ?? d.bottom + d.height): Rgba {
  const direction = unit(directionInput);
  const min: Vec3 = [-d.radius * 1.2, d.bottom - d.radius * 0.15, -d.radius * 1.2];
  const max: Vec3 = [d.radius * 1.2, d.bottom + d.height + d.radius * 0.6, d.radius * 1.2];
  const ts = min.map((v, i) => [(v - origin[i]) / (direction[i] || 1e-6), (max[i] - origin[i]) / (direction[i] || 1e-6)]);
  const entry = Math.max(0, ...ts.map(t => Math.min(...t)));
  const exit = Math.min(...ts.map(t => Math.max(...t)));
  if (exit <= entry) return [0, 0, 0, 0];
  const step = (exit - entry) / P.steps, towardCamera: Vec3 = [-direction[0], -direction[1], -direction[2]];
  let alpha = 0; const rgb = [0, 0, 0];
  const add = (a: number, color: readonly number[]) => {
    for (let k = 0; k < 3; k++) rgb[k] += (1 - alpha) * a * color[k];
    alpha += (1 - alpha) * a;
  };
  for (let i = 0; i < P.steps; i++) {
    const t = entry + (i + 0.5) * step;
    const p: Vec3 = [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
    if (!wet(d, p, level)) continue;
    const g = uvw(d, p);
    if (solidMode === 3) {
      const radial = Math.hypot(p[0], p[2]);
      const floor = d.bottom + d.radius - Math.sqrt(Math.max(0, d.radius ** 2 - radial ** 2));
      const h = sedimentHeightAt(d, p[0], p[2]);
      if (h > 0 && p[1] <= floor + h) {
        const a = 1 - Math.exp(-h / SILVER_AGGREGATE_OPTICS.sedimentAlphaScale);
        add(a, mode === 1 ? [h / d.radius, 0.12, 1 - h / d.radius]
          : [mode === 2 ? P.extinctionGrey : 0.95, mode === 2 ? P.extinctionGrey : 0.96, mode === 2 ? P.extinctionGrey : 0.95]);
        break;
      }
      continue;
    }
    if (solidMode !== 1) {
      const raw = fineAt(d, g);
      if (raw > 0) {
        if (mode === 1) {
          const a = 1 - Math.exp(-Math.min(1, raw) * P.rawScale * step / d.radius);
          add(a, [clamp(raw, 0, 1), 0.12, 1 - clamp(raw, 0, 1)]);
        } else {
          const c = raw * grain(d, g), a = 1 - Math.exp(-P.kappa * c * step / d.radius);
          const s = mode === 2 ? P.extinctionGrey : source(d, p, c, towardCamera);
          add(a, [s, s, s]);
        }
      }
    }
    if (solidMode !== 0) {
      const field = aggregateAt(d, g);
      if (field[0] > 0) {
        if (mode === 1) {
          const raw = clamp(field[0], 0, 1), a = 1 - Math.exp(-raw * P.rawScale * step / d.radius);
          add(a, [raw, 0.12, 1 - raw]);
        } else {
          const c = aggregateExtinction(field[0], field[1], aggregateGrain(d, g, field), field[2])
            / SILVER_AGGREGATE_OPTICS.kappa;
          const a = 1 - Math.exp(-SILVER_AGGREGATE_OPTICS.kappa * c * step / d.radius);
          const s = mode === 2 ? P.extinctionGrey : aggregateSource(d, p, c, towardCamera, level);
          add(a, [s, s, s]);
        }
      }
    }
    if (alpha >= P.alphaStop) break;
  }
  return alpha > 0 ? [rgb[0] / alpha, rgb[1] / alpha, rgb[2] / alpha, alpha] : [0, 0, 0, 0];
}

export function renderSilverLayers(d: SilverAggregateDump, mode: SilverOpticsMode,
  solidMode: SilverSolidMode, width = 120, height = 280): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + 0.5) / width * 2.4 - 1.2;
    const py = d.bottom + (1 - (y + 0.5) / height) * (d.height + 0.75 * d.radius) - 0.15 * d.radius;
    const rgba = marchSilverLayers(d, [px * d.radius, py, 3 * d.radius], [0, 0, -1], mode, solidMode);
    const bg = mode === 1 || mode === 3 ? 0 : 1;
    for (let k = 0; k < 3; k++) pixels[3 * (y * width + x) + k] = Math.round(255 * clamp(rgba[k] * rgba[3] + bg * (1 - rgba[3]), 0, 1));
  }
  const result = new Uint8Array(header.length + pixels.length); result.set(header); result.set(pixels, header.length);
  return result;
}
