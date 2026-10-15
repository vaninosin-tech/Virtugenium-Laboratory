import { describe, expect, it, vi } from "vitest";
import { clamp01, smoothThreshold, hash3, valueNoise, fractalNoise, cottonDensity } from "../../../src/scenes/laboratory/lib/night/stage1/density";
import { silverStage } from "../../../src/scenes/laboratory/lib/silverStage";

describe("stage-one cotton density mapping", () => {
  it.each([clamp01, (v: number) => smoothThreshold(v, 0, 1),
    (v: number) => hash3(v, v + 1, v + 2),
    (v: number) => valueNoise(v, v + 1, v + 2),
    (v: number) => fractalNoise(v, v + 1, v + 2),
    (v: number) => cottonDensity(v, 0.2, 0.4, 0.6)])
  ("is bounded, finite, and deterministic", fn => {
    for (const value of [-100, -1, 0, 0.05, 0.5, 1, 100, Infinity, NaN]) {
      const result = fn(value);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
      expect(Number.isFinite(result)).toBe(true);
      expect(fn(value)).toBe(result);
    }
  });
  it("never creates a solid where field mass is absent", () => {
    expect(cottonDensity(0, 0.2, 0.4, 0.6)).toBe(0);
    expect(cottonDensity(1, 0.2, 0.4, 0.6)).toBeGreaterThan(0.8);
    expect(smoothThreshold(0.5, 1, 1)).toBe(0);
  });
  it("keeps fine structure isotropic and caps deformation from transported coordinates", () => {
    const point = [0.37, 1.13, -0.41] as const;
    const base = cottonDensity(1, ...point);
    expect(cottonDensity(1, ...point, point[0] + 5, point[1] - 8, point[2] + 6))
      .toBe(cottonDensity(1, ...point, point[0] + 0.12, point[1] - 0.12, point[2] + 0.12));
    expect(Number.isFinite(base)).toBe(true);
    const samples = [0, 1, 2].map(axis => {
      const values = new Set<number>();
      for (let n = 0; n < 30; n++) {
        const position = [...point];
        position[axis] += n * 0.037;
        values.add(cottonDensity(1, position[0], position[1], position[2]));
      }
      return values.size;
    });
    expect(Math.min(...samples)).toBeGreaterThan(8);
  });
  it("defaults to stage one and reads a numeric window override", () => {
    expect(silverStage()).toBe(1);
    vi.stubGlobal("window", { __silverStage: "2" });
    expect(silverStage()).toBe(1);
    vi.stubGlobal("window", { __silverStage: 2 });
    expect(silverStage()).toBe(2);
    vi.unstubAllGlobals();
  });
});
