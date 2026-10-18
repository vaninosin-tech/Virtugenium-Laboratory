import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { nodeRadius } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';

const output = 'docs/night/wave18f3';
const shared = 'docs/night/wave16shared';
const samples = new Set([1, 2, 3, 4.5, 6, 9, 12, 14, 17, 20, 22]);
type Quality = 'LOW' | 'HIGH';
function replay(quality: Quality, budget: number, enabled: boolean, artifacts = false, tracer = false) {
  (globalThis as { __silverNodeBudget?: number; __silverAgg?: number }).__silverNodeBudget = budget;
  (globalThis as { __silverAgg?: number }).__silverAgg = enabled ? 1 : 0;
  const win = window as Window & { __silverDiag?: string };
  win.__silverDiag = tracer ? 'tracer' : '';
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
  const rows: Record<string, number>[] = [], history: unknown[] = [];
  const timings: number[] = [], cumulative: Record<string, number> = {};
  let maxError = 0, maxStoich = 0, maxNodes = 0, lowerTracerOnset: number | null = null;
  const heapStart = process.memoryUsage().heapUsed;
  try {
    for (let k = 0; k < 440; k++) {
      const t = (k + 1) * .05, delivery = Math.min(1, (k + 1) * .04);
      const level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
      f.mask.update(up, level);
      let top = -Infinity;
      for (let a = 0; a < f.mask.activeCount; a++) {
        const i = f.mask.active[a], p = f.mask.point(i % f.mask.nx,
          Math.floor(i / f.mask.nx) % f.mask.ny, Math.floor(i / (f.mask.nx * f.mask.ny)));
        if (Math.hypot(p.x - inlet.x, p.z) <= .003) top = Math.max(top, p.y);
      }
      inlet.y = top;
      const start = performance.now();
      f.advance(.05, up, level, inlet, delivery, 0, delivery > f.delivered ? .4 : 0);
      timings.push(performance.now() - start);
      const sections = f.sections.massByClass();
      const sectionMass = sections.reduce((s, x) => s + x, 0);
      const flocMass = f.flocSystem.nodes.reduce((s, n) => s + n.mass, 0);
      const transfer: Record<string, number> = { ...f.transferStep };
      for (let b = 0; b < f.sections.transfers.length; b++) transfer[`sectionToSection${b}`] = f.sections.transfers[b];
      for (const [name, amount] of Object.entries(transfer)) cumulative[name] = (cumulative[name] ?? 0) + amount;
      const flow = f.solver.flow; let velocity2 = 0, lowerTracer = 0, totalTracer = 0, lowerCells = 0;
      for (let a = 0; a < f.mask.activeCount; a++) {
        const i = f.mask.active[a], y = Math.floor(i / f.mask.nx) % f.mask.ny;
        velocity2 += flow[i * 3] ** 2 + flow[i * 3 + 1] ** 2 + flow[i * 3 + 2] ** 2;
        totalTracer += f.tracer[i];
        if (f.mask.bottom + (y + .5) * f.mask.height / f.mask.ny < level / 3) {
          lowerTracer += f.tracer[i]; lowerCells++;
        }
      }
      const lowerTracerRatio = totalTracer > 0 && lowerCells > 0
        ? (lowerTracer / lowerCells) / (totalTracer / f.mask.activeCount) : 0;
      if (tracer && lowerTracerOnset === null && lowerTracerRatio > .01) lowerTracerOnset = t;
      const row: Record<string, number> = {
        t, extent: f.extent, fine: f.suspensionMass + f.coarseMass, sectionMass, flocMass,
        aggregate: sectionMass + flocMass, sediment: f.sedimentMass, nodes: f.flocSystem.nodes.length,
        sedimentPorosity: f.sedimentField.porosity,
        sedimentBowlFillMm: f.sedimentField.equivalentFillHeight * 1000,
        lowerTracerRatio, rmsVelocity: Math.sqrt(velocity2 / f.mask.activeCount),
        maxHeightMm: Math.max(...f.sedimentHeightPixels) * 1000,
        ...Object.fromEntries(sections.map((x, i) => [`section${i}`, x])),
        ...Object.fromEntries(Object.entries(transfer).flatMap(([name, amount]) =>
          [[`${name}Rate`, amount / .05], [`${name}Cumulative`, cumulative[name]]])),
      };
      rows.push(row);
      maxError = Math.max(maxError, Math.abs(f.massBalanceError));
      maxStoich = Math.max(maxStoich, Math.abs(f.species['Ag+'].total + f.extent - f.silverAmount),
        Math.abs(f.species['Cl-'].total + f.extent - f.delivered));
      maxNodes = Math.max(maxNodes, f.flocSystem.nodes.length);
      if (samples.has(t)) {
        const bins = [0, 0, 0, 0], masses = [0, 0, 0, 0];
        for (const node of f.flocSystem.nodes) {
          const r = nodeRadius(node.mass, f.flocSystem.config);
          const b = r < .0005 ? 0 : r < .001 ? 1 : r < .002 ? 2 : 3;
          bins[b]++; masses[b] += node.mass;
        }
        const largest = f.visibleFlocs.reduce((best, x) => x.mass > best.mass ? x : best,
          { mass: 0, bounds: [0, 0, 0], radiusOfGyration: 0, nodeIds: [] });
        history.push({ ...row, bins, masses, largest,
          lowerTracerFraction: totalTracer > 0 ? lowerTracer / totalTracer : 0,
          fineOpticalDepth: 16 * (f.suspensionMass + f.coarseMass) });
        if (artifacts) {
          const label = String(t).replace('.', '_');
          writeFileSync(`${shared}/wave18_state_${label}s.json`, JSON.stringify(f.dumpAggregateState()));
        }
      }
    }
    timings.sort((a, b) => a - b);
    if (artifacts) {
      const keys = Object.keys(rows[0]);
      writeFileSync(`${output}/${quality.toLowerCase()}-50ms.csv`,
        [keys.join(','), ...rows.map(r => keys.map(key => r[key]).join(','))].join('\n') + '\n');
    }
    return { quality, budget, enabled, tracer, silverAmount: f.silverAmount, grid: [f.mask.nx, f.mask.ny, f.mask.nz],
      maxError, maxStoich, maxNodes, lowerTracerOnset, history,
      cpuMs: { p50: timings[Math.floor(timings.length * .5)], p95: timings[Math.floor(timings.length * .95)], peak: timings.at(-1) },
      heapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
      sectionBytes: f.sections.masses.reduce((s, x) => s + x.byteLength, 0),
      textureBytes: f.aggregatePixels.byteLength + f.sedimentHeightPixels.byteLength };
  } finally { f.dispose(); delete win.__silverDiag; }
}

