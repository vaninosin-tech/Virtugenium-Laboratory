import { afterAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { appendFileSync } from "node:fs";

afterAll(() => { delete (globalThis as { window?: unknown }).window; });

describe("stage 3 floc performance and conservation", () => {
  it("profiles owned floc work over the first 4 s at HIGH", async () => {
    (globalThis as { window?: unknown }).window = { __silverStage: 3 };
    const { TubeSilverField } = await import("../../../src/scenes/laboratory/lib/tubeSilverField");
    const { FlocSystem } = await import("../../../src/scenes/laboratory/lib/night/stage1/flocSystem");
    const names = ["addMass", "erode", "step", "rasterize"] as const;
    const totals: Record<string, number> = {};
    const originals = names.map(name => FlocSystem.prototype[name]);
    for (let i = 0; i < names.length; i++) {
      const name = names[i], original = originals[i];
      // Instrument only this local measurement; restore the prototype before the other cases run.
      (FlocSystem.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = function (...args: unknown[]) {
        const start = performance.now();
        const result = (original as (...args: unknown[]) => unknown).apply(this, args);
        totals[name] = (totals[name] ?? 0) + performance.now() - start;
        return result;
      };
    }
    try {
      const f = new TubeSilverField("HIGH", 0.007, 0, 0.034);
      const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
      const inlet = new THREE.Vector3(0.007 * 0.7, 0.0262, 0);
      let advance = 0;
      for (let k = 0; k < 80; k++) {
        const t = (k + 1) / 20, level = 0.0262 + 0.0016 * Math.min(1, t / 3);
        inlet.y = level;
        const start = performance.now();
        f.advance(0.05, up, level, inlet, Math.min(1, t / 3), 0, t <= 3 ? 0.33 : 0, down);
        advance += performance.now() - start;
      }
      if (process.env.WAVE6PERF_RECORD)
        appendFileSync("docs/night/wave6perf/profile.jsonl", `${JSON.stringify({ advance, ...totals })}\n`);
    } finally {
      for (let i = 0; i < names.length; i++)
        (FlocSystem.prototype as unknown as Record<string, unknown>)[names[i]] = originals[i];
    }
  }, 120000);
  for (const quality of ["LOW", "HIGH"] as const) {
    it(`${quality}: 3 s pour and 14 s total`, async () => {
      (globalThis as { window?: unknown }).window = { __silverStage: 3 };
      const { TubeSilverField } = await import("../../../src/scenes/laboratory/lib/tubeSilverField");
      const f = new TubeSilverField(quality, 0.007, 0, 0.034);
      const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
      const inlet = new THREE.Vector3(0.007 * 0.7, 0.0262, 0);
      const elapsed: number[] = [];
      let worstBalance = 0;
      for (let k = 0; k < 280; k++) {
        const t = (k + 1) / 20;
        const level = 0.0262 + 0.0016 * Math.min(1, t / 3);
        inlet.y = level;
        const start = performance.now();
        f.advance(0.05, up, level, inlet, Math.min(1, t / 3), 0, t <= 3 ? 0.33 : 0, down);
        elapsed.push(performance.now() - start);
        worstBalance = Math.max(worstBalance, Math.abs(f.massBalanceError));
      }
      const sorted = [...elapsed].sort((a, b) => a - b);
      const nodes = f.flocSystem.nodes;
      const heights = nodes.map(n => n.y).sort((a, b) => a - b);
      const mean = (key: "x" | "y" | "z") => nodes.reduce((s, n) => s + n[key], 0) / nodes.length;
      const result = { quality, msMean: elapsed.reduce((a, b) => a + b, 0) / elapsed.length,
        msP95: sorted[Math.ceil(0.95 * sorted.length) - 1], totalMass: f.totalSolidMass,
        flocMass: f.flocSystem.totalMass, nodeCount: nodes.length,
        medianHeight: heights[Math.floor(heights.length / 2)], meanX: mean("x"), meanY: mean("y"), meanZ: mean("z"),
        worstBalance };
      if (process.env.WAVE6PERF_RECORD)
        appendFileSync("docs/night/wave6perf/measurements.jsonl", `${JSON.stringify(result)}\n`);
      expect(worstBalance).toBeLessThan(1e-9);
      expect(nodes.every(n => Number.isFinite(n.x + n.y + n.z + n.mass))).toBe(true);
      if (quality === "HIGH") {
        expect(Math.abs(result.totalMass - 0.541659166404985)).toBeLessThan(1e-12);
        expect(result.nodeCount).toBe(259);
        expect(Math.abs(result.medianHeight - 0.005313219702339795)).toBeLessThan(0.005313219702339795 * 0.05);
        expect(Math.abs(result.meanX - 0.00003572888030355774)).toBeLessThan(0.0002);
        expect(Math.abs(result.meanY - 0.008237669009417877)).toBeLessThan(0.0002);
        expect(Math.abs(result.meanZ - -0.0010756035481744868)).toBeLessThan(0.0002);
      }
    }, 180000);
  }
});
