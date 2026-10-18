import * as THREE from 'three';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { TubeFlowSolver } from '../../../src/scenes/laboratory/lib/tubeFlowSolver';

export const R = 0.007, HEIGHT = 0.034, LEVEL = 0.0251;
export const GRIDS = { LOW: [12, 24, 12], HIGH: [16, 32, 16] } as const;
export type Priv = { faces: Float32Array[]; flow: Float32Array; project(iterations?: number): void; divergence: Float32Array; pressure: Float32Array; adjacent: Int32Array[] };

export function makeSolver(grid: keyof typeof GRIDS = 'LOW', level = LEVEL) {
  const [nx, ny, nz] = GRIDS[grid], mask = new LiquidMask(nx, ny, nz, R, 0, HEIGHT);
  mask.update(new THREE.Vector3(0, 1, 0), level);
  const solver = new TubeFlowSolver(mask);
  solver.refreshMask();
  return { mask, solver, priv: solver as unknown as Priv, dx: 2 * R / nx, dy: HEIGHT / ny, dz: 2 * R / nz };
}
const down = new THREE.Vector3(0, -1, 0);
/** One 50 ms step with no jet; `load` is {values, scale} (acceleration m/s2 = scale * values, positive down). */
export function step(solver: TubeFlowSolver, dt: number, load?: { values: Float64Array; scale: number; iterations?: number }) {
  solver.step(dt, new THREE.Vector3(0, 0, 0), down, 0, 0, undefined, 0, load ? { values: load.values, scale: load.scale, down, iterations: load.iterations } : undefined);
}
/** The solver treats every wet cell as a full cell (equal volume), also at the curved bottom and the surface; the energy bookkeeping uses the same volume. */
export const cellVolume = (mask: LiquidMask) => (2 * R / mask.nx) * (HEIGHT / mask.ny) * (2 * R / mask.nz);
/** Kinetic energy per unit density (m5/s2): sum of 0.5 |u|^2 V over wet cells, volumes from the mask. */
export function kinetic(mask: LiquidMask, flow: Float32Array) {
  let e = 0;
  for (let a = 0; a < mask.activeCount; a++) { const i = mask.active[a]; e += 0.5 * (flow[3 * i] ** 2 + flow[3 * i + 1] ** 2 + flow[3 * i + 2] ** 2) * cellVolume(mask); }
  return e;
}
/** Maximum and RMS of the divergence over wet cells (1/s), from the staggered faces. */
export function divergence(mask: LiquidMask, priv: Priv, dx: number, dy: number, dz: number) {
  let mx = 0, sq = 0; const sp = [dx, dy, dz];
  for (let a = 0; a < mask.activeCount; a++) {
    const i = mask.active[a]; let d = 0;
    for (let axis = 0; axis < 3; axis++) {
      const plus = priv.adjacent[axis * 2 + 1][i], minus = priv.adjacent[axis * 2][i];
      d += ((plus >= 0 ? priv.faces[axis][i] : 0) - (minus >= 0 ? priv.faces[axis][minus] : 0)) / sp[axis];
    }
    mx = Math.max(mx, Math.abs(d)); sq += d * d;
  }
  return { max: mx, rms: Math.sqrt(sq / mask.activeCount) };
}
/** Smooth solenoidal initial field in a closed box-like domain from a stream function that vanishes on the walls, then projected. */
export function seedVortex(mask: LiquidMask, priv: Priv, amp: number, dx: number, dy: number) {
  const psi = (x: number, y: number) => amp * Math.sin(Math.PI * (x + 0.5) / mask.nx) ** 2 * Math.sin(Math.PI * (y + 0.5) / mask.ny) ** 2;
  for (let a = 0; a < mask.activeCount; a++) {
    const i = mask.active[a], x = i % mask.nx, y = Math.floor(i / mask.nx) % mask.ny;
    priv.faces[0][i] = (psi(x, y + 1) - psi(x, y)) / dy;
    priv.faces[1][i] = -(psi(x + 1, y) - psi(x, y)) / dx;
  }
  priv.project(200);
}

