import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { SectionalPopulation, type SectionScheme } from '../../../src/scenes/laboratory/lib/night/stage1/sectionalPopulation';
import { DEFAULT_FLOC_CONFIG } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';
import { STAGE3_AGCL_SOLID_M3_PER_UNIT } from '../../../src/scenes/laboratory/lib/tubeSilverSediment';

// Task B, second part: sum-kernel analytic check, grid and time-step convergence of the production Brownian and shear
// kernels, the physical homogeneous box with the production radius law, and the cost of a collide step.
const mask = () => { const m = new LiquidMask(8, 16, 8, .007, 0, .055); m.update(new THREE.Vector3(0, 1, 0), .025); return m; };
const CONFIG = (rp = 0.2e-6) => ({ ...DEFAULT_FLOC_CONFIG, radius: .007, bottom: 0, height: .055, primaryRadius: rp });
const solidOf = (rp: number) => 4 * Math.PI / 3 * rp ** 3;

function geometric(massRatio: number, top: number, rp = 0.2e-6) {
  const bins = Math.ceil(Math.log(top) / Math.log(massRatio)) + 1, masses = new Float64Array(bins), radii = new Float64Array(bins);
  for (let b = 0; b < bins; b++) { masses[b] = massRatio ** b; radii[b] = rp * masses[b] ** (1 / 3); }
  return { masses, radii };
}

describe('Task B: sum kernel K = B (m_i + m_j), exact N = N0 exp(-x), M2 = M2_0 exp(2x), x = B M1 t', () => {
  const N0 = 1000;
  function run(massRatio: number, x: number, dt: number) {
    const grid = geometric(massRatio, 2 ** 20), m = mask(), cell = m.active[0], strain = new Float32Array(m.data.length);
    const p = new SectionalPopulation(m, CONFIG(), solidOf(0.2e-6), STAGE3_AGCL_SOLID_M3_PER_UNIT,
      { scheme: 'conservative', pivots: grid, kernel: (i, j) => 1e-3 * (grid.masses[i] + grid.masses[j]) });
    p.masses[0][cell] = N0;
    const steps = Math.round(x / (1e-3 * N0) / dt);
    let minimum = 0, drift = 0;
    for (let s = 0; s < steps; s++) {
      p.collide(dt, 1, strain, 1);
      for (const bin of p.masses) minimum = Math.min(minimum, bin[cell]);
      drift = Math.max(drift, Math.abs(p.masses.reduce((a, b) => a + b[cell], 0) / N0 - 1));
    }
    let number = 0, m2 = 0;
    p.masses.forEach((bin, b) => { number += bin[cell] / p.particleMass[b]; m2 += bin[cell] * p.particleMass[b]; });
    return { number: number / N0, m2: m2 / N0, minimum, drift };
  }
  it('number is exact, mass is conserved, nothing goes negative, and M2 converges with the pivot ratio', () => {
    const x = 1.5, dt = 0.02;
    const rows = [2, 2 ** 0.5, 2 ** 0.25].map(r => ({ r, ...run(r, x, dt) }));
    const eN = rows.map(r => Math.abs(r.number / Math.exp(-x) - 1)), eM2 = rows.map(r => Math.abs(r.m2 / Math.exp(2 * x) - 1));
    console.log('sum kernel x=1.5: N error', eN.map(v => v.toFixed(4)).join(', '), ' M2 error', eM2.map(v => v.toFixed(4)).join(', '),
      ' (mass ratios 2, 2^(1/2), 2^(1/4))');
    for (const r of rows) { expect(r.drift).toBeLessThan(1e-12); expect(r.minimum).toBeGreaterThanOrEqual(0); }
    expect(eM2[1]).toBeLessThan(eM2[0]); expect(eM2[2]).toBeLessThan(eM2[1]);
    expect(eN[2]).toBeLessThan(0.05);
  });
});

