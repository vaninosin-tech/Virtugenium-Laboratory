import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { tubeVessel } from "./vesselGeometry";
import { LiquidMask } from "./tubeVolumeField";

describe("authored liquid cavity", () => {
  it("integrates the measured hemispherical bottom and cylinder", () => {
    const r = tubeVessel.innerRadius;
    expect(tubeVessel.areaAtHeight(0)).toBe(0);
    expect(tubeVessel.areaAtHeight(r)).toBeCloseTo(Math.PI * r * r, 14);
    expect(tubeVessel.volumeFromHeight(r)).toBeCloseTo(2 * Math.PI * r ** 3 / 3 * 1e6, 12);
    for (const ml of [0, 0.01, 0.1, 0.5, 1, 2, 2.5, 5, tubeVessel.volumeFromHeight(tubeVessel.cavityHeight)]) {
      const roundTrip = tubeVessel.volumeFromHeight(tubeVessel.heightFromVolume(ml));
      expect(Math.abs(roundTrip - ml)).toBeLessThan(1e-9 * Math.max(ml, 1));
    }
    expect(tubeVessel.heightFromVolume(1)).toBeCloseTo(0.008829, 5);
    expect(tubeVessel.heightFromVolume(2)).toBeCloseTo(0.015326, 5);
  });

  it("assigns the canonical volume across active cells", () => {
    const mask = new LiquidMask(12, 24, 12, tubeVessel.innerRadius, 0,
      tubeVessel.heightFromVolume(tubeVessel.capacityMl));
    for (const up of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.5, Math.sqrt(0.75), 0)]) {
      for (const ml of [0.5, 1, 2, 2.5, 5]) {
        mask.update(up, tubeVessel.heightFromVolume(ml));
        expect(mask.cellVolumeMl.reduce((sum, v) => sum + v, 0)).toBeCloseTo(ml, 10);
        for (let i = 0; i < mask.data.length; i++) {
          if (!mask.data[i]) expect(mask.cellVolumeMl[i]).toBe(0);
          else expect(mask.cellVolumeMl[i]).toBeGreaterThan(0);
        }
      }
    }
  });
});
