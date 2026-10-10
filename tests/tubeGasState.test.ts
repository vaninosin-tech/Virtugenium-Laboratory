import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GasState } from "../src/scenes/laboratory/lib/tubeGasState";
import { TubeNOBubbles } from "../src/scenes/laboratory/lib/tubeNOBubbles";

describe("R1 NO gas and bubbles", () => {
  it("keeps NO colourless without oxygen and conserves NO through oxidation", () => {
    const gas = new GasState();
    gas.oxygenAvailable = false;
    gas.advance(0.25, 1 / 30);
    for (let i = 0; i < 90; i++) gas.advance(0, 1 / 30);
    expect(gas.producedNO).toBeCloseTo(0.5);
    expect(gas.no).toBeCloseTo(0.5);
    expect(gas.no2).toBe(0);
    gas.oxygenAvailable = true;
    for (let i = 0; i < 90; i++) gas.advance(0, 1 / 30);
    expect(gas.no2).toBeGreaterThan(0);
    expect(gas.no + gas.no2).toBeCloseTo(gas.producedNO, 10);
    gas.reset();
    expect(gas.no2).toBe(0);
  });

  it("samples births from chemical increments independently of frame count", () => {
    const run = (fps: number) => {
      const bubbles = new TubeNOBubbles();
      const source = [new THREE.Vector3(0, 0.004, 0)];
      const up = new THREE.Vector3(0, 1, 0);
      const center = new THREE.Vector3();
      for (let i = 0; i < fps * 3; i++)
        bubbles.advance(1 / fps, 0.01 / fps, 1, source, up, 0.04, center, 0.007);
      return bubbles.born;
    };
    expect(run(30)).toBe(run(60));
    expect(run(60)).toBe(run(144));
  });

  it("never creates bubbles without NO and releases grown bubbles into the liquid", () => {
    const bubbles = new TubeNOBubbles();
    const source = [new THREE.Vector3(0, 0.004, 0)];
    const up = new THREE.Vector3(0, 1, 0);
    const center = new THREE.Vector3();
    for (let i = 0; i < 120; i++)
      bubbles.advance(1 / 60, 0, 1, source, up, 0.04, center, 0.007);
    expect(bubbles.born).toBe(0);
    bubbles.advance(1 / 60, 0.1, 1, source, up, 0.04, center, 0.007);
    expect(bubbles.state.some(state => state === 1)).toBe(true);
    for (let i = 0; i < 90; i++)
      bubbles.advance(1 / 60, 0, 1, source, up, 0.04, center, 0.007);
    expect(bubbles.state.some(state => state === 2)).toBe(true);
    for (let i = 0; i < 120; i++)
      bubbles.advance(1 / 60, 0, 1, source, up, 0.04, center, 0.007);
    expect(bubbles.popped).toBeGreaterThan(0);
    const born = bubbles.born;
    for (let i = 0; i < 120; i++)
      bubbles.advance(1 / 60, 0, 1, source, up, 0.04, center, 0.007);
    expect(bubbles.born).toBe(born);
    expect(bubbles.state.every(state => state === 0)).toBe(true);
  });

  it("keeps rising bubbles inside the glass and removes them at the meniscus", () => {
    const bubbles = new TubeNOBubbles();
    const source = [new THREE.Vector3(0.005, 0.004, 0)];
    const up = new THREE.Vector3(0, 1, 0);
    const center = new THREE.Vector3();
    const radius = 0.007, level = 0.04;
    let pops = 0;
    const onPop = () => { pops++; };
    bubbles.advance(1 / 60, 0.025, 1, source, up, level, center, radius, undefined, 0, onPop);
    for (let frame = 0; frame < 180; frame++) {
      bubbles.advance(1 / 60, 0, 1, source, up, level, center, radius, undefined, frame / 60, onPop);
      for (let i = 0; i < bubbles.capacity; i++) {
        if (bubbles.state[i] !== 2) continue;
        expect(Math.hypot(bubbles.x[i], bubbles.z[i]) + bubbles.size[i]).toBeLessThanOrEqual(radius * 0.87 + 1e-6);
        expect(bubbles.y[i] + bubbles.size[i]).toBeLessThan(level + 1e-6);
      }
    }
    expect(pops).toBeGreaterThan(0);
    expect(bubbles.state.every(state => state === 0)).toBe(true);
  });

  it("produces more visible births for a stronger NO source", () => {
    const run = (noPerSecond: number) => {
      const bubbles = new TubeNOBubbles();
      const source = [new THREE.Vector3(0, 0.004, 0)];
      const up = new THREE.Vector3(0, 1, 0);
      const center = new THREE.Vector3();
      for (let i = 0; i < 60; i++)
        bubbles.advance(1 / 60, noPerSecond / 60, 1, source, up, 0.04, center, 0.007);
      return bubbles.born;
    };
    expect(run(0.025)).toBeGreaterThan(run(0.005) * 3);
  });
});
