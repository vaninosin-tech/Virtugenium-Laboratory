import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { isStageOneSilverPour, pourTarget, silverStreamEnd, shouldDrawStream,
  streamDeliveredMl } from "../../../src/scenes/laboratory/ui/PourStream";
import { CLAMP_TUBE_MOUTH } from "../../../src/scenes/laboratory/lib/useStandMotionStore";
import { deliver, resetTubeAmounts, seedTubeAmounts, STANDARD_POUR_ML,
  tubeAmount } from "../../../src/scenes/laboratory/lib/tubeAmounts";
import { tubeEffectiveRadius, tubeLiquidHeight } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";
import { pourFlowMlPerSecond, pouredMl, publishTubePourImpact,
  tubePourImpact } from "../../../src/scenes/laboratory/lib/tubePourImpact";

beforeEach(resetTubeAmounts);

describe("real stage-three silver pour", () => {
  it("ends at the current surface for three volumes and tilted tube roots", () => {
    expect(isStageOneSilverPour(3, "nacl", ["agno3"])).toBe(true);
    for (const volume of [1, 2.5, 4]) for (const tilt of [-0.22, 0, 0.18]) {
      const root = new THREE.Matrix4().compose(new THREE.Vector3(0.12, 0.2, -0.09),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, tilt / 2)),
        new THREE.Vector3(1, 1, 1));
      const mouth = new THREE.Vector3(0, 0.15, 0).applyMatrix4(root);
      const surface = new THREE.Vector3(0,
        tubeLiquidHeight(volume, tubeEffectiveRadius(0.055)), 0).applyMatrix4(root);
      const end = silverStreamEnd(mouth, root, volume);
      const impact = pourTarget(mouth, new THREE.Vector3(1, 0, 0), root, volume, true);
      expect(Math.abs(end.y - surface.y)).toBeLessThan(0.001);
      expect(Math.abs(impact.y - surface.y)).toBeLessThan(0.001);
      expect(impact.y).toBeLessThan(mouth.y);
      expect(shouldDrawStream(0.5, mouth.distanceTo(impact), true)).toBe(true);
    }
  });

  it("follows the clamp mouth and bottle side in both horizontal coordinates", () => {
    CLAMP_TUBE_MOUTH.root.identity().setPosition(0, 0.2, 0);
    CLAMP_TUBE_MOUTH.point.set(0.1, 0.35, -0.2);
    const first = pourTarget(CLAMP_TUBE_MOUTH.point, new THREE.Vector3(1, 0, 0),
      CLAMP_TUBE_MOUTH.root, 2.5, true);
    CLAMP_TUBE_MOUTH.root.setPosition(0.3, 0.2, 0.1);
    CLAMP_TUBE_MOUTH.point.set(0.4, 0.35, -0.1);
    const moved = pourTarget(CLAMP_TUBE_MOUTH.point, new THREE.Vector3(0, 0, 1),
      CLAMP_TUBE_MOUTH.root, 2.5, true);
    expect(first.x).toBeCloseTo(0.1065);
    expect(first.z).toBeCloseTo(-0.2);
    expect(moved.x).toBeCloseTo(0.4);
    expect(moved.z).toBeCloseTo(-0.0935);
    expect(moved.x).not.toBe(first.x);
    expect(moved.z).not.toBe(first.z);
    publishTubePourImpact("moved", "nacl", moved, new THREE.Vector3(0, -1, 0), 1, 0.1, 9);
    expect(tubePourImpact("moved")?.point.x).toBe(moved.x);
    expect(tubePourImpact("moved")?.point.z).toBe(moved.z);
  });

  it("delivers only while the stream is drawn, monotonically, to one fixed portion", () => {
    let previous = 0;
    for (let step = 0; step <= 1000; step++) {
      const k = step / 1000;
      const total = streamDeliveredMl(k, 0.12, true);
      if (k <= 0.35) {
        expect(pouredMl(k)).toBe(0);
        expect(total).toBe(0);
        expect(tubePourImpact("progressive")).toBeUndefined();
      }
      if (total > 0) {
        expect(shouldDrawStream(Math.min(
          THREE.MathUtils.smoothstep(k, 0.35, 0.44),
          1 - THREE.MathUtils.smoothstep(k, 0.69, 0.76)), 0.12, true)).toBe(true);
        const increment = Math.max(0, total - previous);
        if (increment > 0) publishTubePourImpact("progressive", "nacl",
          new THREE.Vector3(0.006, 0.055, 0), new THREE.Vector3(0, -1, 0),
          pourFlowMlPerSecond(k), increment, 123);
        expect(total).toBeGreaterThanOrEqual(previous);
        previous = total;
      }
    }
    expect(pouredMl(1)).toBe(STANDARD_POUR_ML);
    // The end-of-pour subscription admits the tiny unsampled tail after a stream frame.
    publishTubePourImpact("progressive", "nacl", new THREE.Vector3(0.006, 0.055, 0),
      new THREE.Vector3(0, -1, 0), 0, STANDARD_POUR_ML - previous, 123);
    expect(tubePourImpact("progressive")?.deliveredMl).toBe(STANDARD_POUR_ML);
    expect(tubeAmount("progressive").volumeMl).toBe(STANDARD_POUR_ML);
  });

  it("updates receiving volume and liquid height by the accepted amount", () => {
    seedTubeAmounts("receiving", ["agno3"]);
    const before = tubeAmount("receiving").volumeMl;
    const radius = tubeEffectiveRadius(0.055);
    const priorHeight = tubeLiquidHeight(before, radius);
    const accepted = deliver("receiving", "nacl", STANDARD_POUR_ML);
    const after = tubeAmount("receiving").volumeMl;
    expect(accepted).toBe(STANDARD_POUR_ML);
    expect(after - before).toBe(accepted);
    expect(tubeLiquidHeight(after, radius)).toBeGreaterThan(priorHeight);
    expect(tubeLiquidHeight(after, radius)).toBeCloseTo(tubeLiquidHeight(3.5, radius));
  });
});
