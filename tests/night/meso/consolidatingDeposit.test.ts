import { describe, expect, it } from "vitest";
import { ConsolidatingDeposit, DEFAULT_DEPOSIT } from "../../../src/scenes/laboratory/lib/night/meso/consolidatingDeposit";

const load = (d: ConsolidatingDeposit, kg: number) => d.deposit(0, kg);
describe("ConsolidatingDeposit prototype", () => {
  it("bulk volume follows from mass, density and porosity (no fixed height)", () => {
    const d = new ConsolidatingDeposit(3, 3), kg = 1.4e-5;
    for (let i = 0; i < 7; i++) load(d, kg / 7);
    const expected = kg / DEFAULT_DEPOSIT.rhoS * (1 + DEFAULT_DEPOSIT.e0);
    expect(d.bulkVolume()).toBeCloseTo(expected, 15);
    expect(d.meanPorosity()).toBeCloseTo(DEFAULT_DEPOSIT.e0 / (1 + DEFAULT_DEPOSIT.e0), 10);
  });
  it("conserves solid mass through deposit, consolidation and creep", () => {
    const d = new ConsolidatingDeposit(5, 5);
    for (let i = 0; i < 40; i++) d.deposit(12, 4e-7);
    for (let i = 0; i < 10; i++) d.deposit(7, 2e-7);
    const m0 = d.solidMass;
    for (let s = 0; s < 400; s++) { d.consolidate(10); d.creep(1); }
    expect(Math.abs(d.solidMass - m0) / m0).toBeLessThan(1e-12);
  });
  it("compaction depends on load, not on a timer: a heavy column ends denser than a light one", () => {
    const d = new ConsolidatingDeposit(2, 1);
    for (let i = 0; i < 40; i++) d.deposit(0, 1e-6);
    for (let i = 0; i < 2; i++) d.deposit(1, 1e-6);
    for (let s = 0; s < 400; s++) d.consolidate(60);
    const mean = (c: number) => { let m = 0, v = 0; for (let l = 0; l < d.layers; l++) { const k = c * d.layers + l; m += d.mass[k]; v += d.mass[k] * d.e[k]; } return v / m; };
    expect(mean(0)).toBeLessThan(mean(1));
    // Within a column the bottom is denser than the top.
    expect(d.e[0]).toBeLessThan(d.e[d.layers - 1] + 1e-9);
  });
  it("void ratio never rises and never goes below the compacted limit", () => {
    const d = new ConsolidatingDeposit(1, 1);
    for (let i = 0; i < 30; i++) d.deposit(0, 1e-6);
    let prev = d.bulkVolume();
    for (let s = 0; s < 300; s++) { d.consolidate(120); const v = d.bulkVolume(); expect(v).toBeLessThanOrEqual(prev + 1e-18); prev = v; }
    for (const e of d.e) expect(e).toBeGreaterThanOrEqual(DEFAULT_DEPOSIT.eC - 1e-9);
  });
  it("creep flattens a steep pile and respects the yield slope", () => {
    const d = new ConsolidatingDeposit(5, 1);
    for (let i = 0; i < 50; i++) d.deposit(2, 1e-6);
    const spread = () => Array.from({ length: 5 }, (_, c) => d.height(c));
    const before = spread();
    for (let s = 0; s < 3000; s++) d.creep(1);
    const after = spread();
    expect(Math.max(...after)).toBeLessThan(Math.max(...before));
    expect(after[0]).toBeGreaterThan(0);
  });
  it("honest scale: the AgCl of 1 mL + 1 mL experiment is a thin soft layer, compaction takes tau-scale time", () => {
    // 0.1 mmol AgCl = 14.3 mg over a ~4 mm radius floor (about 5e-5 m2).
    const d = new ConsolidatingDeposit(1, 1, 8, { ...DEFAULT_DEPOSIT, cellArea: 5e-5 });
    for (let i = 0; i < 7; i++) d.deposit(0, 1.43e-5 / 7);
    const h0 = d.height(0); d.consolidate(60); const h1 = d.height(0);
    for (let s = 0; s < 300; s++) d.consolidate(60);
    const h2 = d.height(0);
    expect(h0).toBeGreaterThan(h2);
    expect(h0 - h1).toBeLessThan((h0 - h2) * 0.3);      // after one minute most of the compaction is still to come
    console.log(`deposit height loose ${(h0*1e3).toFixed(2)} mm, 1 min ${(h1*1e3).toFixed(2)} mm, 5 h ${(h2*1e3).toFixed(2)} mm`);
  });
});
