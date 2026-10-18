import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { SectionalPopulation, type SectionScheme } from '../../../src/scenes/laboratory/lib/night/stage1/sectionalPopulation';
import { DEFAULT_FLOC_CONFIG } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';
import { STAGE3_AGCL_SOLID_M3_PER_UNIT } from '../../../src/scenes/laboratory/lib/tubeSilverSediment';

// Task B: validation of the sectional aggregation scheme against exact Smoluchowski solutions (CPU only, one wet cell).
const CONFIG = { ...DEFAULT_FLOC_CONFIG, radius: .007, bottom: 0, height: .055 };
const PRIMARY_RADIUS = 0.2e-6, PRIMARY_M3 = 4 * Math.PI / 3 * PRIMARY_RADIUS ** 3;
const kB = 1.380649e-23, T = 293.15, mu = 1.002e-3, BROWNIAN_EQUAL = 8 * kB * T / (3 * mu);

function mask() {
  const m = new LiquidMask(8, 16, 8, .007, 0, .055);
  m.update(new THREE.Vector3(0, 1, 0), .025);
  return m;
}

/** Geometric mass pivots from one monomer (mass 1) with the given mass ratio between neighbours, up to mass `top`. */
function geometricGrid(massRatio: number, top: number) {
  const bins = Math.ceil(Math.log(top) / Math.log(massRatio)) + 1;
  const masses = new Float64Array(bins), radii = new Float64Array(bins);
  for (let b = 0; b < bins; b++) { masses[b] = massRatio ** b; radii[b] = PRIMARY_RADIUS * masses[b] ** (1 / 3); }
  return { radii, masses };
}

interface Run { number: number; mass: number; m2: number; monomers: number; massDrift: number; minMass: number }
/** One wet cell, monomers only at t=0, constant kernel K=1, cell volume 1: n0 = N0, tau = 2/(K N0). */
function constantKernelBox(scheme: SectionScheme, massRatio: number, N0: number, x: number, dt: number): Run {
  const grid = geometricGrid(massRatio, 2 ** 14), msk = mask();
  const p = new SectionalPopulation(msk, CONFIG, PRIMARY_M3, STAGE3_AGCL_SOLID_M3_PER_UNIT,
    { scheme, kernel: () => 1, pivots: grid });
  const cell = msk.active[0], strain = new Float32Array(msk.data.length);
  p.masses[0][cell] = N0;
  const tau = 2 / N0, steps = Math.round(x * tau / dt);
  let drift = 0, minMass = 0;
  for (let s = 0; s < steps; s++) {
    p.collide(dt, 1, strain, 1);
    drift = Math.max(drift, Math.abs(p.masses.reduce((a, b) => a + b[cell], 0) - N0) / N0);
    for (const bin of p.masses) minMass = Math.min(minMass, bin[cell]);
  }
  let number = 0, m2 = 0;
  p.masses.forEach((bin, b) => { number += bin[cell] / p.particleMass[b]; m2 += bin[cell] * p.particleMass[b]; });
  return { number, mass: p.masses.reduce((a, b) => a + b[cell], 0), m2, monomers: p.masses[0][cell] / p.particleMass[0],
    massDrift: drift, minMass };
}
/** Exact solution for the constant kernel: n_k = N0 x^(k-1) / (1+x)^(k+1). */
const exact = (N0: number, x: number) => ({ number: N0 / (1 + x), m2: N0 * (1 + 2 * x), monomers: N0 / (1 + x) ** 2 });

