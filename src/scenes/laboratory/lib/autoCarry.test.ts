import { beforeEach, describe, expect, it } from "vitest";

import { autoCarryStep } from "./autoCarry";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useHeatingStore } from "./useHeatingStore";

const standAt = (onTray: boolean, onWorkbench: boolean, onFumeHood = false) =>
  useBunsenStandStorageStore.setState({ onTray, onWorkbench, onFumeHood, attachedTubeSlotIndex: null });

beforeEach(() => {
  standAt(true, false);
  useBurnerStore.setState({ place: "tray", phase: "capped", lit: false });
});

describe("the stand and the lamp carry themselves", () => {
  it("set themselves down where the player arrives", () => {
    autoCarryStep(null, "workbench");
    expect(useBunsenStandStorageStore.getState()).toMatchObject({ onTray: false, onWorkbench: true, onFumeHood: false });
    expect(useBurnerStore.getState().place).toBe("workbench");
  });

  it("do the same in the hood", () => {
    autoCarryStep(null, "fumeHood");
    expect(useBunsenStandStorageStore.getState()).toMatchObject({ onTray: false, onWorkbench: false, onFumeHood: true });
    expect(useBurnerStore.getState().place).toBe("fumeHood");
  });

  it("go back on the tray when the player leaves", () => {
    standAt(false, true);
    useBurnerStore.setState({ place: "workbench" });
    autoCarryStep("workbench", null);
    expect(useBunsenStandStorageStore.getState().onTray).toBe(true);
    expect(useBurnerStore.getState().place).toBe("tray");
  });

  it("leave behind a stand with a tube in its clamp", () => {
    standAt(false, true);
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    autoCarryStep("workbench", null);
    expect(useBunsenStandStorageStore.getState()).toMatchObject({ onTray: false, onWorkbench: true });
  });

  it("leave behind the lamp while it is heated over", () => {
    useBurnerStore.setState({ place: "workbench", phase: "lit", lit: true });
    useHeatingStore.setState({ active: true });
    autoCarryStep("workbench", null);
    expect(useBurnerStore.getState()).toMatchObject({ place: "workbench", lit: true });
    useHeatingStore.setState({ active: false });
  });

  it("take only what stands at the place being left", () => {
    standAt(false, false, true);
    useBurnerStore.setState({ place: "fumeHood" });
    autoCarryStep("workbench", null);
    expect(useBunsenStandStorageStore.getState().onFumeHood).toBe(true);
    expect(useBurnerStore.getState().place).toBe("fumeHood");
  });
});
