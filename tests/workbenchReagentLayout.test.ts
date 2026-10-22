import { describe, expect, it } from "vitest";
import { computeWorkbenchReagentSlotOffsets, useWorkbenchReagentAreaStore } from "../src/scenes/laboratory/lib/useWorkbenchReagentAreaStore";
import { useStopperHolderStore } from "../src/scenes/laboratory/lib/useStopperHolderStore";

describe("count-centered workbench reagents", () => {
  const config = useWorkbenchReagentAreaStore.getState().config;
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("centers %i jars with equal clearance", (count) => {
    const positions = computeWorkbenchReagentSlotOffsets(config, count);
    const xs = positions.map(p => p[0]).sort((a, b) => a - b);
    expect(xs.reduce((sum, x) => sum + x, 0) / count).toBeCloseTo(config.originX);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(config.spacingX);
    const leftGap = xs[0] - 0.055 - (-0.7065);
    const rightGap = 0.27505 - (xs[count - 1] + 0.055);
    expect(leftGap).toBeGreaterThan(0);
    expect(leftGap).toBeCloseTo(rightGap);
  });
  it("keeps the moved rack clear of the sink", () => {
    const holder = useStopperHolderStore.getState().holders.workbench;
    expect(holder.x).toBe(0.46);
    expect(0.665 - (holder.x + 0.18495 * holder.scale)).toBeGreaterThan(0.02);
  });
});
