import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { nodeRadius, nodeSolidFraction, slipSpeed } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_RADIUS } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';

const baseline = process.env.WAVE17_BASELINE === '1';
const root = baseline ? 'docs/night/wave17f1/baseline' : 'docs/night/wave17f1';
const dumpRoot = 'docs/night/wave16shared';
const samples = new Set([1, 2, 3, 4.5, 6, 9, 12, 14, 17, 20]);
const up = new THREE.Vector3(0, 1, 0);

function ppm(path: string, values: ArrayLike<number>, nx: number, ny: number, nz: number,
  stride: number, channel: number, scale: number) {
  const rgb = Buffer.alloc(nx * ny * 3), z = Math.floor(nz / 2);
  for (let row = 0; row < ny; row++) for (let x = 0; x < nx; x++) {
    const i = x + nx * ((ny - row - 1) + ny * z);
    const q = Math.round(255 * Math.max(0, Math.min(1, values[i * stride + channel] / scale)));
    rgb.fill(q, (row * nx + x) * 3, (row * nx + x) * 3 + 3);
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${nx} ${ny}\n255\n`), rgb]));
}

function run(quality: 'LOW' | 'HIGH', flowing: boolean, artifacts: boolean) {
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const inlet = new THREE.Vector3(.0065, 0, 0);
  const rows: Record<string, number>[] = [], history: unknown[] = [];
  const cumulative = { fineToAggregate: 0, aggregateToSediment: 0, aggregateToFine: 0,
    fineToSediment: 0, sedimentToFine: 0 };
  const timings: number[] = [];
  let maxNodes = 0, maxPending = 0, maxError = 0, maxStoichError = 0;
  try {
    for (let k = 0; k < 400; k++) {
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
      f.advance(.05, up, level, inlet, delivery, 0, flowing && delivery > f.delivered ? .4 : 0);
      const ms = performance.now() - start;
      timings.push(ms);
      for (const key of Object.keys(cumulative) as (keyof typeof cumulative)[])
        cumulative[key] += f.transferStep[key];
      const fine = f.suspensionMass + f.coarseMass, aggregate = f.denseMass, sediment = f.sedimentMass;
      const pending = f.flocSystem.pendingMass;
      maxNodes = Math.max(maxNodes, f.flocSystem.nodes.length);
      maxPending = Math.max(maxPending, pending);
      maxError = Math.max(maxError, Math.abs(f.massBalanceError));
      maxStoichError = Math.max(maxStoichError,
        Math.abs(f.species['Ag+'].total + f.extent - f.silverAmount),
        Math.abs(f.species['Cl-'].total + f.extent - f.delivered));
      const row = { t, extent: f.extent, fine, aggregate, sediment, pending,
        nodes: f.flocSystem.nodes.length, heightMm: Math.max(...f.sedimentHeightPixels) * 1000,
        bulkMl: f.sedimentMass * f.sedimentHeightScale * 1e6,
        ...Object.fromEntries(Object.entries(f.transferStep).flatMap(([name, amount]) =>
          [[`${name}Rate`, amount / .05], [`${name}Cumulative`, cumulative[name as keyof typeof cumulative]]])),
        ms, error: f.massBalanceError };
      rows.push(row as Record<string, number>);
      if (samples.has(t)) {
        const nodes = f.flocSystem.nodes, config = f.flocSystem.config;
        const bins = [0, 0, 0, 0], massBins = [0, 0, 0, 0];
        for (const node of nodes) {
          const r = nodeRadius(node.mass, config), b = r < .0005 ? 0 : r < .001 ? 1 : r < .002 ? 2 : 3;
          bins[b]++; massBins[b] += node.mass;
        }
        history.push({ ...row, bins, massBins,
          meanRadiusMm: nodes.reduce((s, n) => s + nodeRadius(n.mass, config), 0) / (nodes.length || 1) * 1000,
          meanSolidFraction: nodes.reduce((s, n) => s + nodeSolidFraction(nodeRadius(n.mass, config), config), 0) / (nodes.length || 1),
          meanSlipMmS: nodes.reduce((s, n) => s + slipSpeed(nodeRadius(n.mass, config), config), 0) / (nodes.length || 1) * 1000 });
        if (artifacts) {
          const d = f.dumpAggregateState(), [nx, ny, nz] = d.dimensions;
          const label = String(t).replace('.', '_');
          writeFileSync(`${dumpRoot}/state_${label}s.json`, JSON.stringify(d));
          ppm(`${dumpRoot}/fine_${t}s.ppm`, f.pixels, nx, ny, nz, 1, 0, 2);
          ppm(`${dumpRoot}/aggregate_${t}s.ppm`, f.aggregatePixels, nx, ny, nz, 4, 0, 2);
          ppm(`${dumpRoot}/looseness_${t}s.ppm`, f.aggregatePixels, nx, ny, nz, 4, 1, 1);
          const rgb = Buffer.alloc(nx * nz * 3);
          for (let i = 0; i < nx * nz; i++) rgb.fill(Math.round(255 * Math.min(1,
            f.sedimentHeightPixels[i] / .005)), i * 3, i * 3 + 3);
          writeFileSync(`${dumpRoot}/sediment_${t}s.ppm`,
            Buffer.concat([Buffer.from(`P6\n${nx} ${nz}\n255\n`), rgb]));
        }
      }
    }
    const keys = Object.keys(rows[0]);
    mkdirSync(root, { recursive: true });
    writeFileSync(`${root}/${quality.toLowerCase()}-${flowing ? 'pour' : 'still'}-transfers.csv`,
      [keys.join(','), ...rows.map(row => keys.map(key => row[key]).join(','))].join('\n') + '\n');
    timings.sort((a, b) => a - b);
    return { quality, flowing, history, maxNodes, maxPending, maxError, maxStoichError,
      cpuMs: { p50: timings[200], p95: timings[380], peak: timings[399] },
      textureBytes: f.aggregatePixels.byteLength + f.sedimentHeightPixels.byteLength };
  } finally { f.dispose(); }
}

describe('wave 17 transfer replay', () => {
  it('records 20 s real-pour transfers on LOW and HIGH grids', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    try {
      mkdirSync(root, { recursive: true });
      if (!baseline) mkdirSync(dumpRoot, { recursive: true });
      const low = run('LOW', true, !baseline), high = run('HIGH', true, false);
      const still = baseline ? undefined : run('LOW', false, false);
      writeFileSync(`${root}/replay.json`, JSON.stringify({ low, high, still }, null, 2));
      for (const result of [low, high, still].filter(x => x !== undefined)) {
        expect(result.maxError).toBeLessThan(1e-12);
        expect(result.maxStoichError).toBeLessThan(1e-12);
        expect(result.maxNodes).toBeLessThanOrEqual(260);
      }
    } finally { vi.unstubAllGlobals(); }
  }, 240000);
});
