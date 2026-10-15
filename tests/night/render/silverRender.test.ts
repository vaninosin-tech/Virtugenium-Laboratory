import { describe, expect, it } from "vitest";
import { SilverSedimentField, SilverSedimentGeometry } from "../../../src/scenes/laboratory/lib/tubeSilverSediment";
import { silverOpticalDepth, silverScatteringAlpha, silverSedimentThickness } from "../../../src/scenes/laboratory/lib/night/render/silverOptics";

const radius = 0.007;

describe("silver optical mapping", () => {
  it("grows optical depth with density and path length and stays bounded", () => {
    const thin = silverOpticalDepth(0.5, radius, radius);
    expect(thin).toBeGreaterThan(0);
    expect(silverOpticalDepth(1, radius, radius)).toBeGreaterThan(thin);
    expect(silverOpticalDepth(0.5, 2 * radius, radius)).toBeGreaterThan(thin);
    expect(silverOpticalDepth(1e9, 1, radius)).toBe(32);
    expect(silverScatteringAlpha(thin)).toBeGreaterThan(0);
    expect(silverScatteringAlpha(thin)).toBeLessThan(1);
  });

  it("clamps invalid inputs and thickness without negative values", () => {
    for (const value of [NaN, Infinity, -1, 0]) {
      expect(silverOpticalDepth(value, radius, radius)).toBe(0);
      expect(silverScatteringAlpha(value)).toBe(0);
      expect(silverSedimentThickness(value, radius, 0)).toBe(0);
    }
    expect(silverSedimentThickness(0.001, radius, 0)).toBeGreaterThan(0);
    expect(silverSedimentThickness(0.002, radius, 0)).toBeCloseTo(2 * silverSedimentThickness(0.001, radius, 0));
    expect(silverSedimentThickness(0.002, radius, 1)).toBeLessThan(silverSedimentThickness(0.002, radius, 0));
    expect(silverSedimentThickness(100, radius, 0)).toBe(radius * 1.8);
  });
});

describe("SilverSedimentGeometry", () => {
  const make = (mass: number, compaction = 0) => {
    const field = new SilverSedimentField(8, 8);
    field.deposit(4 * 8 + 4, mass);
    field.compaction = compaction;
    const geometry = new SilverSedimentGeometry(radius, 0);
    geometry.update(field);
    return geometry;
  };

  it("has finite vertices within the hemispherical tube and a closed indexed skin", () => {
    const geometry = make(0.12);
    const positions = geometry.getAttribute("position");
    const thickness = geometry.getAttribute("sedimentThickness");
    const index = geometry.getIndex()!;
    expect(index.count).toBeGreaterThan(0);
    const edges = new Map<string, number>();
    for (let i = 0; i < index.count; i += 3) {
      const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let side = 0; side < 3; side++) {
        const a = tri[side], b = tri[(side + 1) % 3];
        const key = [Math.min(a, b), Math.max(a, b)].join(":");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    const boundary = [...edges.values()].filter(count => count === 1).length;
    expect(boundary).toBe(0);
    expect([...edges.values()].every(count => count === 2)).toBe(true);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const r = Math.hypot(x, z);
      const floor = radius - Math.sqrt(radius * radius - r * r);
      expect([x, y, z, thickness.getX(i)].every(Number.isFinite)).toBe(true);
      expect(r).toBeLessThan(radius);
      expect(y).toBeGreaterThanOrEqual(floor - 1e-8);
      expect(thickness.getX(i)).toBeGreaterThanOrEqual(0);
    }
    geometry.dispose();
  });

  it("thickens monotonically with column mass and compacts without adding height", () => {
    const low = make(0.02), high = make(0.08), compact = make(0.08, 1);
    const a = low.getAttribute("sedimentThickness");
    const b = high.getAttribute("sedimentThickness");
    const c = compact.getAttribute("sedimentThickness");
    let grew = false, shrank = false;
    for (let i = 0; i < a.count; i++) {
      expect(b.getX(i)).toBeGreaterThanOrEqual(a.getX(i) - 1e-8);
      expect(c.getX(i)).toBeLessThanOrEqual(b.getX(i) + 1e-8);
      grew ||= b.getX(i) > a.getX(i) + 1e-6;
      shrank ||= c.getX(i) < b.getX(i) - 1e-6;
    }
    expect(grew).toBe(true);
    expect(shrank).toBe(true);
    low.dispose(); high.dispose(); compact.dispose();
  });
});
