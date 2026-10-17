import { describe, expect, it } from "vitest";
import { marchSilverFine, SILVER_FINE_OPTICS, type SilverFineDump } from "../../../src/scenes/laboratory/lib/night/render/silverOpticsReference";

function uniform(value: number): SilverFineDump {
  return { nx: 12, ny: 24, nz: 12, radius: 0.007, bottom: 0, height: 0.055,
    mask: Array(12 * 24 * 12).fill(1), fine: Array(12 * 24 * 12).fill(value) };
}
function sample(value: number, mode: 0 | 1 | 2 | 3 = 0) {
  return marchSilverFine(uniform(value), [0, 0.03, 0.021], [0, 0, -1], mode);
}
describe("stage-3 fine AgCl optics reference", () => {
  it("gives a dense suspension a white, nearly opaque interior", () => {
    const [r, g, b, a] = sample(2);
    expect(Math.min(r, g, b)).toBeGreaterThan(0.9);
    expect(a).toBeGreaterThan(0.98);
  });
  it("keeps dilute suspensions translucent and alpha monotonic", () => {
    const values = [0, 0.001, 0.005, 0.02, 0.1].map(c => sample(c)[3]);
    expect(values[0]).toBe(0);
    expect(values[1]).toBeGreaterThan(0);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(values[2]).toBeLessThan(0.2);
  });
  it("scattering-only radiance rises, then saturates", () => {
    const composite = (c: number) => { const p = sample(c, 3); return p[0] * p[3]; };
    expect(composite(0.01)).toBeGreaterThan(composite(0));
    expect(composite(0.1)).toBeGreaterThan(composite(0.01));
    expect(composite(2)).toBeGreaterThan(composite(0.1));
    expect(composite(4) - composite(2)).toBeLessThan(0.1);
  });
  it("extinction-only attenuates to neutral grey", () => {
    const [r, g, b] = sample(0.3, 2);
    expect(r).toBeCloseTo(0.45, 4);
    expect(g).toBe(r);
    expect(b).toBe(r);
  });
  it("bounds radiance by the declared light and ambient budget", () => {
    const ceiling = SILVER_FINE_OPTICS.lightStrength + SILVER_FINE_OPTICS.ambient + SILVER_FINE_OPTICS.ambientBoost;
    for (const c of [0, 0.001, 0.01, 0.1, 1, 10]) {
      const p = sample(c);
      for (let k = 0; k < 3; k++) expect(p[k]).toBeLessThanOrEqual(ceiling + 1e-9);
    }
  });
  it("gives a zero concentration column zero alpha", () => {
    for (const mode of [0, 1, 2, 3] as const) expect(sample(0, mode)[3]).toBe(0);
  });
});
