import { nodeRadius, nodeSolidFraction, slipSpeed, type FlocConfig } from './flocSystem';
import type { LiquidMask } from '../../tubeVolumeField';

/** Fixed-pivot sectional population. All entries are normalized AgCl mass, never optical density. */
export class SectionalPopulation {
  static readonly count = 13;
  readonly masses: Float64Array[];
  readonly radii = new Float64Array(SectionalPopulation.count);
  readonly particleMass = new Float64Array(SectionalPopulation.count);
  readonly slip = new Float64Array(SectionalPopulation.count);
  private readonly delta: Float64Array[];
  readonly transfers = new Float64Array(SectionalPopulation.count);
  readonly accumulated = new Float64Array(SectionalPopulation.count);
  private readonly x: Uint8Array;
  private readonly y: Uint8Array;
  private readonly z: Uint8Array;
  private readonly brownian: Float64Array;
  private readonly shear: Float64Array;
  private readonly upper: Uint8Array;
  private readonly upperFraction: Float64Array;
  constructor(readonly mask: LiquidMask, readonly config: FlocConfig, primarySolidM3: number, solidM3PerUnit: number) {
    const n = mask.data.length;
    this.masses = Array.from({ length: SectionalPopulation.count }, () => new Float64Array(n));
    this.delta = this.masses.map(() => new Float64Array(n));
    this.x = new Uint8Array(n); this.y = new Uint8Array(n); this.z = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = i % mask.nx;
      this.y[i] = Math.floor(i / mask.nx) % mask.ny;
      this.z[i] = Math.floor(i / (mask.nx * mask.ny));
    }
    const pairs = SectionalPopulation.count ** 2;
    this.brownian = new Float64Array(pairs); this.shear = new Float64Array(pairs);
    this.upper = new Uint8Array(pairs); this.upperFraction = new Float64Array(pairs);
    const primaryUnit = primarySolidM3 / solidM3PerUnit;
    const crossover = 1e-6;
    const crossoverUnit = primaryUnit * 0.5 * (crossover / (config.primaryRadius ?? 0.2e-6)) ** 3;
    for (let b = 0; b < this.radii.length; b++) {
      this.radii[b] = 0.32e-6 * 2.05 ** b;
      this.particleMass[b] = this.radii[b] < crossover
        ? primaryUnit * 0.5 * (this.radii[b] / (config.primaryRadius ?? 0.2e-6)) ** 3
        : crossoverUnit * (this.radii[b] / crossover) ** config.fractalDimension;
      this.slip[b] = slipSpeed(this.radii[b], config);
    }
    const kT = 1.380649e-23 * 293.15, mu = config.dynamicViscosity ?? 1.002e-3;
    for (let i = 0; i < SectionalPopulation.count; i++) for (let j = i; j < SectionalPopulation.count; j++) {
      const p = i * SectionalPopulation.count + j;
      const ri = this.radii[i], rj = this.radii[j], product = this.particleMass[i] + this.particleMass[j];
      this.brownian[p] = 2 * kT / (3 * mu) * (ri + rj) * (1 / ri + 1 / rj);
      this.shear[p] = (ri + rj) ** 3 / 3;
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
      for (let i = 0; i <= top; i++) {
        const mi = this.particleMass[i];
        if (this.masses[i][cell] + this.delta[i][cell] <= 0) continue;
        for (let j = i; j <= top; j++) {
          const mj = this.particleMass[j], p = i * SectionalPopulation.count + j;
          const ai = this.masses[i][cell] + this.delta[i][cell];
          const aj = this.masses[j][cell] + this.delta[j][cell];
          if (ai <= 0 || aj <= 0) continue;
          const kernel = this.brownian[p] + G * this.shear[p];
          const ni = ai / mi, nj = aj / mj;
          const events = Math.min((i === j ? ni / 2 : Math.min(ni, nj)) * 0.25,
            alpha * kernel * ni * nj * dt / cellM3 * (i === j ? 0.5 : 1));
          if (!(events > 0)) continue;
          const fromI = events * mi, fromJ = events * mj;
          this.delta[i][cell] -= fromI; this.delta[j][cell] -= fromJ;
          const product = mi + mj, upper = this.upper[p], lower = upper - 1;
          const upperFraction = this.upperFraction[p];
          this.delta[lower][cell] += events * product * (1 - upperFraction);
          this.delta[upper][cell] += events * product * upperFraction;
          const moved = events * product;
          this.transfers[upper] += moved * upperFraction;
          this.accumulated[upper] += moved * upperFraction;
        }
      }
    }
    for (let b = 0; b < this.masses.length; b++) {
      const mass = this.masses[b], delta = this.delta[b];
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; mass[i] += delta[i]; delta[i] = 0; }
    }
  }
  /** Conservative face fluxes under the resolved flow and section-specific vertical slip. */
  transport(dt: number, flow: Float32Array, gravitySign: number, deposit: (column: number, amount: number) => void) {
    const m = this.mask, dx = 2 * m.radius / m.nx, dy = m.height / m.ny, dz = 2 * m.radius / m.nz;
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
          const v = 0.5 * (flow[3 * i + axis] + flow[3 * j + axis]) + (axis === 1 ? slip : 0);
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
