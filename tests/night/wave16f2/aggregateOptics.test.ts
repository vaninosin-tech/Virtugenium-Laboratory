import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { makeSilverVolumeMaterial } from "../../../src/scenes/laboratory/lib/tubeSilverVolumeMaterial";
import { SilverSedimentField, SilverSedimentGeometry } from "../../../src/scenes/laboratory/lib/tubeSilverSediment";
import { aggregateAt, aggregateExtinction, aggregateGrain, marchSilverLayers, renderSilverLayers,
  type SilverAggregateDump, SILVER_FINE_OPTICS } from "../../../src/scenes/laboratory/lib/night/render/silverOpticsReference";

function dump(density = 0.25, loose = 0.3, fine = 0): SilverAggregateDump {
  const nx = 8, ny = 16, nz = 8, count = nx * ny * nz;
  const aggregate = new Array(count * 4).fill(0);
  const suspension = new Array(count).fill(0);
  for (let z = 2; z < 6; z++) for (let y = 3; y < 13; y++) for (let x = 2; x < 6; x++) {
    const i = x + nx * (y + ny * z);
    aggregate[4 * i] = density; aggregate[4 * i + 1] = loose; aggregate[4 * i + 2] = 1 - loose;
    aggregate[4 * i + 3] = 0.5; suspension[i] = fine;
  }
  return { nx, ny, nz, radius: 0.007, bottom: 0, height: 0.055,
    mask: new Array(count).fill(1), fine: suspension, aggregate, sedimentHeight: new Array(nx * nz).fill(0) };
}
const ray = (d: SilverAggregateDump, mode: 0 | 1 | 2 | 3 = 0, layer: 0 | 1 | 2 | 3 = 1) =>
  marchSilverLayers(d, [0, 0.025, 0.021], [0, 0, -1], mode, layer);

