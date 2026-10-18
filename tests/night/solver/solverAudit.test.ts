import { describe, expect, it } from 'vitest';
import { GRIDS, LEVEL, R, divergence, kinetic, makeSolver, runBudget, seedVortex, step } from './harness';

// Audit of the staggered flow solver (TubeFlowSolver) with the density coupling: equilibrium, decay, stratification, overturning, energy
// budget, projection residual, boundary conditions, LOW/HIGH convergence. Energy is per unit reference density, volumes as the solver
// uses them (every wet cell is a full cell). Calibration results are printed; the assertions are the physical requirements.
const unstable = (_x: number, y: number) => (y > LEVEL / 2 ? 14 : 0);
const stable = (_x: number, y: number) => 14 * (1 - y / LEVEL);

describe('flow solver audit', () => {
  it('no forcing: kinetic energy decays monotonically at both grids, no spontaneous growth', () => {
    for (const grid of ['LOW', 'HIGH'] as const) {
      const { mask, solver, priv, dx, dy } = makeSolver(grid); seedVortex(mask, priv, 1e-5, dx, dy);
      const e0 = kinetic(mask, priv.flow); let prev = e0, grew = 0;
      for (let n = 0; n < 400; n++) { step(solver, 0.05); const e = kinetic(mask, priv.flow); if (e > prev * (1 + 1e-9)) grew++; prev = e; }
      expect(grew).toBe(0); expect(prev / e0).toBeLessThan(1e-4);
    }
  });
  it('uniform density is an exact equilibrium; a horizontally uniform stable stratification leaves only a tiny staircase-bottom residual', () => {
    for (const grid of ['LOW', 'HIGH'] as const) {
      const flat = runBudget(grid, 5, () => 5, 2e-7, { noEddy: true });
      let maxU = 0; for (let a = 0; a < flat.mask.activeCount; a++) { const i = flat.mask.active[a]; maxU = Math.max(maxU, Math.hypot(flat.priv.flow[3 * i], flat.priv.flow[3 * i + 1], flat.priv.flow[3 * i + 2])); }
      expect(maxU).toBeLessThan(1e-12);
      const strat = runBudget(grid, 20, stable, 2e-7, { noEddy: true });
      let u = 0; for (let a = 0; a < strat.mask.activeCount; a++) { const i = strat.mask.active[a]; u = Math.max(u, Math.hypot(strat.priv.flow[3 * i], strat.priv.flow[3 * i + 1], strat.priv.flow[3 * i + 2])); }
      expect(u).toBeLessThan(5e-4);                                           // measured 0.06 mm/s (LOW) and 0.21 mm/s (HIGH)
    }
  }, 300000);
  it('viscous momentum diffusion: the decay rate of a small flow follows the discrete Laplacian (rate difference between two viscosities)', () => {
    const rate = (nu: number) => {
      (globalThis as Record<string, unknown>).__silverViscosity = nu;
      const { mask, solver, priv, dx, dy } = makeSolver('LOW'); seedVortex(mask, priv, 1e-8, dx, dy);   // tiny amplitude: the upwind term is negligible
      const e0 = kinetic(mask, priv.flow); for (let n = 0; n < 40; n++) step(solver, 0.05);
      const e = kinetic(mask, priv.flow); delete (globalThis as Record<string, unknown>).__silverViscosity;
      return { rate: -Math.log(e / e0) / 2, mask, priv, dx, dy };
    };
    const a = rate(2e-7), b = rate(1e-6);
    // Predicted energy-rate difference 2 (nu2 - nu1) k2 with k2 = sum |grad u|^2 / sum |u|^2 of the seeded mode (Rayleigh quotient).
    const { mask, solver, priv, dx, dy } = makeSolver('LOW'); seedVortex(mask, priv, 1e-8, dx, dy);
    let num = 0, den = 0; const sp = [dx, dy, 2 * R / mask.nz];
    for (let k = 0; k < mask.activeCount; k++) { const i = mask.active[k]; den += priv.flow[3 * i] ** 2 + priv.flow[3 * i + 1] ** 2 + priv.flow[3 * i + 2] ** 2;
      for (let axis = 0; axis < 3; axis++) { const l = (priv as unknown as { adjacent: Int32Array[] }).adjacent[axis * 2][i], r = (priv as unknown as { adjacent: Int32Array[] }).adjacent[axis * 2 + 1][i]; if (l < 0 && r < 0) continue; const h = sp[axis] * (l >= 0 && r >= 0 ? 2 : 1);
        for (let c = 0; c < 3; c++) { const d = (priv.flow[3 * (r >= 0 ? r : i) + c] - priv.flow[3 * (l >= 0 ? l : i) + c]) / h; num += d * d; } } }
    void solver;
    const k2 = num / den, predicted = (1e-6 - 2e-7) * k2, measured = b.rate - a.rate;
    console.log(`viscous decay: rate 2e-7 ${a.rate.toFixed(3)}/s, 1e-6 ${b.rate.toFixed(3)}/s; difference ${measured.toFixed(3)} vs predicted nu k2 ${predicted.toFixed(3)} (k2 ${k2.toExponential(2)} 1/m2); Rayleigh damping alone 0.26/s`);
    expect(measured).toBeGreaterThan(0);
    expect(measured / predicted).toBeGreaterThan(0.5); expect(measured / predicted).toBeLessThan(2);
  });
  it('overturning: heavy over light releases potential energy that equals the buoyancy work; kinetic energy rises and then decays to zero; no injection (LOW and HIGH)', () => {
    const rows: Record<string, { peak: number; at: number; dpe: number; work: number; final: number; injection: number; courant: number }> = {};
    for (const grid of ['LOW', 'HIGH'] as const) for (const nu of [2e-7, 1e-6]) {
      const r = runBudget(grid, 20, unstable, nu, { noEddy: true }), b = r.budget;
      rows[`${grid} ${nu}`] = { peak: b.peakKe, at: b.peakKeAt, dpe: -(b.pe - b.pe0), work: b.work, final: b.ke, injection: b.ke + b.viscous + b.damping + (b.pe - b.pe0), courant: r.maxCourant };
      expect(Math.abs(b.work + (b.pe - b.pe0)) / Math.abs(b.pe - b.pe0)).toBeLessThan(0.15);   // buoyancy work equals the released potential energy
      expect(b.ke).toBeLessThan(1e-3 * b.peakKe);                                              // the motion dies after the overturn
      expect(b.ke + b.viscous + b.damping + (b.pe - b.pe0)).toBeLessThan(0);                   // the solver only dissipates: no energy from nowhere
      expect(r.maxCourant).toBeLessThanOrEqual(0.9 + 1e-6);                                    // scalar transport within its stability limit
    }
    console.log('overturn: ' + Object.entries(rows).map(([k, v]) => `${k}: peak KE ${v.peak.toExponential(2)} at ${v.at.toFixed(1)}s, released PE ${v.dpe.toExponential(2)}, work ${v.work.toExponential(2)}, final KE ${v.final.toExponential(1)}, max Courant ${v.courant.toFixed(2)}`).join(' | '));
    // Grid convergence of the released potential energy between LOW and HIGH.
    expect(Math.abs(rows['LOW 2e-7'].dpe - rows['HIGH 2e-7'].dpe) / rows['LOW 2e-7'].dpe).toBeLessThan(0.2);
  }, 300000);
  it('regression: without sub-stepping of the fast faces the HIGH overturn injects energy (scalar Courant above 4, work 30 times the released energy)', () => {
    // The sub-stepping is part of the solver step for the density coupling; here it is disabled on purpose to show the failure it prevents.
    const r = runBudget('HIGH', 8, unstable, 1e-6, { noEddy: true, disableFastFaces: true }), b = r.budget;
    expect(r.maxCourant).toBeGreaterThan(2);
    expect(b.work / Math.abs(b.pe - b.pe0)).toBeGreaterThan(5);
  }, 300000);
  it('pressure projection: the residual divergence falls with iterations; 6 iterations (the baseline default) cannot carry density forcing', () => {
    const out: Record<string, number> = {};
    for (const [grid, iterations] of [['LOW', 6], ['LOW', 120], ['HIGH', 120], ['HIGH', 400]] as const) {
      const r = runBudget(grid, 10, unstable, 2e-7, { noEddy: true, iterations });
      out[`${grid} ${iterations}`] = divergence(r.mask, r.priv, r.dx, r.dy, r.dz).max;
    }
    console.log('residual divergence max (1/s): ' + Object.entries(out).map(([k, v]) => `${k}: ${v.toExponential(1)}`).join(', '));
    expect(out['LOW 6']).toBeGreaterThan(out['LOW 120'] * 100);
    expect(out['LOW 120']).toBeLessThan(1e-3);
    expect(out['HIGH 400']).toBeLessThan(out['HIGH 120']);
  }, 300000);
  it('boundary conditions: no flux through the walls, the curved bottom or the rigid lid; tangential motion is free-slip (no wall friction in the discretisation)', () => {
    const r = runBudget('HIGH', 6, unstable, 1e-6, { noEddy: true });
    const adj = (r.priv as unknown as { adjacent: Int32Array[] }).adjacent;
    let leaked = 0, wallTangential = 0;
    for (let axis = 0; axis < 3; axis++) for (let a = 0; a < r.mask.activeCount; a++) { const i = r.mask.active[a]; if (adj[axis * 2 + 1][i] < 0) leaked = Math.max(leaked, Math.abs(r.priv.faces[axis][i])); }
    for (let a = 0; a < r.mask.activeCount; a++) { const i = r.mask.active[a]; if (adj[0][i] < 0 || adj[1][i] < 0) wallTangential = Math.max(wallTangential, Math.abs(r.priv.flow[3 * i + 1])); }
    expect(leaked).toBe(0);
    console.log(`faces towards a dry cell or the domain edge: max |u_n| ${leaked}; vertical velocity next to a side wall reached ${(wallTangential * 1000).toFixed(2)} mm/s (free-slip: not forced to zero)`);
    expect(GRIDS.HIGH[0]).toBe(16);
  }, 300000);
});
