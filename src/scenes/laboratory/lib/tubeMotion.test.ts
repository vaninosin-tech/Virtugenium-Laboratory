import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TubeMotion } from "./tubeMotion";

describe("tube motion", () => {
  it("ignores tiny jitter and responds to a real jerk without a control button", () => {
    const tube = new THREE.Object3D();
    const sampler = new TubeMotion();
    sampler.sample(tube, 1 / 60);
    for (let i = 0; i < 10; i++) {
      tube.position.x += 0.000001;
      tube.updateMatrixWorld(true);
      expect(sampler.sample(tube, 1 / 60)).toBeLessThan(0.01);
    }
    tube.position.x += 0.04;
    tube.rotation.z = 0.3;
    tube.updateMatrixWorld(true);
    expect(sampler.sample(tube, 1 / 60)).toBeGreaterThan(0.1);
    expect(sampler.impulse.length()).toBeGreaterThan(0);
  });

  it("resets after a stalled frame instead of inventing a large acceleration", () => {
    const tube = new THREE.Object3D();
    const sampler = new TubeMotion();
    sampler.sample(tube, 1 / 60);
    tube.position.x = 1;
    tube.updateMatrixWorld(true);
    expect(sampler.sample(tube, 0.5)).toBe(0);
    expect(sampler.sample(tube, 1 / 60)).toBe(0);
  });
});