/** Physical homogeneous box with the production radius law: primaries r_p, full-conversion solid fraction of 2 mL. */
function productionBox(opts: { scheme: SectionScheme; bins: number; rp: number; G: number; alpha: number; tEnd: number; dt: number; marks?: number[];
  phiScale?: number; prune?: number }) {
  const m = mask(), cell = m.active[0], strain = new Float32Array(m.data.length).fill(opts.G);
  const p = new SectionalPopulation(m, CONFIG(opts.rp), solidOf(opts.rp), STAGE3_AGCL_SOLID_M3_PER_UNIT,
    { scheme: opts.scheme, bins: opts.bins, prune: opts.prune });
  const phi = (opts.phiScale ?? 1) * STAGE3_AGCL_SOLID_M3_PER_UNIT / 2e-6, n0 = phi / solidOf(opts.rp), cellM3 = 1e-14, N0 = n0 * cellM3;
  p.masses[0][cell] = N0 * p.particleMass[0];
  const total0 = p.masses[0][cell];
  const metrics = () => {
    let number = 0, m2 = 0, minimum = 0;
    p.masses.forEach((bin, b) => { number += bin[cell] / p.particleMass[b]; m2 += bin[cell] * p.particleMass[b]; minimum = Math.min(minimum, bin[cell]); });
    const above = (r: number) => p.masses.reduce((a, bin, b) => a + (p.radii[b] > r ? bin[cell] : 0), 0) / total0;
    let rLargest = 0; p.masses.forEach((bin, b) => { if (bin[cell] / total0 > 0.01) rLargest = Math.max(rLargest, p.radii[b]); });
    return { N: number / N0, m2: m2 / total0 / p.particleMass[0], above1: above(1e-6), above10: above(1e-5), above100: above(1e-4),
      rLargestUm: rLargest * 1e6, drift: Math.abs(p.masses.reduce((a, b) => a + b[cell], 0) / total0 - 1), minimum };
  };
  const out = new Map<number, ReturnType<typeof metrics>>();
  const steps = Math.round(opts.tEnd / opts.dt);
  for (let s = 1; s <= steps; s++) {
    p.collide(opts.dt, cellM3, strain, opts.alpha);
    for (const mark of opts.marks ?? []) if (s === Math.round(mark / opts.dt)) out.set(mark, metrics());
  }
  return { final: metrics(), marks: out };
}

