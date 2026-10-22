import { beforeEach, describe, expect, it } from "vitest";

import { tubeHolds, useTestTubeStorageStore } from "./useTestTubeStorageStore";

const add = useTestTubeStorageStore.getState().addTubeContents;
const workbench = () => useTestTubeStorageStore.getState().workbenchTestTubes;
const hood = () => useTestTubeStorageStore.getState().fumeHoodTestTubes;

beforeEach(() => {
  useTestTubeStorageStore.setState({
    trayTestTubes: [],
    workbenchTestTubes: [
      { instanceId: "w0", contents: [] },
      { instanceId: "w1", contents: ["cu"] },
    ],
    fumeHoodTestTubes: [{ instanceId: "h0", contents: ["cu"] }],
  });
});

describe("addTubeContents", () => {
  it("pours acid on top of the copper instead of replacing it", () => {
    add("fumeHood", 0, "hno3");
    expect(hood()[0]?.contents).toEqual(["cu", "hno3"]);
  });

  it("keeps the pouring order, which is what the mixing rules read", () => {
    add("workbench", 0, "hno3");
    add("workbench", 0, "cu");
    expect(workbench()[0]?.contents).toEqual(["hno3", "cu"]);
  });

  it("ignores a reagent already in the tube", () => {
    add("fumeHood", 0, "cu");
    expect(hood()[0]?.contents).toEqual(["cu"]);
  });

  it("treats the index as relative to the named location", () => {
    add("fumeHood", 0, "hno3");
    expect(hood()[0]?.contents).toEqual(["cu", "hno3"]);
    expect(workbench()[0]?.contents).toEqual([]);
  });

  it("ignores an index with no tube behind it", () => {
    add("workbench", 7, "hno3");
    expect(workbench()).toHaveLength(2);
  });

  it("leaves the other tubes alone", () => {
    add("workbench", 0, "hno3");
    expect(workbench()[1]?.contents).toEqual(["cu"]);
  });
});

describe("pourBetweenTubes", () => {
  const pour = useTestTubeStorageStore.getState().pourBetweenTubes;

  beforeEach(() => {
    useTestTubeStorageStore.setState({
      fumeHoodTestTubes: [
        { instanceId: "h0", contents: ["cu"] },
        { instanceId: "h1", contents: ["hno3"] },
      ],
    });
  });

  it("empties the acid tube onto the copper", () => {
    pour("fumeHood", 1, 0);
    expect(hood()[0]?.contents).toEqual(["cu", "hno3"]);
    expect(hood()[1]?.contents).toEqual([]);
  });

  it("appends in order, so the receiving tube still records what went in when", () => {
    useTestTubeStorageStore.setState({
      fumeHoodTestTubes: [
        { instanceId: "h0", contents: ["na2so3"] },
        { instanceId: "h1", contents: ["h2so4", "kmno4"] },
      ],
    });
    pour("fumeHood", 1, 0);
    expect(hood()[0]?.contents).toEqual(["na2so3", "h2so4", "kmno4"]);
  });

  it("does not duplicate what the target already holds", () => {
    useTestTubeStorageStore.setState({
      fumeHoodTestTubes: [
        { instanceId: "h0", contents: ["cu", "hno3"] },
        { instanceId: "h1", contents: ["hno3"] },
      ],
    });
    pour("fumeHood", 1, 0);
    expect(hood()[0]?.contents).toEqual(["cu", "hno3"]);
    expect(hood()[1]?.contents).toEqual([]);
  });

  it("ignores an empty source, a missing tube and pouring into itself", () => {
    pour("fumeHood", 0, 0);
    expect(hood()[0]?.contents).toEqual(["cu"]);
    useTestTubeStorageStore.setState({
      fumeHoodTestTubes: [
        { instanceId: "h0", contents: ["cu"] },
        { instanceId: "h1", contents: [] },
      ],
    });
    pour("fumeHood", 1, 0);
    expect(hood()[0]?.contents).toEqual(["cu"]);
    pour("fumeHood", 9, 0);
    expect(hood()[0]?.contents).toEqual(["cu"]);
  });
});

describe("tubeHolds", () => {
  it("finds a reagent anywhere in the mixture", () => {
    add("fumeHood", 0, "hno3");
    expect(tubeHolds(hood()[0], "cu")).toBe(true);
    expect(tubeHolds(hood()[0], "hno3")).toBe(true);
  });

  it("is false for an absent reagent and for no tube at all", () => {
    expect(tubeHolds(hood()[0], "h2so4")).toBe(false);
    expect(tubeHolds(undefined, "cu")).toBe(false);
  });
});
