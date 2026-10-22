import { describe, expect, it } from "vitest";

import { getCabinetParallelTrayYaw } from "../src/scenes/laboratory/lib/layout";

describe("held tray orientation", () => {
  it("aligns the tray long axis with back-wall cabinets", () => {
    expect(getCabinetParallelTrayYaw("cabinet-glassware")).toBe(0);
  });

  it("aligns the tray long axis with right-wall cabinets", () => {
    expect(getCabinetParallelTrayYaw("cabinet-acids")).toBe(Math.PI / 2);
  });

  it("uses the supplied home yaw outside cabinet inspection", () => {
    expect(getCabinetParallelTrayYaw(null, Math.PI / 4)).toBe(Math.PI / 4);
  });
});
