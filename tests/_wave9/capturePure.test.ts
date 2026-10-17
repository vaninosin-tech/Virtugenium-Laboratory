import { describe, expect, it } from "vitest";
import { drawtextCommand, formatStamps, frameGaps } from "./capturePure.mjs";

describe("wave 9 capture metadata", () => {
  it("formats all four simulation stamps including missing values", () => {
    expect(formatStamps({ firstValidImpact: 150, firstCompositionUpdate: 150,
      firstFieldInit: 150, firstChlorideInsertion: 200 })).toEqual([
      "first valid impact: 150 sim ms", "first composition update: 150 sim ms",
      "first field init: 150 sim ms", "first chloride insertion: 200 sim ms",
    ]);
    expect(formatStamps({})[0]).toContain("missing");
    expect(drawtextCommand("in.mp4", "out.mp4", { firstValidImpact: 150 }))
      .toContain("first valid impact\\: 150 sim ms");
  });

  it("reports only frame gaps greater than 100 ms", () => {
    expect(frameGaps([{ wallMs: 10, simMs: 0 }, { wallMs: 110, simMs: 50 },
      { wallMs: 211, simMs: 100 }])).toEqual([
      { fromWallMs: 110, toWallMs: 211, simMs: 100, gapMs: 101 },
    ]);
  });
});
