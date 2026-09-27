import { beforeEach, describe, expect, it } from "vitest";

import type { StoredReagent } from "../src/scenes/laboratory/lib/useReagentStorageStore";
import { useReagentStorageStore } from "../src/scenes/laboratory/lib/useReagentStorageStore";
import {
  isInsideTrayReturnZone,
  TRAY_RETURN_ZONE_FOOTPRINT,
  TRAY_RETURN_ZONE_LOCAL_POSITION,
  TRAY_RETURN_ZONE_POSITION,
  TRAY_RETURN_ZONE_SIZE,
} from "../src/scenes/laboratory/lib/trayReturnZone";

const reagent = (instanceId: string): StoredReagent => ({
  instanceId,
  reagentId: "NaCl",
  containerType: "wide120",
  cabinetId: "cabinet-salts",
  slotIndex: 0,
});

describe("workbench reagent return", () => {
  beforeEach(() => {
    useReagentStorageStore.setState({
      takenByCabinet: {},
      trayItems: [],
      workbenchItems: [],
      returnRequest: null,
    });
  });

  it("recognizes the center and rejects points outside the tray volume", () => {
    expect(isInsideTrayReturnZone(TRAY_RETURN_ZONE_POSITION[0], TRAY_RETURN_ZONE_POSITION[2])).toBe(true);
    expect(
      isInsideTrayReturnZone(
        TRAY_RETURN_ZONE_POSITION[0] + TRAY_RETURN_ZONE_FOOTPRINT[1],
        TRAY_RETURN_ZONE_POSITION[2] + TRAY_RETURN_ZONE_FOOTPRINT[0],
      ),
    ).toBe(false);
    expect(TRAY_RETURN_ZONE_SIZE[0]).toBeCloseTo(0.91625);
    expect(TRAY_RETURN_ZONE_SIZE[1]).toBeCloseTo(0.1275);
    expect(TRAY_RETURN_ZONE_SIZE[2]).toBeCloseTo(0.537);
    expect(TRAY_RETURN_ZONE_LOCAL_POSITION[1] - TRAY_RETURN_ZONE_SIZE[1] / 2).toBeCloseTo(0);
    expect(TRAY_RETURN_ZONE_LOCAL_POSITION[1] + TRAY_RETURN_ZONE_SIZE[1] / 2).toBeCloseTo(0.1275);
  });

  it("removes only the dropped workbench reagent", () => {
    useReagentStorageStore.setState({ workbenchItems: [reagent("keep"), reagent("return")] });

    useReagentStorageStore.getState().returnWorkbenchReagent("return");

    expect(useReagentStorageStore.getState().workbenchItems.map((item) => item.instanceId)).toEqual(["keep"]);
  });

  it("swaps only the two requested workbench slots", () => {
    useReagentStorageStore.setState({
      workbenchItems: [reagent("first"), reagent("middle"), reagent("last")],
      trayItems: [reagent("tray")],
    });

    useReagentStorageStore.getState().swapWorkbenchReagents("first", "last");

    expect(useReagentStorageStore.getState().workbenchItems.map((item) => item.instanceId)).toEqual([
      "last",
      "middle",
      "first",
    ]);
    expect(useReagentStorageStore.getState().trayItems.map((item) => item.instanceId)).toEqual(["tray"]);
  });

  it("never creates a second copy of the same physical jar", () => {
    const existing = reagent("same-jar");
    useReagentStorageStore.setState({
      workbenchItems: [existing, existing],
      trayItems: [existing, reagent("new-jar")],
    });

    useReagentStorageStore.getState().transferTrayToWorkbench();
    useReagentStorageStore.getState().resetCabinetSession("cabinet-salts");

    expect(useReagentStorageStore.getState().workbenchItems.map((item) => item.instanceId)).toEqual([
      "same-jar",
      "new-jar",
    ]);
    expect(useReagentStorageStore.getState().takenByCabinet["cabinet-salts"]?.has("same-jar")).toBe(true);
  });

  it("does not append a jar that is already on the workbench", () => {
    const existing = reagent("same-jar");
    useReagentStorageStore.setState({ workbenchItems: [existing] });

    expect(useReagentStorageStore.getState().takeReagent("cabinet-salts", existing)).toBe(true);
    expect(useReagentStorageStore.getState().workbenchItems).toHaveLength(1);
    expect(useReagentStorageStore.getState().trayItems).toHaveLength(0);
  });
});
