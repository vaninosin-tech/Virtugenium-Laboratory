import { describe, expect, it } from "vitest";

import { judgeMix } from "./mixingRules";

const EXP1 = "experiment-copper-nitric-acid";
const EXP2 = "experiment-silver-nitrate-sodium-chloride";
const EXP4 = "experiment-redox-permanganate-sulfite";

describe("judgeMix", () => {
  it("allows everything outside an assignment", () => {
    expect(judgeMix(null, ["hno3"], ["cu"]).kind).toBe("ok");
  });

  it("refuses a reagent the experiment does not use", () => {
    expect(judgeMix(EXP1, ["cu"], ["nacl"])).toEqual({ kind: "foreign", reagentId: "nacl" });
    expect(judgeMix(EXP1, [], ["nacl"]).kind).toBe("foreign");
  });

  it("lets an empty tube take any reagent of the experiment — the acid is prepared separately", () => {
    expect(judgeMix(EXP1, [], ["hno3"]).kind).toBe("ok");
  });

  it("experiment 1: acid onto copper is right, copper into acid is the charged mistake", () => {
    expect(judgeMix(EXP1, ["cu"], ["hno3"]).kind).toBe("ok");
    expect(judgeMix(EXP1, ["hno3"], ["cu"])).toEqual({
      kind: "wrong-order",
      reagentId: "cu",
      ruleId: "error-1-pour",
    });
  });

  it("experiment 2: either solution may go first", () => {
    expect(judgeMix(EXP2, ["agno3"], ["nacl"]).kind).toBe("ok");
    expect(judgeMix(EXP2, ["nacl"], ["agno3"]).kind).toBe("ok");
  });

  it("experiment 4: permanganate and acid in any order, sulfite last", () => {
    expect(judgeMix(EXP4, ["kmno4"], ["h2so4"]).kind).toBe("ok");
    expect(judgeMix(EXP4, ["h2so4"], ["kmno4"]).kind).toBe("ok");
    expect(judgeMix(EXP4, ["kmno4", "h2so4"], ["na2so3"]).kind).toBe("ok");
  });

  it("experiment 4: sulfite before the acid is wrong, and has no rule to charge", () => {
    expect(judgeMix(EXP4, ["kmno4"], ["na2so3"])).toEqual({
      kind: "wrong-order",
      reagentId: "na2so3",
      ruleId: undefined,
    });
    expect(judgeMix(EXP4, ["na2so3"], ["kmno4"]).kind).toBe("wrong-order");
  });

  it("judges a poured tube's contents one by one, in their order", () => {
    expect(judgeMix(EXP4, ["kmno4"], ["h2so4", "na2so3"]).kind).toBe("ok");
    expect(judgeMix(EXP4, ["kmno4"], ["na2so3", "h2so4"]).kind).toBe("wrong-order");
  });
});