describe('Task B: sectional scheme against the exact constant-kernel Smoluchowski solution', () => {
  const N0 = 1000, dt = 2e-5;
  // The production grid has a mass ratio of 2.05^3 = 8.6 between its first pivots.
  const PRODUCTION_RATIO = 2.05 ** 3;
  it('legacy scheme keeps about twice the exact particle number on a production-like grid (documented defect)', () => {
    const r = constantKernelBox('legacy', PRODUCTION_RATIO, N0, 5, dt), e = exact(N0, 5);
    console.log('legacy, mass ratio 8.6, x=5: N/N_exact =', (r.number / e.number).toFixed(3));
    expect(r.number / e.number).toBeGreaterThan(1.5);
    expect(constantKernelBox('legacy', 2, N0, 5, dt).number / e.number).toBeLessThan(1.1);
  });
  it('conservative scheme is exact in particle number on the production-like grid, too', () => {
    const e = exact(N0, 5), r = constantKernelBox('conservative', PRODUCTION_RATIO, N0, 5, dt);
    console.log('conservative, mass ratio 8.6, x=5: N/N_exact =', (r.number / e.number).toFixed(4),
      ' M2/M2_exact =', (r.m2 / e.m2).toFixed(3));
    expect(Math.abs(r.number / e.number - 1)).toBeLessThan(0.02);
  });
  it('conservative scheme follows the exact particle number and monomer count and conserves mass', () => {
    for (const x of [1, 5, 10]) {
      const r = constantKernelBox('conservative', 2, N0, x, dt), e = exact(N0, x);
      expect(Math.abs(r.number / e.number - 1)).toBeLessThan(0.02);
      expect(r.massDrift).toBeLessThan(1e-12);
      expect(r.minMass).toBeGreaterThanOrEqual(0);
      // The pivot-0 population is monomers only, so it is directly comparable with n_1.
      expect(Math.abs(r.monomers / e.monomers - 1)).toBeLessThan(0.03);
    }
  });
  it('size distribution converges with pivot refinement (second moment)', () => {
    const e = exact(N0, 5);
    const errors = [2, 2 ** 0.5, 2 ** 0.25].map(ratio => Math.abs(constantKernelBox('conservative', ratio, N0, 5, dt).m2 / e.m2 - 1));
    console.log('constant kernel x=5: relative M2 error for mass ratios 2, 2^(1/2), 2^(1/4) =', errors.map(v => v.toFixed(4)).join(', '));
    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
  });
  it('time step convergence of the particle number', () => {
    const e = exact(N0, 5);
    const coarse = Math.abs(constantKernelBox('conservative', 2, N0, 5, 8e-5).number / e.number - 1);
    const fine = Math.abs(constantKernelBox('conservative', 2, N0, 5, 2e-5).number / e.number - 1);
    console.log('constant kernel x=5: relative N error dt=8e-5 / 2e-5 =', coarse.toFixed(5), fine.toFixed(5));
    expect(fine).toBeLessThan(coarse);
  });
});

const PRODUCTION_RATIO_FOR_BROWNIAN = 2.05 ** 3;

