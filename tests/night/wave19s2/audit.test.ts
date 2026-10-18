import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { SilverSedimentField, SilverSedimentGeometry, STAGE3_AGCL_SOLID_M3_PER_UNIT } from '../../../src/scenes/laboratory/lib/tubeSilverSediment';
import { tubeVessel } from '../../../src/scenes/laboratory/lib/vesselGeometry';
import { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { SectionalPopulation as Baseline } from './sectionalPopulationBaseline';
import { silverAggregateDumpFromState } from '../../../src/scenes/laboratory/lib/night/render/silverOpticsReference';

const radius = 0.007;
const massKgPerUnit = 0.1 * 0.001 * 0.14332;
const solidM3 = massKgPerUnit / 5560;
function shellThickness(volumeM3: number) {
  let lo = 0, hi = radius;
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (2 * Math.PI / 3 * ((radius + mid) ** 3 - radius ** 3) < volumeM3) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('wave 19 S2 independent volume audit', () => {
  it('reconciles SI mass, porosity and all three defined ideal geometries', () => {
    expect(Math.abs(STAGE3_AGCL_SOLID_M3_PER_UNIT / solidM3 - 1)).toBeLessThan(1e-9);
    for (const mass of [.0001, .001, .01, .1, 1]) for (const porosity of [.90, .80, .70, .55]) {
      const field = new SilverSedimentField(12, 12, solidM3);
      field.compaction = (.90 - porosity) / .35;
      field.deposit(12 * 6 + 6, mass);
      const bulk = mass * massKgPerUnit / 5560 / (1 - porosity);
      const uniform = bulk / (Math.PI * radius ** 2);
      const shell = shellThickness(bulk);
      const level = tubeVessel.heightFromVolume(bulk * 1e6);
      expect(Math.abs(field.bulkVolumeM3(mass) / bulk - 1)).toBeLessThan(1e-9);
      expect(Math.abs(tubeVessel.volumeFromHeight(level) * 1e-6 / bulk - 1)).toBeLessThan(1e-9);
      expect(shell).toBeGreaterThan(0);
      expect(uniform).toBeGreaterThan(0);
    }
    const lowMassMg = .006414 * massKgPerUnit * 1e6;
    expect(lowMassMg).toBeCloseTo(.091926, 5);
    const uniformMm = .006414 * solidM3 / .1 / (Math.PI * radius ** 2) * 1000;
    expect(uniformMm).toBeCloseTo(.001074, 5);
  });

  it('writes height texels in metres from conserved column mass', () => {
    vi.stubGlobal('window', { __silverStage: 3, __silverAgg: 1, location: { search: '' } });
    const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
    try {
      const column = Math.floor(f.mask.nx / 2) + f.mask.nx * Math.floor(f.mask.nz / 2);
      f.sedimentField.deposit(column, .006414);
      f.extent += .006414;
      const up = new THREE.Vector3(0, 1, 0);
      f.advance(.05, up, tubeLiquidHeight(2, silverEffectiveRadius), new THREE.Vector3(.0065, .014, 0), 0);
      const area = 4 * radius ** 2 / (f.mask.nx * f.mask.nz);
      const expected = f.sedimentField.values[column] * solidM3 / (1 - f.sedimentField.porosity) / area;
      expect(Math.abs(f.sedimentHeightPixels[column] / expected - 1)).toBeLessThan(1e-7);
    } finally { f.dispose(); vi.unstubAllGlobals(); }
  });
  it('uses physical column volume in both supplied texture and geometry fallback', () => {
    const field = new SilverSedimentField(12, 12, solidM3);
    field.deposit(6 + 6 * 12, .006414);
    const heights = new Float32Array(144);
    const columnArea = 4 * radius ** 2 / 144;
    for (let i = 0; i < heights.length; i++) heights[i] = field.bulkVolumeM3(field.values[i]) / columnArea;
    const texture = new THREE.DataTexture(heights, 12, 12, THREE.RedFormat, THREE.FloatType);
    const withTexture = new SilverSedimentGeometry(radius, 0);
    const fallback = new SilverSedimentGeometry(radius, 0);
    withTexture.update(field, texture); fallback.update(field);
    const a = (withTexture.getAttribute('sedimentThickness') as THREE.BufferAttribute).array as Float32Array;
    const b = (fallback.getAttribute('sedimentThickness') as THREE.BufferAttribute).array as Float32Array;
    expect(Math.max(...a)).toBeLessThan(.0002);
    expect(Math.max(...b)).toBeLessThan(.0002);
    expect(Math.max(...a)).toBeGreaterThan(0);
    expect(Math.max(...b)).toBeGreaterThan(0);
  });
});

function snapshots(quality: 'LOW' | 'HIGH', baseline: boolean) {
  vi.stubGlobal('window', { __silverStage: 3, __silverAgg: 1, location: { search: '' } });
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, 0, 0);
  const rows: number[][] = [];
  try {
    for (let k = 0; k < 200; k++) {
      const delivery = Math.min(1, (k + 1) * .04);
      const level = tubeLiquidHeight(1 + delivery, silverEffectiveRadius);
      f.mask.update(up, level);
      let top = -Infinity;
      for (let a = 0; a < f.mask.activeCount; a++) {
        const i = f.mask.active[a], p = f.mask.point(i % f.mask.nx,
          Math.floor(i / f.mask.nx) % f.mask.ny, Math.floor(i / (f.mask.nx * f.mask.ny)));
        if (Math.hypot(p.x - inlet.x, p.z) <= .003) top = Math.max(top, p.y);
      }
      inlet.y = top;
      f.advance(.05, up, level, inlet, delivery, 0, delivery > f.delivered ? .4 : 0);
      if (baseline && k === 0) {
        const original = f.sections;
        const old = new Baseline(f.mask, f.flocSystem.config, 4 * Math.PI / 3 * (.2e-6) ** 3, solidM3);
        for (let b = 0; b < 13; b++) old.masses[b].set(original.masses[b]);
        (f as unknown as { sections: Baseline }).sections = old;
      }
      if (k === 199) {
        const optical = silverAggregateDumpFromState(f.dumpAggregateState());
        for (let i = 0; i < f.pixels.length; i++) if (optical.fine[i] > 1e-6)
          expect(Math.abs(optical.fine[i] / f.pixels[i] - 1)).toBeLessThan(1e-7);
      }
      rows.push([...f.sections.massByClass(), f.suspensionMass + f.coarseMass,
        f.flocSystem.nodes.reduce((s, n) => s + n.mass, 0), f.sedimentMass, f.extent]);
    }
    return rows;
  } finally { f.dispose(); vi.unstubAllGlobals(); }
}

describe('sectional physics regression', () => {
  it.each(['LOW', 'HIGH'] as const)('matches the original 50 ms mass history on %s', quality => {
    const oldRows = snapshots(quality, true), newRows = snapshots(quality, false);
    let maxAbsolute = 0, maxRelative = 0;
    for (let k = 0; k < oldRows.length; k++) for (let b = 0; b < oldRows[k].length; b++) {
      const d = Math.abs(oldRows[k][b] - newRows[k][b]);
      maxAbsolute = Math.max(maxAbsolute, d);
      maxRelative = Math.max(maxRelative, d / Math.max(1e-12, Math.abs(oldRows[k][b])));
    }
    expect(maxAbsolute).toBeLessThan(1e-15);
    expect(maxRelative).toBeLessThan(1e-12);
  }, 180000);
});
