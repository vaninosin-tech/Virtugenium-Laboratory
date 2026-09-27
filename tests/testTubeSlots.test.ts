import { beforeEach, describe, expect, it } from "vitest";
import {
  computeTubeSlotPosition,
  TEST_TUBE_TRAY_CAPACITY,
  useTestTubeStorageStore,
} from "../src/scenes/laboratory/lib/useTestTubeStorageStore";

beforeEach(() => {
  useTestTubeStorageStore.setState({ trayTestTubes: [], workbenchTestTubes: [] });
});

describe("test tube rack placement", () => {
  it("keeps every tube at finite, distinct coordinates when rotation is omitted", () => {
    const holder = { x: 0.07, y: 1.2745, z: 0.055, scale: 1 };
    const positions = Array.from({ length: 16 }, (_, index) => computeTubeSlotPosition(holder, index));
    expect(positions.flat().every(Number.isFinite)).toBe(true);
    expect(new Set(positions.map(position => position.join(","))).size).toBe(16);
    positions.forEach((position, index) => {
      expect(position).toEqual(computeTubeSlotPosition({ ...holder, rotY: 0 }, index));
      expect(position[1]).toBeCloseTo(1.2885);
    });
  });

  it("rotates tube slots with the tray rack", () => {
    const position = computeTubeSlotPosition({ x: 1, y: 2, z: 3, scale: 2, rotY: Math.PI / 2 }, 0);
    expect(position[0]).toBeCloseTo(0.958);
    expect(position[1]).toBeCloseTo(2.028);
    expect(position[2]).toBeCloseTo(2.762);
  });

  it("moves all 16 tubes to the workbench immediately without duplicates", () => {
    for (let index = 0; index < TEST_TUBE_TRAY_CAPACITY; index += 1) {
      expect(useTestTubeStorageStore.getState().takeTestTube({ instanceId: `tube-${index}` })).toBe(true);
    }
    expect(useTestTubeStorageStore.getState().takeTestTube({ instanceId: "tube-overflow" })).toBe(false);

    useTestTubeStorageStore.getState().transferTrayToWorkbench();

    expect(useTestTubeStorageStore.getState().trayTestTubes).toHaveLength(0);
    expect(useTestTubeStorageStore.getState().workbenchTestTubes).toHaveLength(16);
    expect(useTestTubeStorageStore.getState().takeTestTube({ instanceId: "tube-after-transfer" })).toBe(false);
  });
});
