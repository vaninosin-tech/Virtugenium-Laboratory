import { describe, expect, it } from 'vitest';
import { MesoCloud, type MesoMask } from '../../../src/scenes/laboratory/lib/night/meso/mesoCloud';
import { analyseCloud, diffTopology } from '../../../src/scenes/laboratory/lib/night/meso/cloudTopology';

const NX = 24, NY = 12, NZ = 12, H = 1e-3;
function mask(): MesoMask {
  const data = new Uint8Array(NX * NY * NZ).fill(1);
  return { nx: NX, ny: NY, nz: NZ, data, active: Int32Array.from(data.keys()), activeCount: data.length };
}
/** Two spherical lobes joined by a straight neck of the given square half-width (cells); neck = 0 gives two separate lobes. */
function dumbbell(cloud: MesoCloud, neckHalf: number) {
  cloud.values.fill(0);
  const cy = 6, cz = 6, centres = [6, 17];
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = cloud.index(x, y, z);
    for (const cx of centres) if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= 16) cloud.values[i] = 1;
    if (neckHalf > 0 && x >= 6 && x <= 17 && Math.abs(y - cy) < neckHalf && Math.abs(z - cz) < neckHalf) cloud.values[i] = Math.max(cloud.values[i], 0.6);
  }
}
const options = { densityScale: 1, cellSize: H, cellVolume: H ** 3 };

describe('cloud topology diagnostics', () => {
  it('one connected region with two lobes and a measured neck; the neck width follows the geometry', () => {
    const cloud = new MesoCloud(mask(), 1);
    for (const half of [1, 2, 3]) {
      dumbbell(cloud, half);
      const [report] = analyseCloud(cloud, [0.3], options);
      expect(report.count).toBe(1);
      expect(report.regions[0].lobes).toBe(2);
      const width = report.regions[0].neckWidth!;
      // The neck is a (2 half - 1)-cell square bar: its inscribed radius is about (2 half - 1)/2 cells + 1/2.
      expect(width / H).toBeGreaterThan(2 * half - 1.5);
      expect(width / H).toBeLessThan(2 * half + 1.5);
      expect(report.regions[0].mass).toBeCloseTo(cloud.mass, 9);
      expect(report.regions[0].volume).toBeCloseTo(report.regions[0].cells * H ** 3, 18);
    }
  });
  it('separated lobes are two regions with no neck; the connection at a higher threshold disappears first', () => {
    const cloud = new MesoCloud(mask(), 1);
    dumbbell(cloud, 1);
    const reports = analyseCloud(cloud, [0.3, 0.8], options);
    expect(reports[0].count).toBe(1);              // the 0.6 bridge is above 0.3
    expect(reports[1].count).toBe(2);              // and below 0.8: two regions at the higher threshold
    dumbbell(cloud, 0);
    expect(analyseCloud(cloud, [0.3], options)[0].count).toBe(2);
  });
  it('a split is detected from the change of the concentration structure, with the neck width before it', () => {
    const cloud = new MesoCloud(mask(), 1), diffusion = 1e-4;
    dumbbell(cloud, 2);
    const before = analyseCloud(cloud, [0.3], options)[0];
    dumbbell(cloud, 0);
    const after = analyseCloud(cloud, [0.3], options)[0];
    const events = diffTopology(1, 0.3, before, after, diffusion);
    const split = events.find(e => e.type === 'split')!;
    expect(split).toBeDefined();
    expect(split.children.length).toBe(2);
    expect(split.neckBefore!).toBeGreaterThan(0);
    expect(split.neckBefore! > diffusion).toBe(true);     // the neck was wider than the diffusion length: removed by transport, not by mixing
    expect(diffTopology(2, 0.3, after, before, diffusion).some(e => e.type === 'merge')).toBe(true);
  });
  it('two identical snapshots give no events', () => {
    const cloud = new MesoCloud(mask(), 1);
    dumbbell(cloud, 2);
    const a = analyseCloud(cloud, [0.3], options)[0], b = analyseCloud(cloud, [0.3], options)[0];
    expect(diffTopology(1, 0.3, a, b, 1e-4)).toEqual([]);
  });
});

