import { describe, expect, it } from 'vitest';
import { EXCESS_KG_PER_MOL, densityParts, REFERENCE_DENSITY, GRAVITY } from '../../../src/scenes/laboratory/lib/tubeBuoyancy';

// Mass accounting of the net density model: AgNO3 + NaCl -> AgCl + NaNO3, each species counted once (mol/m3 in, kg/m3 out).
describe('density accounting', () => {
  it('the reaction inside a parcel is almost density neutral (contraction only)', () => {
    const before = densityParts(100, 50, 0, 0), reacted = 30;
    const after = densityParts(100 - reacted, 50 - reacted, reacted, reacted);
    const delta = after.total - before.total;
    const perMol = EXCESS_KG_PER_MOL.agcl + EXCESS_KG_PER_MOL.nano3 - EXCESS_KG_PER_MOL.agno3 - EXCESS_KG_PER_MOL.nacl;
    expect(delta).toBeCloseTo(perMol * reacted, 12);
    const removed = reacted * (EXCESS_KG_PER_MOL.agno3 + EXCESS_KG_PER_MOL.nacl);
    expect(Math.abs(delta) / removed).toBeLessThan(0.06);               // below 6 percent of the reagent excess that was converted
  });
  it('the dissolved product NaNO3 and the solid both enter; omitting either breaks the neutrality', () => {
    const full = densityParts(70, 20, 30, 30).total, noProduct = densityParts(70, 20, 0, 30).total, noSolid = densityParts(70, 20, 30, 0).total;
    const before = densityParts(100, 50, 0, 0).total;
    expect(Math.abs(full - before)).toBeLessThan(0.06 * 30 * (EXCESS_KG_PER_MOL.agno3 + EXCESS_KG_PER_MOL.nacl));
    expect(Math.abs(noProduct - before)).toBeGreaterThan(5 * Math.abs(full - before));
    expect(Math.abs(noSolid - before)).toBeGreaterThan(5 * Math.abs(full - before));
  });
  it('solid and dissolved terms use partial molar volumes: per mole the AgCl excess is M - rho_w V_phi', () => {
    expect(EXCESS_KG_PER_MOL.agcl).toBeCloseTo(0.14332 - 997 * 25.8e-6, 12);
    // Cross-check with particle displacement: (rho_s - rho_w) V per mole of solid, rho_s = 5560 (same value within 1 percent).
    expect(Math.abs(EXCESS_KG_PER_MOL.agcl - (5560 - 997) * 0.14332 / 5560)).toBeLessThan(0.002);
  });
  it('literature check: 0.1 mol/L solutions against tabulated densities (within about 1.5 kg/m3)', () => {
    // 0.1 mol/L AgNO3 about 1.011 g/mL, NaCl about 1.0035 g/mL (20 C, relative to 0.9982 water: excess 5.3), NaNO3 about 1.0045.
    expect(Math.abs(100 * EXCESS_KG_PER_MOL.agno3 - 14.0)).toBeLessThan(1.5);
    expect(Math.abs(100 * EXCESS_KG_PER_MOL.nacl - 5.3)).toBeLessThan(1.5);
    expect(Math.abs(100 * EXCESS_KG_PER_MOL.nano3 - 6.3)).toBeLessThan(1.5);
  });
  it('origin of the factor of about 100: tuned incoming-solution buoyancy against the physical contrast', () => {
    // Acceleration of a cell per unit of mean-cell tracer: tuned = buoyancy (0.1, load units) x loadStrength (0.005 m/s2). Physical:
    // g (rho_NaCl_solution - rho_AgNO3_solution) / rho0 x (incoming volume / liquid volume).
    const tuned = 0.1 * 0.005, contrast = 100 * (EXCESS_KG_PER_MOL.nacl - EXCESS_KG_PER_MOL.agno3);
    const rows = [[1, 1], [2.5, 1]].map(([ag, cl]) => { const physical = GRAVITY * Math.abs(contrast) / REFERENCE_DENSITY * cl / (ag + cl); return { ag, cl, physical, ratio: physical / tuned }; });
    console.log('buoyancy per unit tracer, tuned ' + (tuned * 1000).toFixed(2) + ' mm/s2; physical ' + rows.map(r => `${r.ag}+${r.cl} mL: ${(r.physical * 1000).toFixed(1)} mm/s2 (x${r.ratio.toFixed(0)})`).join(', '));
    expect(rows[0].ratio).toBeGreaterThan(80); expect(rows[0].ratio).toBeLessThan(120);       // the old 1 + 1 mL scenario: about 100
    expect(rows[1].ratio).toBeGreaterThan(40); expect(rows[1].ratio).toBeLessThan(80);        // the accepted 2.5 + 1 mL scenario: about 55
  });
});
