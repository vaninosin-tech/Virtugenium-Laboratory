import { nodeRadius, nodeSolidFraction, slipSpeed, type FlocConfig } from './flocSystem';
import type { LiquidMask } from '../../tubeVolumeField';

/**
 * How a collision product is shared between the two pivots that bracket its mass.
 * - legacy: the pivot weights are applied to the product MASS. Mass is conserved but each collision removes only
 *   2*m0/m1 (about 0.23) of a particle instead of one, so the particle number is overestimated about 2x
 *   (docs/night/wave19s1/REPORT.md). Kept as the default so every earlier result stays reproducible.
 * - conservative: the weights are applied to the particle NUMBER (Kumar and Ramkrishna fixed pivots). One collision
 *   removes exactly one particle and mass is still conserved. It also puts a true primary particle on the first
 *   pivot (the legacy first pivot is a 0.32 micrometre floc of about two primaries). Select it with
 *   window.__silverSectionScheme = 'conservative'; docs/night/taskB/REPORT.md has the validation.
 */
export type SectionScheme = 'legacy' | 'conservative';

export interface SectionalOptions {
  scheme?: SectionScheme;
  /** Validation hook: replaces the Brownian plus shear kernel (m3/s) for pivot pair (i, j). */
  kernel?: (i: number, j: number) => number;
  /**
   * Skip collisions of classes holding less than this fraction of the cell's solid. Skipped mass simply stays where
   * it is (conservative); only its tiny contribution to the rates is dropped. Default 0 (legacy) and 1e-9 (conservative).
   */
  prune?: number;
  /** Number of pivots of the conservative production grid (default 13, the legacy count). Same first and top pivot. */
  bins?: number;
  /** Validation hook: replaces the production pivot grid (radii in m, particle masses in the same units as the ledger). */
  pivots?: { radii: ArrayLike<number>; masses: ArrayLike<number> };
}

