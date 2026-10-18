import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { FlocSystem, nodeRadius, slipSpeed } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_RADIUS } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';

const output = 'docs/night/wave16shared';
function ppm(name: string, values: ArrayLike<number>, nx: number, ny: number, nz: number, stride: number, channel: number, scale: number) {
  const rgb = Buffer.alloc(nx * ny * 3), z = Math.floor(nz / 2);
  for (let row = 0; row < ny; row++) for (let x = 0; x < nx; x++) {
    const i = x + nx * ((ny - row - 1) + ny * z);
    const q = Math.round(255 * Math.max(0, Math.min(1, values[i * stride + channel] / scale)));
    rgb.fill(q, (row * nx + x) * 3, (row * nx + x) * 3 + 3);
  }
  writeFileSync(`${output}/${name}.ppm`, Buffer.concat([Buffer.from(`P6\n${nx} ${ny}\n255\n`), rgb]));
}
function replay(quality: 'LOW' | 'HIGH', enabled: boolean, seconds: number, artifacts: boolean) {
  (globalThis as any).__silverAgg = enabled ? 1 : 0;
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
  const rows: any[] = [], elapsed: number[] = [];
  let maxNodes = 0, maxError = 0, minimum = Infinity;
  for (let k = 0; k < seconds * 20; k++) {
    const t = (k + 1) * .05, delivery = Math.min(1, (k + 1) * .04);
    const level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
    f.mask.update(up, level);
    let top = -Infinity;
    for (let a = 0; a < f.mask.activeCount; a++) {
      const i = f.mask.active[a], p = f.mask.point(i % f.mask.nx, Math.floor(i / f.mask.nx) % f.mask.ny,
        Math.floor(i / (f.mask.nx * f.mask.ny)));
      if (Math.hypot(p.x - inlet.x, p.z) <= .003) top = Math.max(top, p.y);
    }
    inlet.y = top;
    const start = performance.now();
    f.advance(.05, up, level, inlet, delivery, 0, delivery > f.delivered ? .4 : 0);
    elapsed.push(performance.now() - start);
    const fine = f.suspensionMass + f.coarseMass, aggregate = f.denseMass, sediment = f.sedimentMass;
    const error = Math.abs(fine + aggregate + sediment - f.extent);
    maxError = Math.max(maxError, error);
    maxNodes = Math.max(maxNodes, f.flocSystem?.nodes.length ?? 0);
    for (const s of f.suspension) for (let a = 0; a < f.mask.activeCount; a++) minimum = Math.min(minimum, s[f.mask.active[a]]);
    if ([20, 40, 60, 90, 120, 180, 240, 280].includes(k + 1)) {
      const nodes = f.flocSystem.nodes, config = f.flocSystem.config;
      const massBins = [0, 0, 0, 0], radiusBins = [0, 0, 0, 0];
      let meanSlip = 0, meanY = 0;
      for (const node of nodes) {
        const r = nodeRadius(node.mass, config);
        massBins[node.mass < .001 ? 0 : node.mass < .005 ? 1 : node.mass < .02 ? 2 : 3]++;
        radiusBins[r < .001 ? 0 : r < .002 ? 1 : r < .004 ? 2 : 3]++;
        meanSlip += slipSpeed(r, config); meanY += node.y;
      }
      rows.push({ t, extent: f.extent, fine, aggregate, sediment, nodes: nodes.length, error,
        transferredFromFine: (f.dumpAggregateState()).aggregationTransferred,
        massBins, radiusBins, meanSlip: meanSlip / (nodes.length || 1), meanY: meanY / (nodes.length || 1) });
      if (artifacts) {
        const d = f.dumpAggregateState(), [nx, ny, nz] = d.dimensions;
        writeFileSync(`${output}/state_${String(t).replace('.', '_')}s.json`, JSON.stringify(d));
        ppm(`fine_${t}s`, f.pixels, nx, ny, nz, 1, 0, 2);
        ppm(`aggregate_${t}s`, f.aggregatePixels, nx, ny, nz, 4, 0, 2);
        ppm(`looseness_${t}s`, f.aggregatePixels, nx, ny, nz, 4, 1, 1);
        const width = f.mask.nx, height = f.mask.nz, rgb = Buffer.alloc(width * height * 3);
        for (let i = 0; i < width * height; i++) {
          const q = Math.round(255 * Math.min(1, f.sedimentHeightPixels[i] / .005));
          rgb.fill(q, i * 3, i * 3 + 3);
        }
        writeFileSync(`${output}/sediment_${t}s.ppm`, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]));
      }
    }
  }
  const sorted = elapsed.slice().sort((a, b) => a - b);
  const result = { quality, enabled, rows, maxError, minimum, maxNodes,
    cpuMs: { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], peak: sorted.at(-1) },
    sedimentHeightMm: Math.max(...f.sedimentHeightPixels) * 1000,
    textureBytes: f.aggregatePixels.byteLength + f.sedimentHeightPixels.byteLength };
  f.dispose();
  return result;
}

