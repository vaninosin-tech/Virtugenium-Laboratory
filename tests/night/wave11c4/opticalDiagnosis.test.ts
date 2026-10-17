import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { marchSilverFine, SILVER_FINE_OPTICS, type SilverFineDump } from "../../../src/scenes/laboratory/lib/night/render/silverOpticsReference";

describe("wave 11 frozen field optical diagnosis", () => {
  it("measures depth and background contrast from every shared dump", () => {
    const directory = "docs/night/wave11shared";
    const rows = readdirSync(directory).filter(name => /^field_state_\d+ms\.json$/.test(name)).map(name => {
      const dump = JSON.parse(readFileSync(`${directory}/${name}`, "utf8")) as SilverFineDump & { t: number };
      const rays = [];
      for (const y of [0.01, 0.02, 0.03, 0.04]) for (const x of [-0.003, 0, 0.003]) {
        if (y > (dump.level ?? 0)) continue;
        const modes = [0, 1, 2, 3].map(mode => marchSilverFine(dump, [x, y, 3 * dump.radius], [0, 0, -1], mode as 0 | 1 | 2 | 3));
        const [r, , , alpha] = modes[0];
        const tau = -Math.log(Math.max(1e-12, 1 - alpha));
        const composite = (background: number) => r * alpha + background * (1 - alpha);
        rays.push({ tau, alpha, rawAlpha: modes[1][3], extinction: modes[2][0] * modes[2][3],
          scattering: modes[3][0] * modes[3][3], black: composite(0), gray: composite(0.5), window: composite(0.9),
          contrastBlack: composite(0), contrastGray: composite(0.5) - 0.5, contrastWindow: composite(0.9) - 0.9 });
      }
      const sorted = rays.map(r => r.tau).sort((a, b) => a - b);
      const mean = (key: keyof typeof rays[number]) => rays.reduce((sum, ray) => sum + ray[key], 0) / rays.length;
      return { ms: dump.t, maxTau: sorted.at(-1), medianTau: sorted[Math.floor(sorted.length / 2)],
        meanBlack: mean("black"), meanGray: mean("gray"), meanWindow: mean("window"),
        meanContrastBlack: mean("contrastBlack"), meanContrastGray: mean("contrastGray"),
        meanContrastWindow: mean("contrastWindow"), meanRawAlpha: mean("rawAlpha"),
        meanExtinction: mean("extinction"), meanScattering: mean("scattering") };
    }).sort((a, b) => a.ms - b.ms);
    console.log("WAVE11_OPTICS", JSON.stringify({ kappa: SILVER_FINE_OPTICS.kappa, rows }));
    expect(rows.length).toBe(7);
    expect(rows.every(row => Number.isFinite(row.maxTau) && row.maxTau! >= 0)).toBe(true);
  });
});
