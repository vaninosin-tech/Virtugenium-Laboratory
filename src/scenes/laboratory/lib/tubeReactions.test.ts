import { describe, expect, it } from "vitest";

import {
  ROOM_TEMPERATURE_CHEMISTRY,
  TEMPERATURE_RISE_SECONDS,
  advanceChemistry,
  copperReactionState,
  copperWettedArea,
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

  it("produces Cu(II) faster from more copper surface and slows as the granule shrinks", () => {
    expect(copperWettedArea(0.5)).toBeCloseTo(Math.pow(0.5, 2 / 3));
    const small = advanceChemistry(COPPER, { ...ROOM_TEMPERATURE_CHEMISTRY, copperArea: 0.5 }, 0.1, false);
    const large = advanceChemistry(COPPER, { ...ROOM_TEMPERATURE_CHEMISTRY, copperArea: 1.5 }, 0.1, false);
    expect(large.progress).toBeCloseTo(small.progress * 3);
    const early = advanceChemistry(COPPER, { ...ROOM_TEMPERATURE_CHEMISTRY, progress: 0.1 }, 0.1, false);
    const late = advanceChemistry(COPPER, { ...ROOM_TEMPERATURE_CHEMISTRY, progress: 0.8 }, 0.1, false);
    expect(early.rate).toBeGreaterThan(late.rate);
    expect(copperReactionState(late.progress).copperII - copperReactionState(0.8).copperII)
      .toBeLessThan(copperReactionState(early.progress).copperII - copperReactionState(0.1).copperII);
  });

  it("cold copper and dilute acid react slowly but visibly, finishing in about two minutes", () => {
    const minute = run(COPPER, 60, false);
    expect(minute.progress).toBeGreaterThan(0.5);
    expect(minute.progress).toBeLessThan(1);
    expect(minute.rate).toBeLessThan(0.25);
    expect(run(COPPER, 125, false).progress).toBe(1);
  });

  it("heating brings the contents up to temperature and speeds the copper up", () => {
    const hot = run(COPPER, TEMPERATURE_RISE_SECONDS + 5, true);
    expect(hot.temperature).toBe(1);
    expect(hot.rate).toBeGreaterThan(0.5);
    const cold = run(COPPER, TEMPERATURE_RISE_SECONDS + 5, false);
    expect(hot.rate).toBeGreaterThan(cold.rate * 1.7);
    expect(hot.progress).toBeGreaterThan(cold.progress * 1.5);
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
    // Until the R3 field supplies an extent, the timer must not invent one.
    expect(run(["bacl2", "k2so4"], 12.5, false).progress).toBe(0);
    // R4 falls back to scalar kinetics while the spatial field is absent.
    const redox = ["kmno4", "h2so4", "na2so3"];
    expect(run(redox, 2.5, false).progress).toBeGreaterThan(0);
    expect(advanceChemistry(redox, { ...ROOM_TEMPERATURE_CHEMISTRY,
      progress: 0.3, rate: 0.2, fieldUpdatedAt: Date.now() }, 0.1, false).progress).toBe(0.3);
  });

  it("uses R3 field progress and resumes scalar kinetics after a one-second stall", () => {
    const contents = ["bacl2", "k2so4"];
    const field = { ...ROOM_TEMPERATURE_CHEMISTRY, progress: 0.4, rate: 0.2,
      fieldUpdatedAt: Date.now() };
    expect(advanceChemistry(contents, field, 0.1, false).progress).toBe(0.4);
    const stalled = advanceChemistry(contents, { ...field,
      fieldUpdatedAt: Date.now() - 1200 }, 0.1, false);
    expect(stalled.progress).toBeGreaterThan(0.4);
  });

  it("tracks temperature even with nothing reacting", () => {
    const warmed = run(["hno3"], TEMPERATURE_RISE_SECONDS / 2, true);
    expect(warmed.temperature).toBeCloseTo(0.5, 1);
    expect(warmed.progress).toBe(0);
  });
});
