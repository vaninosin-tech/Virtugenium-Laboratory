import { describe, expect, it } from "vitest";
import { computeTrayReagentPosition, useTrayReagentAreaStore } from "../src/scenes/laboratory/lib/useTrayReagentAreaStore";
import { nextFreeTraySlot, type StoredReagent } from "../src/scenes/laboratory/lib/useReagentStorageStore";

describe("fixed 4 by 2 tray layout", () => {
  const config = useTrayReagentAreaStore.getState().config;

  it("places slots 1..4 in the first row and 5..8 in the second", () => {
    const positions = Array.from({ length: 8 }, (_, slot) => computeTrayReagentPosition(config, slot));
    expect(positions.slice(0, 4).map((position) => position[2]))
      .toEqual(Array(4).fill(positions[0][2]));
    expect(positions.slice(4).map((position) => position[2]))
      .toEqual(Array(4).fill(positions[4][2]));
    expect(positions[4][2]).toBeGreaterThan(positions[0][2]);
    for (const row of [positions.slice(0, 4), positions.slice(4)]) {
      for (let col = 1; col < 4; col++) {
        expect(row[col][0] - row[col - 1][0]).toBeCloseTo(config.spacingX);
      }
    }
    expect(positions.every((position) => position[1] === config.originY)).toBe(true);
    expect(config.originY).toBeCloseTo(0.004025);
    const x = positions.slice(0, 4).map((position) => position[0]);
    expect(x[0] - 0.055).toBeGreaterThan(-0.136125);
    expect(x[3] + 0.055).toBeLessThan(0.5);
    expect(x[1] - x[0]).toBeGreaterThan(0.11);
  });

  it("reuses the first empty cell without moving other jars", () => {
    const item = (slotIndex: number) => ({ slotIndex } as StoredReagent);
    expect(nextFreeTraySlot([item(0), item(1), item(3), item(4)])).toBe(2);
    expect(nextFreeTraySlot(Array.from({ length: 8 }, (_, index) => item(index)))).toBe(-1);
  });
});