describe('MesoCloud active region', () => {
  function drift(refine: number, everything: boolean) {
    const data = new Uint8Array(NX * NY * NZ).fill(1), mk: MesoMask = { nx: NX, ny: NY, nz: NZ, data, active: Int32Array.from(data.keys()), activeCount: data.length };
    const cloud = new MesoCloud(mk, refine); if (everything) cloud.activeFloor = -1;
    const amounts = new Float64Array(data.length);
    for (let z = 5; z < 8; z++) for (let y = 5; y < 8; y++) for (let x = 2; x < 5; x++) amounts[(z * NY + y) * NX + x] = 0.1;
    cloud.addFromCoarse(amounts);
    const u = new Float32Array(data.length).fill(0.004), zero = new Float32Array(data.length);
    for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) u[(z * NY + y) * NX + NX - 1] = 0;
    return { cloud, faces: [u, zero, zero] };
  }
  it('moves with a drifting cloud, loses and creates no mass, and does not clip the leaving edge', () => {
    const { cloud, faces } = drift(2, false), m0 = cloud.mass;
    const centroid = () => { let s = 0, w = 0; for (let i = 0; i < cloud.cellCount; i++) { s += (i % cloud.nx) * cloud.values[i]; w += cloud.values[i]; } return s / w; };
    const c0 = centroid(); let blocksStart = 0, blocksEnd = 0;
    for (let n = 0; n < 200; n++) { const st = cloud.advect(faces, 0.05, [H, H, H], 0); if (n === 0) blocksStart = st.activeBlocks; blocksEnd = st.activeBlocks; }
    expect(Math.abs(cloud.mass - m0) / m0).toBeLessThan(1e-12);
    expect((centroid() - c0) / 2).toBeGreaterThan(8);                     // 4 mm/s x 10 s = 40 mm = 40 coarse cells but the wall stops it: it did travel
    expect(blocksEnd).toBeLessThan(cloud.mask.data.length);               // not the whole domain
    expect(blocksStart).toBeGreaterThan(0);
  });
  it('gives the same result as the full-domain computation (active region is exact up to the frozen dust)', () => {
    const a = drift(2, false), b = drift(2, true);
    for (let n = 0; n < 120; n++) { a.cloud.advect(a.faces, 0.05, [H, H, H], 1e-7); b.cloud.advect(b.faces, 0.05, [H, H, H], 1e-7); }
    let diff = 0; for (let i = 0; i < a.cloud.cellCount; i++) diff += Math.abs(a.cloud.values[i] - b.cloud.values[i]);
    expect(diff / a.cloud.mass).toBeLessThan(1e-9);
  });
  it('frozen mass below the floor stays in the cloud (counted, never deleted) and wakes up when a neighbour exports into it', () => {
    const { cloud, faces } = drift(2, false);
    const far = cloud.index(NX * 2 - 4, 3, 3); cloud.values[far] = 1e-20;       // dust far from the cloud, below the floor
    const m0 = cloud.mass;
    for (let n = 0; n < 20; n++) cloud.advect(faces, 0.05, [H, H, H], 0);
    expect(cloud.values[far]).toBe(1e-20);
    expect(Math.abs(cloud.mass - m0) / m0).toBeLessThan(1e-12);
  });
  it('subgrid mixing conserves mass and smooths a filament; more eddy gives a smoother field', () => {
    const run = (eta: number) => {
      const { cloud, faces } = drift(2, false);
      const eddy = new Float32Array(cloud.mask.data.length).fill(2e-6), m0 = cloud.mass;
      for (let n = 0; n < 100; n++) cloud.advect(faces, 0.05, [H, H, H], { base: 1e-9, coarseEddy: eddy, eta });
      let sq = 0; for (let i = 0; i < cloud.cellCount; i++) sq += cloud.values[i] ** 2;
      expect(Math.abs(cloud.mass - m0) / m0).toBeLessThan(1e-12);
      return sq;
    };
    expect(run(4)).toBeLessThan(run(0));                                   // diffusion lowers the sum of squares (peak sharpness)
  });
});
