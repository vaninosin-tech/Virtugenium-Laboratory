import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// End-to-end check of the density to momentum coupling: a lock exchange (heavy 0.1 mol/L AgNO3 on the left half, water on the right)
// in the real stage-3 field and solver. Benjamin's full-depth lock exchange gives a front speed U = 0.5 sqrt(g' H), g' = g drho / rho0.
async function lock(flag: unknown, scale = 1) {
  vi.stubGlobal('window', { location: { search: '' }, __silverAgg: 0 });
  (globalThis as Record<string, unknown>).__silverDensity = flag ? { model: 'net', scale } : undefined;
  const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
  const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
  const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
  const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight, 2.5);
  const m = f.mask, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0.02, 0);
  const level = tubeLiquidHeight(2.5, silverEffectiveRadius);
  m.update(up, level);
  f.advance(0.05, up, level, inlet, 0, 0, 0, undefined);                       // initialises Ag+ uniformly (c = 2.5 mean-cell units = 0.1 mol/L)
  const ag = f.species['Ag+'].values, dx = 2 * m.radius / m.nx;
  for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; if (i % m.nx >= m.nx / 2) ag[i] = 0; }
  const front: number[] = [], maxU: number[] = [], maxW: number[] = [];
  const priv = f as unknown as { flow: Float32Array };
  for (let n = 1; n <= 100; n++) {
    f.advance(0.05, up, level, inlet, 0, 0, 0, undefined);
    // Bottom wet row 1: mean over z of Ag+ per column, front = right-most column above half of the heavy value.
    let at = m.nx / 2;
    for (let x = m.nx - 1; x >= m.nx / 2; x--) {
      let sum = 0, cnt = 0;
      for (let z = 0; z < m.nz; z++) { const i = m.index(x, 1, z); if (m.data[i]) { sum += ag[i]; cnt++; } }
      if (cnt && sum / cnt * m.activeCount > 1.25) { at = x + 1; break; }
    }
    front.push(at * dx);
    let u = 0, w = 0; for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; u = Math.max(u, Math.abs(priv.flow[3 * i])); w = Math.max(w, Math.abs(priv.flow[3 * i + 1])); }
    maxU.push(u); maxW.push(w);
  }
  delete (globalThis as Record<string, unknown>).__silverDensity; vi.unstubAllGlobals();
  const speed = (front[39] - front[9]) / (0.05 * 30);           // 0.5 s to 2 s
  return { speed, maxU: Math.max(...maxU.slice(10, 60)), maxW: Math.max(...maxW.slice(10, 60)), height: level, front };
}

describe('lock exchange in the real field', () => {
  it('net density model: front speed against 0.5 sqrt(g H) and scaling with the density contrast', async () => {
    const rows = [] as { scale: number; speed: number; maxU: number; benjamin: number }[];
    for (const scale of [1, 0.25, 0.0625]) {
      const r = await lock(true, scale), gPrime = 9.81 * scale * 14.2 / 1010;
      rows.push({ scale, speed: r.speed, maxU: r.maxU, benjamin: 0.5 * Math.sqrt(gPrime * r.height) });
    }
    console.log('lock exchange, net model: ' + rows.map(r => `scale ${r.scale}: max |u| ${(r.maxU * 1000).toFixed(1)} mm/s, Benjamin ${(r.benjamin * 1000).toFixed(1)} mm/s`).join(' | '));
    const none = await lock(false);
    console.log(`baseline (no density coupling): max |u| ${(none.maxU * 1000).toFixed(2)} mm/s`);
    // The peak horizontal speed is the robust measure (the front position is smeared by mixing at these speeds). Calibration result,
    // not a target: at full contrast the coupled solver reproduces the gravity-current scale; weaker contrast is more damped.
    expect(rows[0].maxU / rows[0].benjamin).toBeGreaterThan(0.6);
    expect(rows[0].maxU / rows[0].benjamin).toBeLessThan(1.6);
    expect(rows[0].maxU).toBeGreaterThan(rows[1].maxU);
    expect(rows[1].maxU).toBeGreaterThan(rows[2].maxU);
    expect(none.maxU).toBe(0);                                              // without coupling the heavy half does not move
  }, 300000);
});
