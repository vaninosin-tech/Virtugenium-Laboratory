import { describe, expect, it } from "vitest";

import {
  ROOM_TEMPERATURE_CHEMISTRY,
  TEMPERATURE_RISE_SECONDS,
  advanceChemistry,
  reactionKindFor,
  reactionTriggerFor,
  type TubeChemistry,
} from "./tubeReactions";

describe("reactionKindFor", () => {
  it("recognises all four experiments", () => {
    expect(reactionKindFor(["cu", "hno3"])).toBe("copper-nitric");
    expect(reactionKindFor(["agno3", "nacl"])).toBe("silver-chloride");
    expect(reactionKindFor(["bacl2", "k2so4"])).toBe("barium-sulfate");
    expect(reactionKindFor(["kmno4", "h2so4", "na2so3"])).toBe("permanganate-redox");
  });

  it("ignores the order things went in", () => {
    expect(reactionKindFor(["hno3", "cu"])).toBe("copper-nitric");
    expect(reactionKindFor(["na2so3", "kmno4", "h2so4"])).toBe("permanganate-redox");
  });

  it("needs every reagent", () => {
    expect(reactionKindFor([])).toBeNull();
    expect(reactionKindFor(["cu"])).toBeNull();
    expect(reactionKindFor(["kmno4", "na2so3"])).toBeNull();
    expect(reactionKindFor(["cu", "nacl"])).toBeNull();
  });

  it("copper needs heat, the ionic reactions only mixing", () => {
    expect(reactionTriggerFor(["cu", "hno3"])).toBe("heat");
    expect(reactionTriggerFor(["agno3", "nacl"])).toBe("mix");
    expect(reactionTriggerFor(["cu"])).toBeNull();
  });
});

const STEP = 1 / 30;
const run = (contents: string[], seconds: number, inFlame: boolean, from: TubeChemistry = ROOM_TEMPERATURE_CHEMISTRY) => {
  let state = from;
  for (let t = 0; t < seconds; t += STEP) state = advanceChemistry(contents, state, STEP, inFlame);
  return state;
};

describe("advanceChemistry", () => {
  const COPPER = ["cu", "hno3"];

  it("cold copper and dilute acid barely react", () => {
    const state = run(COPPER, 20, false);
    expect(state.progress).toBeGreaterThan(0);
    expect(state.progress).toBeLessThan(0.1);
    expect(state.rate).toBeLessThan(0.1);
  });

  it("heating brings the contents up to temperature and speeds the copper up", () => {
    const hot = run(COPPER, TEMPERATURE_RISE_SECONDS + 5, true);
    expect(hot.temperature).toBe(1);
    expect(hot.rate).toBeGreaterThan(0.5);
    expect(hot.progress).toBeGreaterThan(run(COPPER, TEMPERATURE_RISE_SECONDS + 5, false).progress * 5);
  });

  it("copper keeps reacting, more and more slowly, after leaving the flame", () => {
    const hot = run(COPPER, 8, true);
    const cooling = run(COPPER, 5, false, hot);
    expect(cooling.progress).toBeGreaterThan(hot.progress);
    expect(cooling.temperature).toBeLessThan(hot.temperature);
    expect(cooling.rate).toBeLessThan(hot.rate);
  });

  it("copper kept in the flame finishes within a minute and the bubbling stops", () => {
    const done = run(COPPER, TEMPERATURE_RISE_SECONDS + 35, true);
    expect(done.progress).toBe(1);
    expect(done.rate).toBe(0);
  });

  it("the ionic reactions run on mixing alone, in their own time", () => {
    expect(run(["agno3", "nacl"], 6, false).progress).toBeCloseTo(0.5, 1);
    expect(run(["agno3", "nacl"], 12.5, false).progress).toBe(1);
    expect(run(["bacl2", "k2so4"], 12.5, false).progress).toBeLessThan(1);
    const redox = ["kmno4", "h2so4", "na2so3"];
    expect(run(redox, 1, false).progress).toBeLessThan(0.2);
    expect(run(redox, 7.5, false).progress).toBe(1);
  });

  it("tracks temperature even with nothing reacting", () => {
    const warmed = run(["hno3"], TEMPERATURE_RISE_SECONDS / 2, true);
    expect(warmed.temperature).toBeCloseTo(0.5, 1);
    expect(warmed.progress).toBe(0);
  });
});
