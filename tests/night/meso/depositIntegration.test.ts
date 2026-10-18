import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ConsolidatingDeposit, DEFAULT_DEPOSIT } from '../../../src/scenes/laboratory/lib/night/meso/consolidatingDeposit';
import { SilverSedimentField, STAGE3_AGCL_SOLID_M3_PER_UNIT } from '../../../src/scenes/laboratory/lib/tubeSilverSediment';

const NX = 12, NZ = 12, R = 0.007, AREA = 4 * R * R / (NX * NZ);
function field() {
  const f = new SilverSedimentField(NX, NZ, STAGE3_AGCL_SOLID_M3_PER_UNIT);
  f.columnAreaM2 = AREA;
  f.attachBed(new ConsolidatingDeposit(NX, NZ, 12, { ...DEFAULT_DEPOSIT, cellArea: AREA, spacing: 2 * R / NX }, ConsolidatingDeposit.bowl(NX, NZ, R)), DEFAULT_DEPOSIT.rhoS, AREA);
  return f;
}

describe('consolidating bed behind the sediment ledger', () => {
  it('ledger equals the bed column masses; mass is conserved through deposit, compaction, creep and release', () => {
    const f = field(); let put = 0, released = 0;
    for (let k = 0; k < 60; k++) { const c = (k * 37) % (NX * NZ), a = 0.004 + 0.001 * (k % 5); f.deposit(c, a); put += a; }
    for (let s = 0; s < 4000; s++) {
      f.settleCurd(0.05);
      if (s % 700 === 0) released += f.release((s / 700 * 13) % (NX * NZ) | 0, 0.2);
    }
    expect(Math.abs(f.mass - (put - released))).toBeLessThan(1e-12);
    // Bulk volume follows from the solid mass, its density and the local void ratio: never below the solid volume itself.
    let bulk = 0; for (let c = 0; c < NX * NZ; c++) bulk += f.thicknessM(c) * AREA;
    expect(bulk).toBeGreaterThan(f.mass * STAGE3_AGCL_SOLID_M3_PER_UNIT);
  });
  it('mass deposited outside the vessel circle lands in the nearest valid column', () => {
    const f = field(); const corner = 0;                       // column (0,0) is outside the bowl
    f.deposit(corner, 0.1);
    expect(f.values[corner]).toBe(0);
    expect(f.mass).toBeCloseTo(0.1, 14);
  });
  it('material on the steep wall slides toward the centre along the rounded floor, solid mass unchanged', () => {
    const f = field(); const wall = 3 * NX + 1;                  // near the wall on the left, inside the circle
    expect(ConsolidatingDeposit.bowl(NX, NZ, R).valid[wall]).toBe(1);
    f.deposit(wall, 0.2);
    for (let s = 0; s < 20000; s++) f.settleCurd(0.05);
    expect(f.mass).toBeCloseTo(0.2, 12);
    expect(f.values[wall]).toBeLessThan(0.2);                    // moved off the slope
    expect(f.bedCreptKg).toBeGreaterThan(0);
  });
  it('compaction follows load, not time: a thin bed stays loose, a heavy column compacts more, solid mass is unchanged', () => {
    const f = field(); const light = 6 * NX + 6, heavy = 6 * NX + 5;
    f.deposit(light, 0.05); f.deposit(heavy, 5);
    const m0 = f.mass;
    for (let s = 0; s < 20000; s++) f.settleCurd(0.05);          // 1000 s
    expect(f.mass).toBeCloseTo(m0, 12);
    // Thickness per unit of mass is smaller where the load was larger (higher local effective stress).
    expect(f.thicknessM(heavy) / f.values[heavy]).toBeLessThan(f.thicknessM(light) / f.values[light]);
    expect(f.porosity).toBeGreaterThan(0.55);
  });
});

describe('stability and no premature compaction', () => {
  it('a vanishingly small deposit stays finite and non-negative through compaction and creep', () => {
    const f = field(); f.deposit(6 * NX + 6, 1e-15); f.deposit(5 * NX + 6, 3e-16);
    for (let s = 0; s < 4000; s++) f.settleCurd(0.05);
    for (let c = 0; c < NX * NZ; c++) { expect(Number.isFinite(f.thicknessM(c))).toBe(true); expect(f.thicknessM(c)).toBeGreaterThanOrEqual(0); expect(f.values[c]).toBeGreaterThanOrEqual(0); }
    expect(f.mass).toBeCloseTo(1.3e-15, 25);
  });
  it('fresh material stays loose: a thin bed has barely compacted after ten seconds and its porosity stays high after minutes', () => {
    const f = field(); const c = 6 * NX + 6; f.deposit(c, 0.04);              // about the load of the 180 s experiment per column
    const loose = f.porosity;
    for (let s = 0; s < 200; s++) f.settleCurd(0.05);                           // 10 s
    expect(f.porosity).toBeGreaterThan(loose - 0.01);
    for (let s = 0; s < 4000; s++) f.settleCurd(0.05);                          // another 200 s
    expect(f.porosity).toBeGreaterThan(0.85);                                  // load dependent: a sub-mm bed does not collapse to the old 0.55
  });
});

describe('field flag', () => {
  async function run(flag: unknown) {
    vi.stubGlobal('window', { location: { search: '' }, __silverAgg: 1 });
    (globalThis as Record<string, unknown>).__silverDeposit = flag;
    const { TubeSilverField } = await import('../../../src/scenes/laboratory/lib/tubeSilverField');
    const { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } = await import('../../../src/scenes/laboratory/lib/tubeSilverGeometry');
    const { tubeLiquidHeight } = await import('../../../src/scenes/laboratory/lib/tubeLiquidLevel');
    const { pouredMl } = await import('../../../src/scenes/laboratory/lib/tubePourImpact');
    const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight, 2.5);
    const m = f.mask, up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0.0065, 0, 0);
    let previous = 0, delivered = 0, ml = 2.5;
    for (let n = 0; n <= 1600; n++) {                              // 80 s
      const total = pouredMl(Math.min(1, n * 50 / 1700)), d = total - previous; let rate = 0;
      if (d > 1e-12) { previous = total; delivered += d; ml += d; rate = d * 20; }
      const level = tubeLiquidHeight(ml, silverEffectiveRadius);
      if (delivered <= 0) continue;
      m.update(up, level);
      let top = -Infinity;
      for (let a = 0; a < m.activeCount; a++) { const i = m.active[a]; const p = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny)));
        if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= 0.003 && p.y > top) top = p.y; }
      inlet.y = top;
      f.advance(0.05, up, level, inlet, Math.min(1, delivered), 0, rate, undefined);
    }
    const out = { error: f.massBalanceError, deposited: f.sedimentMass, bed: f.sedimentField.bedAttached, heights: Array.from(f.sedimentHeightPixels) };
    delete (globalThis as Record<string, unknown>).__silverDeposit; vi.unstubAllGlobals();
    return out;
  }
  it('with the flag the total mass balance still closes and thickness is non-negative; without it nothing is attached', async () => {
    const off = await run(undefined), on = await run(true);
    expect(off.bed).toBe(false); expect(on.bed).toBe(true);
    expect(Math.abs(on.error)).toBeLessThan(1e-12);
    expect(on.deposited).toBeGreaterThan(0.01);
    expect(Math.min(...on.heights)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(off.error)).toBeLessThan(1e-12);
  }, 300000);
});
