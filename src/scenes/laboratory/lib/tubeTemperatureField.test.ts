import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TemperatureField } from "./tubeTemperatureField";
import { TubeVolumeField } from "./tubeVolumeField";
import { ROOM_TEMPERATURE_CHEMISTRY, advanceChemistry, useTubeReactionStore } from "./tubeReactions";
import { useHeatingStore } from "./useHeatingStore";

const step = 1 / 30;
const heat = (field: TemperatureField, seconds: number, sweep: number, on = true) => {
  for (let i = 0; i < Math.round(seconds / step); i++) field.advance(step, on ? 1 : 0, sweep, 12, 40);
};

describe("TemperatureField and convection", () => {
  it("warms locally, changes side with the flame and cools with inertia", () => {
    const left = new TemperatureField();
    const right = new TemperatureField();
    heat(left, 4, -1);
    heat(right, 4, 1);
    expect(left.mean).toBeCloseTo(1 / 3, 2);
    expect(left.hotX).toBeLessThan(0);
    expect(right.hotX).toBeGreaterThan(0);
    const hot = left.mean;
    heat(left, 1, -1, false);
    expect(left.mean).toBeGreaterThan(0);
    expect(left.mean).toBeLessThan(hot);
    heat(left, 2, -1);
    expect(left.mean).toBeGreaterThan(hot);
  });

  it("uses the same temperature for chemistry and transport without creating Cu(II)", () => {
    useHeatingStore.setState({ sweep: -1 });
    let chemistry = ROOM_TEMPERATURE_CHEMISTRY;
    for (let i = 0; i < 120; i++) chemistry = advanceChemistry(["hno3"], chemistry, step, true);
    expect(chemistry.temperature).toBeCloseTo(chemistry.temperatureField!.mean, 6);
    expect(chemistry.progress).toBe(0);
    const field = new TubeVolumeField("LOW", 0.007, 0, 0.055, []);
    field.advance(step, chemistry.progress, new THREE.Vector3(0, 1, 0), 0.04,
      chemistry.rate, chemistry.temperature, chemistry.temperatureField);
    expect(field.velocity.heatX).toBeLessThan(0);
    expect(field.copperII).toBe(0);
    field.dispose();
  });

  it("keeps the thermal mean comparable at 30, 60 and 144 FPS", () => {
    const means = [30, 60, 144].map(fps => {
      const field = new TemperatureField();
      for (let i = 0; i < fps * 6; i++) field.advance(1 / fps, 1, -1, 12, 40);
      return field.mean;
    });
    for (const mean of means) expect(mean).toBeCloseTo(0.5, 2);
  });

  it("feeds a scripted tube through the field and stops heating when switched off", () => {
    const store = useTubeReactionStore.getState();
    store.reset();
    store.setExternalHeat("showcase", 1);
    let chemistry = useTubeReactionStore.getState().chemistryById.showcase;
    for (let i = 0; i < 45; i++) chemistry = advanceChemistry(["cu"], chemistry, step, false);
    for (let i = 0; i < 1005; i++) chemistry = advanceChemistry(["cu", "hno3"], chemistry, step, false);
    expect(chemistry.progress).toBeGreaterThan(0.99);
    expect(chemistry.temperature).toBe(1);
    useTubeReactionStore.getState().setChemistry("showcase", chemistry);
    useTubeReactionStore.getState().setExternalHeat("showcase", 0);
    const cooling = advanceChemistry(["cu", "hno3"],
      useTubeReactionStore.getState().chemistryById.showcase, step, false);
    expect(cooling.temperature).toBeLessThan(1);
    expect(cooling.temperatureField).toBe(chemistry.temperatureField);
    store.reset();
  });
});
