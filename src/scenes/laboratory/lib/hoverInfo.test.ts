import { beforeEach, describe, expect, it } from "vitest";

import { describeSubject, subjectOfTarget } from "./hoverInfo";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";

beforeEach(() => {
  useTestTubeStorageStore.setState({
    trayTestTubes: [{ instanceId: "tray-1", contents: [] }],
    workbenchTestTubes: [{ instanceId: "w0", contents: ["cu", "hno3"] }, { instanceId: "w1", contents: [] }],
    fumeHoodTestTubes: [],
  });
  useBunsenStandStorageStore.setState({ onTray: false, onWorkbench: true, onFumeHood: false, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ place: "workbench", phase: "capped", lit: false });
});

describe("what the hover names", () => {
  it("says where a jar is and what is in it", () => {
    const info = describeSubject({ kind: "bottle", reagentId: "nacl", place: "tray" });
    expect(info?.title).toMatch(/· на подносе$/);
    expect(info?.state).toMatch(/NaCl$/);
    expect(describeSubject({ kind: "bottle", reagentId: "nacl", place: "fumeHood" })?.title).toMatch(/в вытяжном шкафу$/);
  });

  it("tells a tube in the rack from one in the clamp, and what it holds", () => {
    expect(describeSubject({ kind: "tube", place: "workbench", index: 1 })).toMatchObject({
      title: "Пробирка · в штативе для пробирок, на столе",
      state: "пустая",
    });
    useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
    const clamped = describeSubject({ kind: "tube", place: "workbench", index: 0 });
    expect(clamped?.title).toBe("Пробирка · в лапке штатива, на столе");
    expect(clamped?.state).toContain(" + ");
  });

  it("finds a tray tube by its id, and nothing once it has gone", () => {
    expect(describeSubject({ kind: "tube", place: "tray", instanceId: "tray-1" })?.title).toBe("Пробирка · на подносе");
    expect(describeSubject({ kind: "tube", place: "tray", instanceId: "gone" })).toBeNull();
  });

  it("gives the lamp's and the stand's state", () => {
    expect(describeSubject({ kind: "lamp", place: "workbench" })?.state).toBe("закрыта колпачком");
    useBurnerStore.setState({ phase: "lit", lit: true });
    expect(describeSubject({ kind: "lamp", place: "workbench" })?.state).toBe("горит");
    expect(describeSubject({ kind: "stand", place: "workbench" })?.state).toBe("лапка пуста");
  });

  it("names the subject of a stand target by itself", () => {
    expect(subjectOfTarget({ kind: "bottle", location: "fumeHood", reagentId: "cu" })).toEqual({ kind: "bottle", reagentId: "cu", place: "fumeHood" });
    expect(subjectOfTarget({ kind: "burner" })).toEqual({ kind: "lamp", place: "workbench" });
  });
});