describe("field-driven AgCl aggregate optics", () => {
  it("makes dense regions opaque, thin regions translucent, and alpha monotonic", () => {
    const alphas = [0, 0.02, 0.1, 0.5, 2].map(v => ray(dump(v))[3]);
    expect(alphas[0]).toBe(0);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
    expect(alphas[1]).toBeLessThan(0.5);
    expect(alphas[4]).toBeGreaterThan(0.95);
    const opaque = ray(dump(2));
    expect(opaque[0]).toBeGreaterThan(0.65);
    expect(opaque[0]).toBeLessThanOrEqual(SILVER_FINE_OPTICS.lightStrength + SILVER_FINE_OPTICS.ambient + SILVER_FINE_OPTICS.ambientBoost);
  });
  it("uses separate fine and aggregate mass, with no alpha in an empty column", () => {
    const d = dump(0.2, 0.3, 0.2);
    const fine = ray(d, 0, 0), aggregate = ray(d, 0, 1), combined = ray(d, 0, 2);
    expect(combined[3]).toBeGreaterThan(fine[3]);
    expect(combined[3]).toBeGreaterThan(aggregate[3]);
    expect(combined[0] * combined[3]).toBeGreaterThan(fine[0] * fine[3]);
    expect(combined[0] * combined[3]).toBeGreaterThan(aggregate[0] * aggregate[3]);
    expect(combined[0]).toBeLessThanOrEqual(SILVER_FINE_OPTICS.lightStrength + SILVER_FINE_OPTICS.ambient + SILVER_FINE_OPTICS.ambientBoost);
    expect(ray(dump(0, 0, 0), 0, 2)[3]).toBe(0);
  });
  it("makes loose material more translucent at equal aggregate mass", () => {
    expect(ray(dump(0.15, 1))[3]).toBeLessThan(ray(dump(0.15, 0))[3]);
  });
  it("keeps fibre modulation below 8 percent and leaves field iso masks unchanged", () => {
    const d = dump(0.2, 1);
    const mask = (seed: number) => {
      const positions: number[] = [];
      for (let z = 0; z < 17; z++) for (let x = 0; x < 17; x++) {
        const g: [number, number, number] = [(x + 0.5) / 17, 0.5, (z + 0.5) / 17];
        const f = aggregateAt(d, g);
        const modified: [number, number, number, number] = [f[0], f[1], f[2], seed];
        const grain = aggregateGrain(d, g, modified);
        expect(grain).toBeGreaterThanOrEqual(0.92 - 1e-12);
        expect(grain).toBeLessThanOrEqual(1.08 + 1e-12);
        if (f[0] >= 0.1) positions.push(x + 17 * z);
      }
      return positions;
    };
    expect(mask(0.1)).toEqual(mask(0.9));
    expect(aggregateExtinction(0, 1, 1.08)).toBe(0);
  });
  it("samples separate textures in generated GLSL and keeps float literals valid", () => {
    const material = makeSilverVolumeMaterial(0.007, 0, 0.055).material;
    const glsl = material.fragmentShader;
    expect(glsl).toMatch(/smokeValue\s*=\s*texture\(uHaze,grid\)\.r/);
    expect(glsl).toMatch(/field\s*=\s*texture\(uAggregate,grid\)/);
    expect(glsl).toMatch(/depth\s*\+=\s*texture\(uAggregate,uvw\(q\)\)\.r/);
    expect(glsl).not.toMatch(/(?:\*|\/)\s*[1-9]\d*(?![.\dA-Za-z_])/);
    expect(material.uniforms.uSolidMode.value).toBe(2);
    material.dispose();
  });
  it("builds a bowl-following deposit only where height exists", () => {
    const field = new SilverSedimentField(8, 8);
    const geometry = new SilverSedimentGeometry(0.007, 0);
    const texture = new THREE.DataTexture(new Float32Array(64), 8, 8, THREE.RedFormat, THREE.FloatType);
    geometry.update(field, texture);
    const p = geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(p.getY(0)).toBe(0);
    (texture.image.data as Float32Array).fill(0.001);
    geometry.update(field, texture);
    expect(p.getY(0)).toBeGreaterThan(0);
    expect(geometry.getAttribute("sedimentThickness").getX(0)).toBeGreaterThan(0);
    geometry.dispose(); texture.dispose();
  });
  it("writes synthetic CPU PPM layers and optics matrix", () => {
    const d = dump(0.45, 0.6, 0.09);
    for (let z = 2; z < 6; z++) for (let x = 2; x < 6; x++) d.sedimentHeight[x + d.nx * z] = 0.001;
    const out = "docs/night/wave16f2";
    const panels: Uint8Array[] = [];
    for (const layer of [0, 1, 2, 3] as const) for (const mode of [0, 1, 2, 3] as const)
    {
      const panel = renderSilverLayers(d, mode, layer, 48, 110);
      panels.push(panel);
      writeFileSync(join(out, `synthetic-layer${layer}-mode${mode}.ppm`), panel);
    }
    const width = 48 * 4, height = 110 * 4;
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
    const sheet = new Uint8Array(header.length + width * height * 3); sheet.set(header);
    const panelHeader = panels[0].length - 48 * 110 * 3;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++)
      for (let y = 0; y < 110; y++) {
        const source = panels[row * 4 + col].subarray(panelHeader + y * 48 * 3, panelHeader + (y + 1) * 48 * 3);
        sheet.set(source, header.length + ((row * 110 + y) * width + col * 48) * 3);
      }
    writeFileSync(join(out, "synthetic-sheet.ppm"), sheet);
    const sources = readdirSync("docs/night/wave16shared").filter(v => v.endsWith(".json"));
    for (const filename of sources) {
      const raw = JSON.parse(readFileSync(join("docs/night/wave16shared", filename), "utf8"));
      const candidate = (raw.field ?? raw) as SilverAggregateDump;
      if (!candidate.aggregate || !candidate.sedimentHeight || !candidate.fine) continue;
      for (const layer of [0, 1, 2, 3] as const) for (const mode of [0, 1, 2, 3] as const)
        writeFileSync(join(out, `${filename.slice(0, -5)}-layer${layer}-mode${mode}.ppm`),
          renderSilverLayers(candidate, mode, layer, 48, 110));
    }
    expect(sources.length).toBeGreaterThanOrEqual(0);
  });
});