export const GRAV = 9.81, RHO0 = 1010, DAMP = 0.26;
/** Viscous dissipation rate per unit density, nu * sum |grad u|^2 V (m5/s3), central differences of the cell velocities over wet neighbours. */
export function viscousDissipation(mask: LiquidMask, priv: Priv, nu: number, dx: number, dy: number, dz: number) {
  const sp = [dx, dy, dz], strides = [1, mask.nx, mask.nx * mask.ny];
  let total = 0;
  for (let a = 0; a < mask.activeCount; a++) {
    const i = mask.active[a]; let g2 = 0;
    for (let axis = 0; axis < 3; axis++) {
      const l = priv.adjacent[axis * 2][i], r = priv.adjacent[axis * 2 + 1][i];
      if (l < 0 && r < 0) continue;
      const h = sp[axis] * (l >= 0 && r >= 0 ? 2 : 1);
      for (let c = 0; c < 3; c++) { const d = (priv.flow[3 * (r >= 0 ? r : i) + c] - priv.flow[3 * (l >= 0 ? l : i) + c]) / h; g2 += d * d; }
    }
    total += nu * g2 * cellVolume(mask);
  }
  return total;
}
export interface Budget { ke: number; /** KE + (PE - PE0): positive means energy that did not come from the density field. */ total?: number; work: number; viscous: number; damping: number; pe0: number; pe: number; residual: number; mixingLoss: number; peakKe: number; peakKeAt: number }
/**
 * Runs the solver with a density field rho (kg/m3 excess, advected with the solver's own transport) for `seconds` and accumulates the energy
 * budget per unit reference density: kinetic energy, buoyancy work, viscous dissipation (physical), Rayleigh damping, and the residual
 * dKE/dt - (work - viscous - damping), which collects the numerical dissipation of the advection scheme and the projection.
 * Power terms use the average of the velocities before and after the step.
 */
export function runBudget(grid: keyof typeof GRIDS, seconds: number, rho: (x: number, y: number, z: number) => number, nu: number, options: { scale?: number; iterations?: number; record?: (t: number, b: Budget & { total: number }) => void; level?: number; noEddy?: boolean; disableFastFaces?: boolean; scaleAt?: (t: number) => number; initialFlow?: (priv: Priv, mask: LiquidMask, dx: number, dy: number) => void } = {}) {
  (globalThis as Record<string, unknown>).__silverViscosity = nu;
  const { mask, solver, priv, dx, dy, dz } = makeSolver(grid, options.level);
  const density = new Float64Array(mask.data.length), a = new Float64Array(mask.data.length);
  for (let k = 0; k < mask.activeCount; k++) { const i = mask.active[k], x = i % mask.nx, y = Math.floor(i / mask.nx) % mask.ny, z = Math.floor(i / (mask.nx * mask.ny));
    density[i] = rho((x + 0.5) * dx - R, (y + 0.5) * dy, (z + 0.5) * dz - R); }
  const potential = () => { let p = 0; for (let k = 0; k < mask.activeCount; k++) { const i = mask.active[k], y = (Math.floor(i / mask.nx) % mask.ny + 0.5) * dy; p += GRAV * density[i] / RHO0 * y * cellVolume(mask); } return p; };
  const mean = (() => { let s = 0, v = 0; for (let k = 0; k < mask.activeCount; k++) { const i = mask.active[k]; s += density[i]; v += 1; } return s / v; })();
  options.initialFlow?.(priv, mask, dx, dy);
  if (options.disableFastFaces) (solver as unknown as { classifyFast: () => void }).classifyFast = () => undefined;
  const budget: Budget = { ke: 0, work: 0, viscous: 0, damping: 0, pe0: potential(), pe: 0, residual: 0, mixingLoss: 0, peakKe: 0, peakKeAt: 0 };
  let maxCourant = 0; const courantSeries: number[] = [];
  const dt = 0.05, steps = Math.round(seconds / dt); let ke = kinetic(mask, priv.flow), t = 0;
  for (let n = 1; n <= steps; n++) {
    for (let k = 0; k < mask.activeCount; k++) { const i = mask.active[k]; a[i] = GRAV * (density[i] - mean) / RHO0 * (options.scaleAt ? options.scaleAt(t) : (options.scale ?? 1)); }
    const before = Float32Array.from(priv.flow);
    step(solver, dt, { values: a, scale: 1, iterations: options.iterations ?? 120 });
    solver.transport(density, dt, 0, options.noEddy ? 0 : undefined);
    maxCourant = Math.max(maxCourant, solver.maxTransportCourant); if (n % 20 === 0) courantSeries.push(solver.maxTransportCourant);
    const after = kinetic(mask, priv.flow);
    // Power with the mid-step velocity.
    let work = 0; for (let k = 0; k < mask.activeCount; k++) { const i = mask.active[k]; work += a[i] * (-(0.5 * (before[3 * i + 1] + priv.flow[3 * i + 1]))) * cellVolume(mask); }
    const visc = viscousDissipation(mask, priv, nu, dx, dy, dz), damp = DAMP * (ke + after);   // 2 gamma <KE> with the mean of the two energies
    budget.work += work * dt; budget.viscous += visc * dt; budget.damping += damp * dt;
    budget.residual += ((after - ke) - (work - visc - damp) * dt);
    ke = after; t += dt; if (ke > budget.peakKe) { budget.peakKe = ke; budget.peakKeAt = t; }
    options.record?.(t, { ...budget, ke, total: ke + potential() - budget.pe0 });
  }
  budget.ke = ke; budget.pe = potential(); budget.mixingLoss = -(budget.pe - budget.pe0) - budget.work;
  delete (globalThis as Record<string, unknown>).__silverViscosity;
  return { budget, mask, solver, priv, dx, dy, dz, density, maxCourant };
}
