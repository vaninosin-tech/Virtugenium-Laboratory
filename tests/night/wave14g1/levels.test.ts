import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { deliver, resetTubeAmounts, seedTubeAmounts, tubeAmount, tubeVisualFill } from "../../../src/scenes/laboratory/lib/tubeAmounts";
import { tubeVessel } from "../../../src/scenes/laboratory/lib/vesselGeometry";
import { silverStreamEnd } from "../../../src/scenes/laboratory/ui/PourStream";

beforeEach(resetTubeAmounts);

describe("shared game millilitres and visible surface", () => {
  it("raises a receiving volume by exactly the accepted delivery", () => {
    seedTubeAmounts("ag", ["agno3"]);
    const initial = tubeAmount("ag").volumeMl;
    const delivered = deliver("ag", "nacl", 1);
    expect(delivered).toBe(1);
    expect(tubeAmount("ag").volumeMl).toBe(initial + delivered);
    expect(tubeVisualFill(tubeAmount("ag").volumeMl)).toBeCloseTo(
      tubeVessel.heightFromVolume(initial + delivered) / tubeVessel.cavityHeight, 12);
  });

  it("uses the same upright free surface for the silver stream and visible fill", () => {
    const root = new THREE.Matrix4().makeTranslation(0, 0.2, 0);
    const mouth = new THREE.Vector3(0, 0.35, 0);
    for (const ml of [1, 2, 2.5, 3.5])
      expect(silverStreamEnd(mouth, root, ml).y).toBeCloseTo(
        0.2 + tubeVisualFill(ml) * tubeVessel.cavityHeight, 12);
  });

  it("maps experiment 1, 3 and 4 receiving fills through the same vessel", () => {
    for (const [tube, contents, reagent] of [
      ["copper", ["hno3"], "hno3"],
      ["barium", ["bacl2"], "k2so4"],
      ["permanganate", ["na2so3"], "kmno4"],
    ] as const) {
      seedTubeAmounts(tube, contents);
      expect(tubeAmount(tube).volumeMl).toBe(2.5);
      expect(tubeVisualFill(tubeAmount(tube).volumeMl)).toBeCloseTo(
        tubeVessel.heightFromVolume(2.5) / tubeVessel.cavityHeight, 12);
      deliver(tube, reagent, 1);
      expect(tubeAmount(tube).volumeMl).toBe(3.5);
      expect(tubeVisualFill(tubeAmount(tube).volumeMl)).toBeCloseTo(
        tubeVessel.heightFromVolume(3.5) / tubeVessel.cavityHeight, 12);
    }
  });
});