describe('Task B: production Brownian and shear kernels, conservative scheme, grid and step convergence', () => {
  const base = { scheme: 'conservative' as SectionScheme, rp: 0.2e-6, alpha: 1, tEnd: 22, dt: 0.05 };
  it('particle number, M2 and the large-class mass converge as the number of sections grows (Brownian only, then with shear)', () => {
    const lines: string[] = [];
    for (const G of [0, 2]) {
      const results = [13, 26, 52, 104, 208].map(bins => ({ bins, ...productionBox({ ...base, G, bins }).final }));
      lines.push(`G = ${G} 1/s, r_p 0.2 um, sticking 1, 22 s (dt 0.05):`,
        ...results.map(r => `  bins ${String(r.bins).padStart(3)}  N/N0 ${r.N.toFixed(4)}  M2/M2_0 ${r.m2.toFixed(2)}  mass>1um ${r.above1.toFixed(4)}  >10um ${r.above10.toFixed(4)}  >100um ${r.above100.toFixed(5)}  r_largest(1%) ${r.rLargestUm.toFixed(2)} um  drift ${r.drift.toExponential(1)}  min ${r.minimum}`));
      const ref = results[results.length - 1], err = (v: number, r: number) => Math.abs(v - r) / Math.max(Math.abs(r), 1e-300);
      for (const r of results) { expect(r.drift).toBeLessThan(1e-12); expect(r.minimum).toBeGreaterThanOrEqual(0); }
      const eN = results.slice(0, 4).map(r => err(r.N, ref.N)), eM2 = results.slice(0, 4).map(r => err(r.m2, ref.m2));
      lines.push(`  relative error against 208 sections: N ${eN.map(v => v.toFixed(4)).join(' ')}   M2 ${eM2.map(v => v.toFixed(3)).join(' ')}`);
      expect(eN[3]).toBeLessThan(eN[0]); expect(eM2[3]).toBeLessThan(eM2[0]);
    }
    console.log('TASK B PRODUCTION CONVERGENCE\n' + lines.join('\n'));
  }, 300000);

  it('time-step convergence of the production configuration (52 sections, G = 2)', () => {
    const coarse = productionBox({ ...base, G: 2, bins: 52, dt: 0.05 }).final, fine = productionBox({ ...base, G: 2, bins: 52, dt: 0.0125 }).final;
    console.log(`dt 0.05 vs 0.0125 (52 sections, G=2): N ${coarse.N.toFixed(4)} / ${fine.N.toFixed(4)}  M2 ${coarse.m2.toFixed(2)} / ${fine.m2.toFixed(2)}  mass>10um ${coarse.above10.toFixed(4)} / ${fine.above10.toFixed(4)}`);
    expect(Math.abs(coarse.N / fine.N - 1)).toBeLessThan(0.1);
  }, 300000);

  it('limited primary-radius and sticking comparison on the converged grid (104 sections, G = 2): do larger flocs form?', () => {
    const lines: string[] = ['LIMITED COMPARISON (104 sections, conservative, G = 2 1/s, 22 s)'];
    for (const rp of [0.05e-6, 0.2e-6]) for (const alpha of [1, 0.3, 0.05]) {
      const r = productionBox({ ...base, rp, alpha, G: 2, bins: 104, marks: [5, 10] });
      lines.push(`  r_p ${(rp * 1e6).toFixed(2)} um  sticking ${String(alpha).padEnd(4)}  N/N0 ${r.final.N.toFixed(4)}  mass>1um ${r.final.above1.toFixed(4)} (10 s ${r.marks.get(10)!.above1.toFixed(4)})  >10um ${r.final.above10.toFixed(4)}  >100um ${r.final.above100.toFixed(5)}  r_largest(1%) ${r.final.rLargestUm.toFixed(1)} um`);
      expect(r.final.drift).toBeLessThan(1e-12);
    }
    console.log(lines.join('\n'));
  }, 600000);
});

