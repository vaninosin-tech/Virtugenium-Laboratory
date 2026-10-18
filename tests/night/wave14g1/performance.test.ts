import { writeFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import * as THREE from "three";
import { TubeSilverField } from "../../../src/scenes/laboratory/lib/tubeSilverField";
import { tubeVessel } from "../../../src/scenes/laboratory/lib/vesselGeometry";

const stats = (samples: number[]) => {
  const sorted = samples.slice().sort((a, b) => a - b);
  return { p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)],
    peak: sorted.at(-1), mean: samples.reduce((a, b) => a + b, 0) / samples.length };
};

describe("silver geometry cost, 20 warm-up + 200 measured steps", () => {
  it("records actual stage-three LOW and HIGH CPU timings", () => {
    vi.stubGlobal("window", { location: { search: "?silverStage=3" } });
    const result: Record<string, unknown> = {};
    try {
      for (const quality of ["LOW", "HIGH"] as const) {
        const field = new TubeSilverField(quality, tubeVessel.innerRadius, 0,
          tubeVessel.heightFromVolume(tubeVessel.capacityMl));
        const up = new THREE.Vector3(0, 1, 0);
        const level = tubeVessel.heightFromVolume(2.5);
        const inlet = new THREE.Vector3(0.004, level - 0.001, 0);
        const step = (kind: "advance" | "solver" | "transport") => {
          if (kind === "advance") field.advance(0.05, up, level, inlet, 0);
          else if (kind === "solver") field.solver.step(0.05, inlet, new THREE.Vector3(0, -1, 0), 0, 0);
          else field.solver.transport(field.tracer, 0.05, 1e-9);
        };
        const costs: Record<string, ReturnType<typeof stats>> = {};
        for (const kind of ["advance", "solver", "transport"] as const) {
          const samples: number[] = [];
          for (let i = 0; i < 220; i++) {
            const start = performance.now();
            step(kind);
            if (i >= 20) samples.push(performance.now() - start);
          }
          costs[kind] = stats(samples);
        }
        const cells = field.mask.data.length;
        result[quality] = { dimensions: [field.mask.nx, field.mask.ny, field.mask.nz], cells,
          active: field.mask.activeCount, textureBytes: field.pixels.byteLength + field.densePixels.byteLength
            + field.overlapPixels.byteLength + field.tintPixels.byteLength + field.chipPixels.byteLength, costs };
        field.dispose();
      }
    } finally { vi.unstubAllGlobals(); }
    writeFileSync("docs/night/wave14g1/performance.json", JSON.stringify(result, null, 2));
  }, 120000);
});