describe('wave 16 conserved aggregation', () => {
  it('preserves mass across a rising mask, agitation, breakup switch, and aggregation switch', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
    const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
    let worst = 0;
    try {
      for (let k = 0; k < 100; k++) {
        (globalThis as any).__silverAgg = k >= 55 && k < 70 ? 0 : 1;
        (globalThis as any).__silverBreak = k >= 70 ? 1 : 0;
        const delivery = Math.min(1, (k + 1) * .02), level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
        f.mask.update(up, level);
        inlet.y = level - .001;
        f.advance(.05, up, level, inlet, delivery, k >= 80 ? .15 : 0, .4);
        worst = Math.max(worst, Math.abs(f.massBalanceError));
        expect(f.sedimentMass).toBeGreaterThanOrEqual(0);
      }
      expect(worst).toBeLessThan(1e-12);
      expect(f.flocSystem.nodes.length).toBeLessThanOrEqual(260);
    } finally {
      f.dispose(); delete (globalThis as any).__silverAgg; delete (globalThis as any).__silverBreak;
      vi.unstubAllGlobals();
    }
  }, 60000);

  it('measures displacement under real-pour velocity against a motionless carrier', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
    try {
      for (let k = 0; k < 40; k++) {
        const delivery = Math.min(1, (k + 1) * .04), level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
        f.mask.update(up, level); inlet.y = level - .001;
        f.advance(.05, up, level, inlet, delivery, 0, .4);
      }
      const config = { ...f.flocSystem.config, eddyDiffusivity: 0, allowBreakage: false };
      const moving = new FlocSystem(config), still = new FlocSystem(config);
      // The sectional model need not promote a visible node by 2 s. Probe the resolved
      // mechanics with a mass-derived 0.5 mm radius pair in the recorded carrier flow.
      const probeMass = config.quantum * (.0005 / config.quantumRadius) ** config.fractalDimension;
      const source = f.flocSystem.nodes.length >= 2 ? f.flocSystem.nodes.slice(0, 8) : [
        { x: 0, y: levelForProbe(), z: 0, mass: probeMass },
        { x: .001, y: levelForProbe(), z: 0, mass: probeMass },
      ];
      function levelForProbe() { return tubeLiquidHeight(2, silverEffectiveRadius) * .6; }
      for (const n of source) { moving.addMass(n.x, n.y, n.z, n.mass); still.addMass(n.x, n.y, n.z, n.mass); }
      const m = f.mask, flow = f.solver.flow;
      const sampled = (x: number, y: number, z: number, out: [number, number, number]) => {
        const ix = Math.max(0, Math.min(m.nx - 1, Math.floor((x + m.radius) * m.nx / (2 * m.radius))));
        const iy = Math.max(0, Math.min(m.ny - 1, Math.floor((y - m.bottom) * m.ny / m.height)));
        const iz = Math.max(0, Math.min(m.nz - 1, Math.floor((z + m.radius) * m.nz / (2 * m.radius))));
        const i = m.index(ix, iy, iz); out[0] = flow[3*i]; out[1] = flow[3*i+1]; out[2] = flow[3*i+2]; return !!m.data[i];
      };
      const quiet = (_x: number, _y: number, _z: number, out: [number, number, number]) => {
        out[0] = out[1] = out[2] = 0; return true;
      };
      for (let k = 0; k < 10; k++) { moving.step(.05, sampled); still.step(.05, quiet); }
      let displacement = 0;
      for (let i = 0; i < moving.nodes.length; i++) displacement += Math.hypot(
        moving.nodes[i].x - still.nodes[i].x, moving.nodes[i].y - still.nodes[i].y,
        moving.nodes[i].z - still.nodes[i].z);
      const metrics = { nodes: moving.nodes.length, relativeDisplacementMm: 1000 * displacement / moving.nodes.length,
        movingSpanMm: 1000 * Math.hypot(moving.nodes[0].x - moving.nodes.at(-1)!.x,
          moving.nodes[0].y - moving.nodes.at(-1)!.y, moving.nodes[0].z - moving.nodes.at(-1)!.z),
        stillSpanMm: 1000 * Math.hypot(still.nodes[0].x - still.nodes.at(-1)!.x,
          still.nodes[0].y - still.nodes.at(-1)!.y, still.nodes[0].z - still.nodes.at(-1)!.z) };
      mkdirSync('docs/night/wave16f1', { recursive: true });
      writeFileSync('docs/night/wave16f1/motion.json', JSON.stringify(metrics, null, 2));
      expect(metrics.relativeDisplacementMm).toBeGreaterThan(0);
    } finally { f.dispose(); vi.unstubAllGlobals(); }
  }, 60000);

  it('replays the real delivery, writes F2 dumps, and keeps every state nonnegative', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    mkdirSync(output, { recursive: true });
    try {
      const lowOn = replay('LOW', true, 14, true);
      const lowOff = replay('LOW', false, 6, false);
      const highOn = replay('HIGH', true, 6, false);
      const highOff = replay('HIGH', false, 6, false);
      writeFileSync(`${output}/mass-state.json`, JSON.stringify({ lowOn, lowOff, highOn, highOff }, null, 2));
      for (const run of [lowOn, lowOff, highOn, highOff]) {
        expect(run.maxError).toBeLessThan(1e-12);
        expect(run.minimum).toBeGreaterThanOrEqual(-1e-15);
        expect(run.maxNodes).toBeLessThanOrEqual(260);
      }
      expect(lowOn.rows.at(-1)!.aggregate).toBeGreaterThan(0);
      expect(lowOff.rows.at(-1)!.aggregate).toBe(0);
      // Wave 17 changes collisions, slip and contact merging. The wave 16 mass split is no longer a contract.
      expect(lowOn.rows.at(-1)!.sediment).toBeGreaterThan(0);
    } finally {
      delete (globalThis as any).__silverAgg;
      vi.unstubAllGlobals();
    }
  }, 180000);
});
