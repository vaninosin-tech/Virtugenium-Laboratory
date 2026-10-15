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
  it("defaults to stage one and reads a numeric window override", () => {
    expect(silverStage()).toBe(1);
    vi.stubGlobal("window", { __silverStage: "2" });
    expect(silverStage()).toBe(1);
    vi.stubGlobal("window", { __silverStage: 2 });
    expect(silverStage()).toBe(2);
    vi.unstubAllGlobals();
  });
});
