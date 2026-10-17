import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { recordDelivery, clearDeliveries } from "../../../src/scenes/laboratory/lib/tubeDelivery";

// The runtime worker owns this module. Keep the assertions active as soon as it
// appears in a combined worktree; this isolated verify checkout lacks it.
const runtimePath = new URL("../../../src/scenes/laboratory/lib/tubeSilverRuntime.ts", import.meta.url);
const clockPath = new URL("../../../src/scenes/laboratory/lib/useStandMotionStore.ts", import.meta.url);
const available = existsSync(runtimePath);

describe("stage-3 delivery integration", () => {
  it.skipIf(!available)(available
    ? "one validated impact starts journal, field and chloride on the simulation clock"
    : "SKIP: tubeSilverRuntime.ts has not landed in the isolated verify worktree", async () => {
    vi.useFakeTimers();
    const tubeId = "wave9-validated-impact";
    const modulePath = runtimePath.href;
    const { silverRuntime } = await import(/* @vite-ignore */ modulePath);
    const clockModulePath = clockPath.href;
    const { simNowMs, setSimulationPaused } = await import(/* @vite-ignore */ clockModulePath);
    try {
      silverRuntime.reset(tubeId);
      clearDeliveries(tubeId);
      setSimulationPaused(false);
      // The receiving tube must exist in the store: the delivery event updates its composition atomically.
      const stores = await import(/* @vite-ignore */ new URL("../../../src/scenes/laboratory/lib/useTestTubeStorageStore.ts", import.meta.url).href);
      const amounts = await import(/* @vite-ignore */ new URL("../../../src/scenes/laboratory/lib/tubeAmounts.ts", import.meta.url).href);
      stores.useTestTubeStorageStore.setState({ fumeHoodTestTubes: [{ instanceId: tubeId, contents: ["agno3"] }], workbenchTestTubes: [] });
      amounts.resetTubeAmounts(); amounts.seedTubeAmounts(tubeId, ["agno3"]);
      expect(silverRuntime.field(tubeId) ?? null).toBeNull();
      // A pour is stamped like the game stamps it: serial = the pour start on the simulation clock, atMs = elapsed in it.
      const serial = simNowMs(), atMs = 0;
      const event = recordDelivery({ tubeId, reagentId: "nacl", serial, step: 0,
        ml: 0.05, point: { x: 0, y: 0.05, z: 0 }, surfaceY: 0.05, atMs },
      { axis: { x: 0, y: 0.05, z: 0 }, radius: 0.007, surfaceY: 0.05, hasLiquid: true });
      expect(event.valid).toBe(true);
      expect(silverRuntime.applyDelivery(event)).toBe(true);
      const field = silverRuntime.field(tubeId);
      expect(field).toBeTruthy();
      expect(silverRuntime.journal(tubeId)).toEqual([`${serial}|0`]);
      expect(silverRuntime.applyDelivery(event)).toBe(false);   // a repeated event id has no effect
      expect(silverRuntime.journal(tubeId)).toHaveLength(1);
      expect(field.species["Cl-"].total).toBeGreaterThan(0);
      const stamps = silverRuntime.diagnostics(tubeId);
      expect(stamps.firstValidImpactMs).toBe(atMs);
      expect(stamps.firstCompositionUpdateMs).toBe(atMs);
      expect(stamps.firstFieldInitMs).toBe(atMs);
      expect(stamps.firstChlorideInsertionMs).toBe(atMs);
      const before = field.ageSeconds;
      silverRuntime.tick(simNowMs() + 100);
      expect(field.ageSeconds).toBeGreaterThan(before);
      setSimulationPaused(true);
      const paused = field.ageSeconds;
      silverRuntime.tick(simNowMs());   // a paused simulation clock does not move, so neither does the field
      expect(field.ageSeconds).toBe(paused);
    } finally {
      setSimulationPaused(false);
      silverRuntime.reset(tubeId);
      clearDeliveries(tubeId);
      vi.useRealTimers();
    }
  });
});