describe('Task B: grid construction and the true Brownian kernel', () => {
  const unit = PRIMARY_M3 / STAGE3_AGCL_SOLID_M3_PER_UNIT;
  it('legacy grid is unchanged by default; the conservative grid starts at one primary particle', () => {
    const legacy = new SectionalPopulation(mask(), CONFIG, PRIMARY_M3, STAGE3_AGCL_SOLID_M3_PER_UNIT);
    const next = new SectionalPopulation(mask(), CONFIG, PRIMARY_M3, STAGE3_AGCL_SOLID_M3_PER_UNIT, { scheme: 'conservative' });
    expect(legacy.scheme).toBe('legacy');
    expect(legacy.radii[0]).toBeCloseTo(0.32e-6, 18);
    expect(legacy.particleMass[0] / unit).toBeCloseTo(0.5 * (0.32 / 0.2) ** 3, 12);
    expect(next.radii[0]).toBe(PRIMARY_RADIUS);
    expect(next.particleMass[0]).toBeCloseTo(unit, 18);
    expect(next.bins).toBe(legacy.bins);
    expect(next.particleMass[next.bins - 1]).toBeCloseTo(legacy.particleMass[legacy.bins - 1], 9);
    for (let b = 1; b < next.bins; b++) {
      expect(next.particleMass[b]).toBeGreaterThan(next.particleMass[b - 1]);
      expect(next.radii[b]).toBeGreaterThan(next.radii[b - 1]);
    }
  });

  /** Primaries only, physical concentration, true Brownian kernel (no override); pivots with a given mass ratio. */
  function brownianBox(scheme: SectionScheme, massRatio: number, tauMultiples: number, dt: number) {
    const grid = geometricGrid(massRatio, 2 ** 16), msk = mask(), cellM3 = 1e-14, n0 = 1e17;
    const p = new SectionalPopulation(msk, CONFIG, PRIMARY_M3, STAGE3_AGCL_SOLID_M3_PER_UNIT, { scheme, pivots: grid });
    const cell = msk.active[0], strain = new Float32Array(msk.data.length), N0 = n0 * cellM3;
    p.masses[0][cell] = N0;
    const tau = 2 / (BROWNIAN_EQUAL * n0), steps = Math.round(tauMultiples * tau / dt);
    for (let s = 0; s < steps; s++) p.collide(dt, cellM3, strain, 1);
    let number = 0;
    p.masses.forEach((bin, b) => { number += bin[cell] / p.particleMass[b]; });
    return { number: number / N0, mass: p.masses.reduce((a, b) => a + b[cell], 0) / N0 };
  }
  it('true Brownian kernel: particle number converges with pivot refinement; the legacy split stays far off', () => {
    const dt = 0.005, x = 5;
    const reference = brownianBox('conservative', 2 ** 0.25, x, dt);
    const rows = [PRODUCTION_RATIO_FOR_BROWNIAN, 2, 2 ** 0.5].map(r => ({ r, c: brownianBox('conservative', r, x, dt),
      l: brownianBox('legacy', r, x, dt) }));
    console.log('Brownian kernel, t = 5 tau (tau = 2/(K n0) of equal-size primaries): N/N0 reference (ratio 2^(1/4)) =',
      reference.number.toFixed(4));
    for (const row of rows) console.log(`  mass ratio ${row.r.toFixed(3)}: conservative ${row.c.number.toFixed(4)}  legacy ${row.l.number.toFixed(4)}`);
    const errors = rows.map(row => Math.abs(row.c.number / reference.number - 1));
    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
    expect(errors[2]).toBeLessThan(0.05);
    expect(rows[0].l.number / reference.number).toBeGreaterThan(1.5);
    for (const row of rows) expect(Math.abs(row.c.mass - 1)).toBeLessThan(1e-12);
  });
});

describe('Task B: the scheme inside the stage-3 field', () => {
  it('is selected only by __silverSectionScheme and keeps the exact solid ledger every step', async () => {
    const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
    const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
    const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
    const schemes: Record<string, string> = {};
    for (const scheme of ['unset', 'conservative', 'conservative52']) {
      vi.stubGlobal('window', { __silverStage: 3, __silverAgg: 1, location: { search: '' } });
      if (scheme !== 'unset') (globalThis as { __silverSectionScheme?: string }).__silverSectionScheme = 'conservative';
      if (scheme === 'conservative52') (globalThis as { __silverSectionBins?: number }).__silverSectionBins = 52;
      const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
      const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
      try {
        for (let k = 0; k < 100; k++) {
          const delivery = Math.min(1, (k + 1) * .04), level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
          f.mask.update(up, level); inlet.y = level - .001;
          f.advance(.05, up, level, inlet, delivery, 0, .4);
          f.assertMassInvariant();
          expect(Math.abs(f.species['Ag+'].total + f.extent - 1)).toBeLessThan(1e-12);
        }
        schemes[scheme] = `${f.sections.scheme}/${f.sections.bins}`;
        expect(f.sections.totalMass).toBeGreaterThan(0);
      } finally { f.dispose(); vi.unstubAllGlobals(); delete (globalThis as { __silverSectionScheme?: string }).__silverSectionScheme; delete (globalThis as { __silverSectionBins?: number }).__silverSectionBins; }
    }
    expect(schemes).toEqual({ unset: 'legacy/13', conservative: 'conservative/13', conservative52: 'conservative/52' });
  }, 120000);
});
