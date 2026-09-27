import { describe, expect, it } from "vitest";

import { reactionKindFor, reactionTriggerFor } from "./tubeReactions";

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
