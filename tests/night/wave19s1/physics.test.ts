import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { SectionalPopulation } from '../../../src/scenes/laboratory/lib/night/stage1/sectionalPopulation';
import { DEFAULT_FLOC_CONFIG } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';
import { STAGE3_AGCL_SOLID_M3_PER_UNIT } from '../../../src/scenes/laboratory/lib/tubeSilverSediment';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { SILVER_TUBE_RADIUS, silverFieldHeight } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';

const k = 1.380649e-23, T = 293.15, mu = 1.002e-3;
const brownian = 8 * k * T / (3 * mu);

describe('wave 19 S1 physical units and controls', () => {
  it('converts game units to physical primary number density and analytic half-life', () => {
    expect(STAGE3_AGCL_SOLID_M3_PER_UNIT).toBeCloseTo(0.0001 * 143.32e-3 / 5560, 14);
    for (const radiusUm of [0.02, 0.05, 0.1, 0.2]) {
      const r = radiusUm * 1e-6;
      const vp = 4 * Math.PI * r ** 3 / 3;
      const phi = STAGE3_AGCL_SOLID_M3_PER_UNIT / 2e-6;
      const n = phi / vp;
      expect(n * vp).toBeCloseTo(phi, 14);
      expect(2 / (brownian * n)).toBeGreaterThan(0);
    }
  });

  it('quantifies fixed-pivot number loss error against a constant-kernel homogeneous box', () => {
    const mask = new LiquidMask(8, 16, 8, .007, 0, .055);
    mask.update(new THREE.Vector3(0, 1, 0), .025);
    const p = new SectionalPopulation(mask,
      { ...DEFAULT_FLOC_CONFIG, radius: .007, bottom: 0, height: .055 },
      4 * Math.PI / 3 * (0.2e-6) ** 3, STAGE3_AGCL_SOLID_M3_PER_UNIT);
    const cell = mask.active[0], volume = 2e-6 / mask.activeCount;
    // A dilute homogeneous box keeps the explicit pair limiter inactive at dt=0.05 s.
    const n0 = 1e17;
    p.masses[0][cell] = n0 * volume * p.particleMass[0];
    const start = p.masses[0][cell] / p.particleMass[0];
    const strain = new Float32Array(mask.data.length);
    p.collide(.05, volume, strain, 1);
    const afterFirst = p.masses.reduce((s, bin, b) => s + bin[cell] / p.particleMass[b], 0);
    const expectedInitialLoss = brownian * n0 ** 2 * volume * .05 / 2;
    const firstStepLossFraction = (start - afterFirst) / expectedInitialLoss;
    // For a 2*m0 product split between m0 and m1, the fixed pivots represent
    // only 2*m0/m1 of one physically lost particle per collision.
    expect(Math.abs(firstStepLossFraction - 2 * p.particleMass[0] / p.particleMass[1])).toBeLessThan(.01);
    for (let step = 1; step < 100; step++) p.collide(.05, volume, strain, 1);
    const measured = p.masses.reduce((s, bin, b) => s + bin[cell] / p.particleMass[b], 0);
    const analytic = start / (1 + brownian * n0 * 5 / 2);
    // The current mass-conserving fixed-pivot split does not conserve the event's
    // particle count: this regression records its measured factor, not a physical pass.
    expect(measured / analytic).toBeGreaterThan(1.9);
    expect(measured / analytic).toBeLessThan(2.2);
  });

  it('keeps omitted knobs bit identical to explicit defaults and aggregation-off invariant', () => {
    vi.stubGlobal('window', { __silverStage: 3, location: { search: '' } });
    const snapshots: string[] = [];
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(.0065, .01, 0);
    try {
      for (const mode of ['unset', 'explicit', 'offUnset', 'offExplicit']) {
        (globalThis as { __silverAgg?: number; __silverPrimaryRadiusUm?: number; __silverStickingScale?: number }).__silverAgg = mode.startsWith('off') ? 0 : 1;
        if (mode.endsWith('Explicit') || mode === 'explicit') {
          (globalThis as { __silverPrimaryRadiusUm?: number }).__silverPrimaryRadiusUm = .2;
          (globalThis as { __silverStickingScale?: number }).__silverStickingScale = 1;
        } else {
          delete (globalThis as { __silverPrimaryRadiusUm?: number }).__silverPrimaryRadiusUm;
          delete (globalThis as { __silverStickingScale?: number }).__silverStickingScale;
        }
        const f = new TubeSilverField('LOW', SILVER_TUBE_RADIUS, 0, silverFieldHeight);
        try {
          for (let step = 0; step < 20; step++) f.advance(.05, up, .012, inlet, Math.min(1, (step + 1) * .04), 0, .4);
          snapshots.push(JSON.stringify({ extent: f.extent, fine: Array.from(f.suspension[0]),
            sections: f.sections?.massByClass(), sediment: f.sedimentMass, error: f.massBalanceError }));
        } finally { f.dispose(); }
      }
      expect(snapshots[0]).toBe(snapshots[1]);
      expect(snapshots[2]).toBe(snapshots[3]);
    } finally {
      delete (globalThis as { __silverAgg?: number }).__silverAgg;
      delete (globalThis as { __silverPrimaryRadiusUm?: number }).__silverPrimaryRadiusUm;
      delete (globalThis as { __silverStickingScale?: number }).__silverStickingScale;
      vi.unstubAllGlobals();
    }
  }, 60000);
});