describe('Task B: pruning, dense and high-shear pockets, cost', () => {
  const base = { scheme: 'conservative' as SectionScheme, rp: 0.2e-6, alpha: 1, tEnd: 22, dt: 0.05 };
  it('pruning negligible classes does not change the result noticeably', () => {
    for (const bins of [52, 104]) {
      const full = productionBox({ ...base, G: 2, bins, prune: 0 }).final, pruned = productionBox({ ...base, G: 2, bins, prune: 1e-9 }).final;
      console.log(`prune 0 vs 1e-9 (${bins} sections): N ${full.N.toFixed(5)} / ${pruned.N.toFixed(5)}  M2 ${full.m2.toFixed(3)} / ${pruned.m2.toFixed(3)}  drift ${pruned.drift.toExponential(1)}`);
      expect(Math.abs(pruned.N / full.N - 1)).toBeLessThan(1e-3);
      expect(Math.abs(pruned.m2 / full.m2 - 1)).toBeLessThan(1e-2);
      expect(pruned.drift).toBeLessThan(1e-12);
    }
  });

  it('dense plume pockets and strong local shear on the converged grid: do cotton-sized flocs appear?', () => {
    const lines: string[] = ['DENSE / HIGH-SHEAR POCKETS (104 sections, conservative, sticking 1, 22 s; phi = multiple of the full-conversion mean 1.3e-3)'];
    let largest = 0;
    for (const rp of [0.2e-6, 0.05e-6]) for (const phiScale of [1, 4, 10, 50]) for (const G of [2, 10, 50]) {
      const r = productionBox({ ...base, rp, G, bins: 104, phiScale }).final;
      largest = Math.max(largest, r.rLargestUm);
      lines.push(`  r_p ${(rp * 1e6).toFixed(2)} um  phi x${String(phiScale).padEnd(2)}  G ${String(G).padEnd(2)} 1/s  N/N0 ${r.N.toFixed(5)}  mass>1um ${r.above1.toFixed(4)}  >10um ${r.above10.toFixed(4)}  >100um ${r.above100.toFixed(5)}  r_largest(1%) ${r.rLargestUm.toFixed(1)} um`);
      expect(r.drift).toBeLessThan(1e-12); expect(r.minimum).toBeGreaterThanOrEqual(0);
    }
    const hard = { ...base, G: 50, bins: 104, phiScale: 50 };
    const coarse = productionBox(hard).final, fine = productionBox({ ...hard, dt: 0.0125 }).final;
    lines.push(`  step check, the densest case (phi x50, G 50): dt 0.05 / 0.0125  N ${coarse.N.toFixed(5)} / ${fine.N.toFixed(5)}  mass>10um ${coarse.above10.toFixed(4)} / ${fine.above10.toFixed(4)}  r_largest ${coarse.rLargestUm.toFixed(1)} / ${fine.rLargestUm.toFixed(1)} um`);
    console.log(lines.join('\n'));
    expect(largest).toBeGreaterThan(0);
  }, 600000);

  it('prints ms per collide call for practical section counts (late-time size distribution copied into every wet cell)', () => {
    const lines: string[] = ['COLLIDE COST (ms per 50 ms step, one thread, all wet cells hold the same distribution)'];
    for (const [label, nx, ny] of [['LOW', 12, 24], ['HIGH', 16, 32]] as const) for (const bins of [13, 26, 52, 104]) {
      const m = new LiquidMask(nx, ny, nx, .007, 0, .0348); m.update(new THREE.Vector3(0, 1, 0), .0251);
      const p = new SectionalPopulation(m, CONFIG(), solidOf(0.2e-6), STAGE3_AGCL_SOLID_M3_PER_UNIT, { scheme: 'conservative', bins });
      const strain = new Float32Array(m.data.length).fill(2);
      const phi = STAGE3_AGCL_SOLID_M3_PER_UNIT / 2e-6, n0 = phi / solidOf(0.2e-6), cellM3 = 2e-6 / m.activeCount;
      // Evolve one cell for 22 s, then copy its distribution everywhere (late-time cost); also time the first steps.
      const one = productionBox({ ...base, G: 2, bins }).final;      // only to make sure this configuration runs
      expect(one.drift).toBeLessThan(1e-12);
      const single = mask(), cell = single.active[0], solo = new SectionalPopulation(single, CONFIG(), solidOf(0.2e-6),
        STAGE3_AGCL_SOLID_M3_PER_UNIT, { scheme: 'conservative', bins }), soloStrain = new Float32Array(single.data.length).fill(2);
      solo.masses[0][cell] = n0 * cellM3 * solo.particleMass[0];
      const early: number[] = [];
      const fill = () => { for (let a = 0; a < m.activeCount; a++) for (let b = 0; b < bins; b++) p.masses[b][m.active[a]] = solo.masses[b][cell]; };
      fill();
      for (let s = 0; s < 440; s++) {
        solo.collide(0.05, cellM3, soloStrain, 1);
        if (s === 19 || s === 219 || s === 439) {
          fill();
          const t0 = performance.now(); for (let k = 0; k < 3; k++) p.collide(0.05, cellM3, strain, 1); early.push((performance.now() - t0) / 3);
          fill();
        }
      }
      lines.push(`  ${label} (${m.activeCount} wet cells) ${String(bins).padStart(3)} sections: ${early.map(v => v.toFixed(1)).join(' / ')} ms at 1 s / 11 s / 22 s`);
    }
    console.log(lines.join('\n'));
  }, 600000);
});