/** Fixed-pivot sectional population. All entries are normalized AgCl mass, never optical density. */
export class SectionalPopulation {
  static readonly count = 13;
  readonly bins: number;
  readonly scheme: SectionScheme;
  private readonly prune: number;
  readonly masses: Float64Array[];
  readonly radii: Float64Array;
  readonly particleMass: Float64Array;
  readonly slip: Float64Array;
  private readonly delta: Float64Array[];
  readonly transfers: Float64Array;
  readonly accumulated: Float64Array;
  private readonly x: Uint8Array;
  private readonly y: Uint8Array;
  private readonly z: Uint8Array;
  private readonly brownian: Float64Array;
  private readonly shear: Float64Array;
  private readonly upper: Uint8Array;
  private readonly upperFraction: Float64Array;
  constructor(readonly mask: LiquidMask, readonly config: FlocConfig, primarySolidM3: number, solidM3PerUnit: number,
    options: SectionalOptions = {}) {
    const n = mask.data.length;
    this.scheme = options.scheme ?? 'legacy';
    this.prune = options.prune ?? (this.scheme === 'conservative' ? 1e-9 : 0);
    this.bins = options.pivots ? options.pivots.radii.length
      : this.scheme === 'conservative' ? Math.max(2, Math.floor(options.bins ?? SectionalPopulation.count)) : SectionalPopulation.count;
    const bins = this.bins;
    this.radii = new Float64Array(bins); this.particleMass = new Float64Array(bins); this.slip = new Float64Array(bins);
    this.transfers = new Float64Array(bins); this.accumulated = new Float64Array(bins);
    this.masses = Array.from({ length: bins }, () => new Float64Array(n));
    this.delta = this.masses.map(() => new Float64Array(n));
    this.x = new Uint8Array(n); this.y = new Uint8Array(n); this.z = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = i % mask.nx;
      this.y[i] = Math.floor(i / mask.nx) % mask.ny;
      this.z[i] = Math.floor(i / (mask.nx * mask.ny));
    }
    const pairs = bins ** 2;
    this.brownian = new Float64Array(pairs); this.shear = new Float64Array(pairs);
    this.upper = new Uint8Array(pairs); this.upperFraction = new Float64Array(pairs);
    const primaryUnit = primarySolidM3 / solidM3PerUnit;
    const crossover = 1e-6;
    const crossoverUnit = primaryUnit * 0.5 * (crossover / (config.primaryRadius ?? 0.2e-6)) ** 3;
    const primaryRadius = config.primaryRadius ?? 0.2e-6;
    for (let b = 0; b < bins; b++) {
      this.radii[b] = 0.32e-6 * 2.05 ** b;
      this.particleMass[b] = this.radii[b] < crossover
        ? primaryUnit * 0.5 * (this.radii[b] / primaryRadius) ** 3
        : crossoverUnit * (this.radii[b] / crossover) ** config.fractalDimension;
    }
    if (options.pivots) {
      for (let b = 0; b < bins; b++) { this.radii[b] = options.pivots.radii[b]; this.particleMass[b] = options.pivots.masses[b]; }
    } else if (this.scheme === 'conservative') {
      // Same top pivot as the legacy grid, but the first pivot is one primary particle and the masses are geometric.
      // Top pivot: the legacy grid's 13th pivot, whatever the number of pivots.
      const topRadius = 0.32e-6 * 2.05 ** (SectionalPopulation.count - 1);
      const top = topRadius < crossover ? primaryUnit * 0.5 * (topRadius / primaryRadius) ** 3
        : crossoverUnit * (topRadius / crossover) ** config.fractalDimension;
      const ratio = (top / primaryUnit) ** (1 / (bins - 1));
      for (let b = 0; b < bins; b++) {
        const mass = primaryUnit * ratio ** b;
        this.particleMass[b] = mass;
        this.radii[b] = b === 0 ? primaryRadius : mass < crossoverUnit
          ? primaryRadius * (2 * mass / primaryUnit) ** (1 / 3)
          : crossover * (mass / crossoverUnit) ** (1 / config.fractalDimension);
      }
    }
    for (let b = 0; b < bins; b++) this.slip[b] = slipSpeed(this.radii[b], config);
    const kT = 1.380649e-23 * 293.15, mu = config.dynamicViscosity ?? 1.002e-3;
    for (let i = 0; i < bins; i++) for (let j = i; j < bins; j++) {
      const p = i * bins + j;
      const ri = this.radii[i], rj = this.radii[j], product = this.particleMass[i] + this.particleMass[j];
      this.brownian[p] = options.kernel ? options.kernel(i, j) : 2 * kT / (3 * mu) * (ri + rj) * (1 / ri + 1 / rj);
      this.shear[p] = options.kernel ? 0 : (ri + rj) ** 3 / 3;
      let upper = 1;
      while (upper < this.particleMass.length - 1 && this.particleMass[upper] < product) upper++;
      this.upper[p] = upper;
      this.upperFraction[p] = Math.min(1, Math.max(0,
        (product - this.particleMass[upper - 1]) / (this.particleMass[upper] - this.particleMass[upper - 1])));
    }
  }
  get totalMass() { let total = 0; for (const bin of this.masses) for (const v of bin) total += v; return total; }
  massByClass() { return this.masses.map(bin => bin.reduce((s, v) => s + v, 0)); }
  /** Remap newly dry cells to the closest wet cell, preserving every bin independently. */
  remap(old: Uint8Array | Float32Array | Float64Array) {
    const m = this.mask;
    for (let i = 0; i < old.length; i++) {
      if (!old[i] || m.data[i]) continue;
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      let nearest = -1, distance = Infinity;
      for (let a = 0; a < m.activeCount; a++) {
        const j = m.active[a], dx = j % m.nx - x;
        const dy = Math.floor(j / m.nx) % m.ny - y;
        const dz = Math.floor(j / (m.nx * m.ny)) - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < distance) { distance = d; nearest = j; }
      }
      if (nearest < 0) continue;
      for (const bin of this.masses) { bin[nearest] += bin[i]; bin[i] = 0; }
    }
  }
  /** Brownian plus resolved shear Smoluchowski events. Pair consumption is limited by both source masses. */
  collide(dt: number, cellM3: number, strain: Float32Array, sticking: number | Float64Array) {
    const m = this.mask;
    this.transfers.fill(0);
    for (let a = 0; a < m.activeCount; a++) {
      const cell = m.active[a], G = strain[cell];
      const alpha = typeof sticking === 'number' ? sticking : sticking[cell];
      let highest = 0;
      for (let b = this.masses.length - 1; b > 0; b--)
        if (this.masses[b][cell] > 0) { highest = b; break; }
      const top = Math.min(this.masses.length - 1, highest + 1);
      let cut = 0;
      if (this.prune > 0) {
        let total = 0;
        for (let b = 0; b <= highest; b++) total += this.masses[b][cell];
        cut = this.prune * total;
      }
      for (let i = 0; i <= top; i++) {
        const mi = this.particleMass[i];
        if (this.masses[i][cell] + this.delta[i][cell] <= cut) continue;
        for (let j = i; j <= top; j++) {
          const mj = this.particleMass[j], p = i * this.bins + j;
          const ai = this.masses[i][cell] + this.delta[i][cell];
          const aj = this.masses[j][cell] + this.delta[j][cell];
          if (ai <= cut || aj <= cut) continue;
          const kernel = this.brownian[p] + G * this.shear[p];
          const ni = ai / mi, nj = aj / mj;
          const events = Math.min((i === j ? ni / 2 : Math.min(ni, nj)) * 0.25,
            alpha * kernel * ni * nj * dt / cellM3 * (i === j ? 0.5 : 1));
          if (!(events > 0)) continue;
          const fromI = events * mi, fromJ = events * mj;
          this.delta[i][cell] -= fromI; this.delta[j][cell] -= fromJ;
          const product = mi + mj, upper = this.upper[p], lower = upper - 1;
          const upperFraction = this.upperFraction[p];
          let toLower: number, toUpper: number;
          if (this.scheme === 'conservative') {
            // Number weights: one product particle is shared as (1 - f) on the lower and f on the upper pivot.
            // Beyond the last pivot the whole product mass goes there (number cannot be kept, mass is).
            const beyond = product > this.particleMass[upper];
            toUpper = events * (beyond ? product : upperFraction * this.particleMass[upper]);
            toLower = beyond ? 0 : events * (1 - upperFraction) * this.particleMass[lower];
          } else {
            toLower = events * product * (1 - upperFraction);
            toUpper = events * product * upperFraction;
          }
          this.delta[lower][cell] += toLower;
          this.delta[upper][cell] += toUpper;
          this.transfers[upper] += toUpper;
          this.accumulated[upper] += toUpper;
        }
      }
    }
    for (let b = 0; b < this.masses.length; b++) {
      const mass = this.masses[b], delta = this.delta[b];
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; mass[i] += delta[i]; delta[i] = 0; }
    }
  }
  /** Conservative face fluxes under the resolved flow and section-specific vertical slip. */
  transport(dt: number, flow: Float32Array, gravitySign: number, deposit: (column: number, amount: number) => void, subcycle = false, faces?: readonly ArrayLike<number>[]) {
    const m = this.mask, dx = 2 * m.radius / m.nx, dy = m.height / m.ny, dz = 2 * m.radius / m.nz;
    // Each face moves at most 12 percent of a cell per pass, so one pass follows a flow only up to 0.12 h / dt (about 2.5 mm/s here);
    // a faster flow leaves the aggregates behind. With `subcycle` the step is cut into passes of Courant number at most 0.12 (at most 64),
    // the same conservative scheme and the same deposit rule per pass. Off: the accepted single pass.
    let passes = 1;
    if (subcycle) {
      let courant = 0;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        courant = Math.max(courant, Math.abs(flow[3 * i]) * dt / dx, (Math.abs(flow[3 * i + 1]) + this.slip[this.slip.length - 1]) * dt / dy, Math.abs(flow[3 * i + 2]) * dt / dz);
      }
      passes = Math.min(64, Math.max(1, Math.ceil(courant / 0.12)));
    }
    if (passes > 1) { for (let k = 0; k < passes; k++) this.transport(dt / passes, flow, gravitySign, deposit, false, faces); return; }
    const strideZ = m.nx * m.ny;
    for (let b = 0; b < this.masses.length; b++) {
      const mass = this.masses[b], delta = this.delta[b], slip = this.slip[b] * gravitySign;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], x = this.x[i], y = this.y[i], z = this.z[i];
        const original = mass[i]; if (original <= 0) continue;
        let out = 0;
        for (let side = 0; side < 6; side++) {
          let j: number;
          switch (side) {
            case 0: j = x > 0 ? i - 1 : -1; break;
            case 1: j = x + 1 < m.nx ? i + 1 : -1; break;
            case 2: j = y > 0 ? i - m.nx : -1; break;
            case 3: j = y + 1 < m.ny ? i + m.nx : -1; break;
            case 4: j = z > 0 ? i - strideZ : -1; break;
            default: j = z + 1 < m.nz ? i + strideZ : -1;
          }
          if (j < 0 || !m.data[j]) continue;
          const axis = side >> 1, sign = side % 2 ? 1 : -1;
          // With `faces` the flux uses the solver's staggered face velocity (divergence free, the same field the scalars use); otherwise the
          // average of the two cell-centred velocities, which is not divergence free on the staggered grid.
          const carrier = faces ? (sign > 0 ? Number(faces[axis][i]) : Number(faces[axis][j])) : 0.5 * (flow[3 * i + axis] + flow[3 * j + axis]);
          const v = carrier + (axis === 1 ? slip : 0);
          const share = Math.max(0, sign * v) * dt / (axis === 0 ? dx : axis === 1 ? dy : dz);
          const moved = original * Math.min(0.12, share);
          delta[i] -= moved; delta[j] += moved; out += moved;
        }
        // Bottom contact: the particle centre is within one voxel of the bowl, and only slip deposits it.
        if (slip < 0 && (y === 0 || !m.data[i - m.nx])) {
          const moved = original * Math.min(0.25, -slip * dt / dy);
          delta[i] -= moved; out += moved;
          deposit(z * m.nx + x, moved);
        }
        if (out > original + 1e-15) throw new Error(`Section transport CFL exceeded by ${out - original}`);
      }
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; mass[i] += delta[i]; delta[i] = 0; }
    }
  }
  solidFraction(bin: number) { return nodeSolidFraction(this.radii[bin], this.config); }
  representedRadius(mass: number) { return nodeRadius(mass, this.config); }
}
