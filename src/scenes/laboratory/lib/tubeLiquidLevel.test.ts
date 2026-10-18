import { describe, expect, it } from "vitest";
import { tubeEffectiveRadius, tubeLiquidFill, tubeLiquidHeight } from "./tubeLiquidLevel";

describe("tube volume geometry", () => {
  it("inverts the hemisphere and cylinder volumes monotonically", () => {
    const radius = 0.007;
    let previous = 0;
    for (const ml of [0, 0.05, 0.5, 1, 2.5, 3.5, 5]) {
      const h = tubeLiquidHeight(ml, radius);
      expect(h).toBeGreaterThanOrEqual(previous);
      const recovered = (h <= radius
        ? Math.PI * h * h * (radius - h / 3)
        : 2 * Math.PI * radius ** 3 / 3 + Math.PI * radius ** 2 * (h - radius)) * 1e6;
      expect(recovered).toBeCloseTo(ml, 8);
      previous = h;
    }
    expect(tubeLiquidFill(3.5, radius, 0.055)).toBeGreaterThan(tubeLiquidFill(2.5, radius, 0.055));
    const effective = tubeEffectiveRadius(0.0555);
    expect(effective).toBe(radius);
    expect(tubeLiquidHeight(2.5, effective)).toBeCloseTo(0.01857, 4);
    expect(tubeLiquidHeight(5, effective)).toBeGreaterThan(tubeLiquidHeight(3.5, effective));
  });
});