describe('wave 18 deterministic physical replay', () => {
  it('records 50 ms conservation, population, budget, optics and tracer diagnostics', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    mkdirSync(output, { recursive: true }); mkdirSync(shared, { recursive: true });
    try {
      const low = replay('LOW', 260, true, true), high = replay('HIGH', 260, true, true);
      const budgets = [130, 520].map(b => replay('LOW', b, true));
      const off = replay('LOW', 260, false);
      const highOff = replay('HIGH', 260, false);
      const tracer = replay('LOW', 260, false, false, true);
      const result = { low, high, budgets, off, highOff, tracer };
      writeFileSync(`${output}/replay.json`, JSON.stringify(result, null, 2));
      for (const r of [low, high, ...budgets, off, highOff, tracer]) {
        expect(r.maxError).toBeLessThan(1e-12);
        expect(r.maxStoich).toBeLessThan(1e-12);
        expect(r.maxNodes).toBeLessThanOrEqual(r.budget);
      }
      for (const r of budgets) {
        expect(Math.abs(r.history.at(-1)!.aggregate - low.history.at(-1)!.aggregate)).toBeLessThan(.02);
        expect(Math.abs(r.history.at(-1)!.sediment - low.history.at(-1)!.sediment)).toBeLessThan(.02);
      }
    } finally {
      delete (globalThis as { __silverNodeBudget?: number }).__silverNodeBudget;
      delete (globalThis as { __silverAgg?: number }).__silverAgg;
      vi.unstubAllGlobals();
    }
  }, 300000);
});
