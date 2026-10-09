import { describe, expect, it } from "vitest";
import { TubeMixingField } from "../src/scenes/laboratory/lib/tubeMixingField";

describe("tube mixing field", () => {
  it("conserves injected dye after the inlet closes", () => {
    const field = new TubeMixingField();
    field.start(true);
    for (let i = 0; i < 45; i++) field.advance(1 / 30, 0.7);
    const mass = field.totalMass();
    expect(mass).toBeGreaterThan(0);
    for (let i = 0; i < 150; i++) field.advance(1 / 30, 0.7);
    expect(field.totalMass()).toBeCloseTo(mass, 3);
    field.dispose();
  });

  it("keeps clear channels beside the optically rendered permanganate tongues", () => {
    const field = new TubeMixingField();
    field.start(true);
    for (let i = 0; i < 45; i++) field.advance(1 / 30, 0.7);
    const pixels = field.texture.image.data as Uint8Array;
    const top = Math.floor(0.7 * (field.height - 1));
    let coloured = 0;
    let clear = 0;
    for (let y = top - 22; y <= top; y++) for (let x = 1; x < field.width - 1; x++) {
      if (pixels[(y * field.width + x) * 4] > 48) coloured++;
      else clear++;
    }
    expect(coloured).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(coloured);
    field.dispose();
  });

  it("moves concentrated inlet tracer downward and smooths its contrast", () => {
    const field = new TubeMixingField();
    field.start(false);
    for (let i = 0; i < 45; i++) field.advance(1 / 30, 0.8);
    const earlyVariance = field.variance("tracer");
    for (let i = 0; i < 180; i++) field.advance(1 / 30, 0.8);
    expect(field.variance("tracer")).toBeLessThan(earlyVariance);
    expect(field.totalMass("tracer")).toBeGreaterThan(0);
    field.dispose();
  });

  it("carries BaSO4 clouds downward faster than the ordinary clear inlet", () => {
    const ordinary = new TubeMixingField();
    const barium = new TubeMixingField();
    ordinary.start(false);
    barium.start(false, "barium");
    for (let i = 0; i < 60; i++) {
      ordinary.advance(1 / 30, 0.8);
      barium.advance(1 / 30, 0.8);
    }
    expect(barium.centerOfMassHeight("tracer")).toBeLessThan(
      ordinary.centerOfMassHeight("tracer"));
    expect(barium.totalMass("tracer")).toBeGreaterThan(0);
    ordinary.dispose();
    barium.dispose();
  });

  it("sinks heavy dye under circulation and does no work at rest", () => {
    const field = new TubeMixingField();
    field.start(true);
    for (let i = 0; i < 40; i++) field.advance(1 / 30, 0.85);
    const height = field.centerOfMassHeight();
    const mass = field.totalMass();
    for (let i = 0; i < 130; i++) field.advance(1 / 30, 0.85);
    expect(field.centerOfMassHeight()).toBeLessThan(height);
    expect(field.totalMass()).toBeCloseTo(mass, 4);
    expect(Math.min(...field.dye)).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 220; i++) field.advance(1 / 30, 0.85);
    expect(field.running).toBe(false);
    const settled = field.dye.slice();
    field.advance(2, 0.85);
    expect(field.dye).toEqual(settled);
    field.dispose();
  });
});
