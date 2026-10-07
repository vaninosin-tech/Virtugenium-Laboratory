import { describe, expect, it } from "vitest";

import { flameAirflow, flameHotZone } from "./flameAirflow";

const input = { inHood: true, fanOn: true, d: 0.3, transition: 1, nearSeconds: 0 };

describe("flameAirflow", () => {
  it("keeps a table flame calm and interpolates extraction over one second", () => {
    const still = flameAirflow({ ...input, inHood: false });
    const midway = flameAirflow({ ...input, transition: 0.5 });
    const full = flameAirflow(input);
    expect(still.tiltRad).toBe(0);
    expect(still.flickerHz).toBe(2.2);
    expect(midway.tiltRad).toBeCloseTo(full.tiltRad / 2);
    expect(full.tiltRad * 180 / Math.PI).toBeCloseTo(12.5);
    expect(full.heightScale).toBeCloseTo(0.9);
  });

  it("switches at 0.15 m and reports blowout only after five continuous seconds", () => {
    const edge = flameAirflow({ ...input, d: 0.15, nearSeconds: 6 });
    const near = flameAirflow({ ...input, d: 0.149, nearSeconds: 4.99 });
    expect(edge.blowOut).toBe(false);
    expect(near.tiltRad * 180 / Math.PI).toBeCloseTo(25);
    expect(near.flickerHz).toBe(7);
    expect(near.raggedness).toBe(1);
    expect(near.detachment).toBeGreaterThan(0);
    expect(near.blowOut).toBe(false);
    expect(flameAirflow({ ...input, d: 0.149, nearSeconds: 5 }).blowOut).toBe(true);
    expect(flameAirflow({ ...input, fanOn: false, d: 0.149, nearSeconds: 5 }).blowOut).toBe(false);
  });

  it("moves the hot zone toward the rear with the flame", () => {
    const zone = flameHotZone(0.0765, 0.04, flameAirflow({ ...input, d: 0.1 }));
    expect(zone.point.z).toBeLessThan(0);
    expect(zone.point.y).toBeGreaterThan(0.0765);
    expect(zone.radius).toBe(0.008);
    expect(zone.axis.y).toBeCloseTo(Math.cos(25 * Math.PI / 180));
  });
});
