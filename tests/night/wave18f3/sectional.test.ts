import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { SectionalPopulation } from '../../../src/scenes/laboratory/lib/night/stage1/sectionalPopulation';
import { DEFAULT_FLOC_CONFIG } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';
import { STAGE3_AGCL_SOLID_M3_PER_UNIT, SilverSedimentField } from '../../../src/scenes/laboratory/lib/tubeSilverSediment';
import { tubeVessel } from '../../../src/scenes/laboratory/lib/vesselGeometry';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';

const primaryVolume = 4 * Math.PI / 3 * (0.2e-6) ** 3;
function sections() {
  const mask = new LiquidMask(8, 16, 8, .007, 0, .055);
  mask.update(new THREE.Vector3(0, 1, 0), .025);
  const config = { ...DEFAULT_FLOC_CONFIG, radius: .007, bottom: 0, height: .055 };
  return new SectionalPopulation(mask, config, primaryVolume, STAGE3_AGCL_SOLID_M3_PER_UNIT);
}

describe('wave 18 sectional AgCl population', () => {
  it('conserves mass through fixed-pivot collisions and grows larger sections', () => {
    const p = sections(), i = p.mask.active[Math.floor(p.mask.activeCount / 2)];
    p.masses[0][i] = .01;
    const initial = p.totalMass;
    const strain = new Float32Array(p.mask.data.length);
    for (let k = 0; k < 100; k++) p.collide(.05, 1e-9, strain, .65);
    expect(p.totalMass).toBeCloseTo(initial, 12);
    expect(p.masses[1][i]).toBeGreaterThan(0);
    expect(p.massByClass().every(x => x >= -1e-15)).toBe(true);
  });

  it('advects and sediments each size independently without dropping overflow', () => {
    const p = sections(), m = p.mask, flow = new Float32Array(m.data.length * 3);
    let source = -1;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], y = Math.floor(i / m.nx) % m.ny;
      if (y === 5) { source = i; break; }
    }
    expect(source).toBeGreaterThan(0);
    p.masses[0][source] = .01; p.masses[11][source] = .01;
    const deposited = new Float64Array(m.nx * m.nz);
    for (let k = 0; k < 120; k++) p.transport(.05, flow, -1, (col, mass) => { deposited[col] += mass; });
    const total = p.totalMass + deposited.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(.02, 12);
    const center = (b: number) => {
      let numerator = 0, denominator = 0;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], y = Math.floor(i / m.nx) % m.ny;
        numerator += y * p.masses[b][i]; denominator += p.masses[b][i];
      }
      return numerator / denominator;
    };
    expect(center(11)).toBeLessThan(center(0));
  });

  it('converts the 0.1 mmol deposit to volume and bowl fill height without extra solid', () => {
    const sediment = new SilverSedimentField(12, 12, STAGE3_AGCL_SOLID_M3_PER_UNIT);
    sediment.settleCurd(20);
    expect(sediment.compaction).toBe(0);
    sediment.deposit(12 * 6 + 6, 1);
    expect(sediment.mass).toBe(1);
    expect(sediment.bulkVolumeM3(1)).toBeCloseTo(2.577697841726619e-8, 16);
    expect(tubeVessel.volumeFromHeight(sediment.equivalentFillHeight)).toBeCloseTo(.02577697841726619, 12);
    expect(sediment.equivalentFillHeight).toBeGreaterThan(.001);
    sediment.settleCurd(.05);
    expect(sediment.compaction).toBeGreaterThan(0);
  });

  it('uses equimolar stage-3 silver and checks the exact solid ledger every step', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
    const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
    try {
      expect(f.silverAmount).toBe(1);
      for (let k = 0; k < 40; k++) {
        const delivery = Math.min(1, (k + 1) * .04), level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
        f.mask.update(up, level); inlet.y = level - .001;
        f.advance(.05, up, level, inlet, delivery, 0, .4);
        f.assertMassInvariant();
        expect(Math.abs(f.species['Ag+'].total + f.extent - 1)).toBeLessThan(1e-12);
        expect(Math.abs(f.species['Cl-'].total + f.extent - f.delivered)).toBeLessThan(1e-12);
      }
    } finally { f.dispose(); vi.unstubAllGlobals(); }
  }, 60000);

  it('keeps promotion overflow in a moving section when the visual node budget is full', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    (globalThis as { __silverNodeBudget?: number }).__silverNodeBudget = 1;
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
    const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
    try {
      const level = tubeLiquidHeight(2, silverEffectiveRadius);
      f.advance(.05, up, level, inlet, 0);
      const wet = Array.from(f.mask.active.slice(0, f.mask.activeCount));
      const upper = wet.filter(i => Math.floor(i / f.mask.nx) % f.mask.ny >= 5);
      const first = upper[0], second = upper.at(-1)!;
      expect(first).not.toBe(second);
      f.sections.masses[11][first] = .002;
      f.sections.masses[11][second] = .002;
      f.extent += .004;
      f.advance(.05, up, level, inlet, 0);
      f.assertMassInvariant();
      expect(f.flocSystem.nodes.length).toBe(1);
      expect(f.sections.totalMass).toBeGreaterThan(0);
      const before = f.sections.totalMass;
      for (let k = 0; k < 10; k++) f.advance(.05, up, level, inlet, 0);
      f.assertMassInvariant();
      expect(f.sections.totalMass).toBeLessThanOrEqual(before + 1e-12);
      expect(f.denseMass + f.sedimentMass).toBeCloseTo(.004, 12);
    } finally {
      f.dispose(); delete (globalThis as { __silverNodeBudget?: number }).__silverNodeBudget;
      vi.unstubAllGlobals();
    }
  }, 60000);

  it('retains the 1.15 silver off-branch baseline and conserves a synthetic excess', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    (globalThis as { __silverAgg?: number }).__silverAgg = 0;
    const off = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
    const excess = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight, 1.15);
    try {
      expect(off.silverAmount).toBe(1.15); expect(excess.silverAmount).toBe(1.15);
      (globalThis as { __silverAgg?: number }).__silverAgg = 1;
      const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
      for (let k = 0; k < 40; k++) {
        const delivery = Math.min(1, (k + 1) * .04), level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
        excess.mask.update(up, level); inlet.y = level - .001;
        excess.advance(.05, up, level, inlet, delivery, 0, .4);
        excess.assertMassInvariant();
        expect(Math.abs(excess.species['Ag+'].total + excess.extent - 1.15)).toBeLessThan(1e-12);
        expect(Math.abs(excess.species['Cl-'].total + excess.extent - excess.delivered)).toBeLessThan(1e-12);
      }
    }
    finally { off.dispose(); excess.dispose(); delete (globalThis as { __silverAgg?: number }).__silverAgg; vi.unstubAllGlobals(); }
  }, 60000);
});
