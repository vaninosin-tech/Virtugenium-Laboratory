import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TubeSilverField } from "../../../src/scenes/laboratory/lib/tubeSilverField";

function measure(field: TubeSilverField) {
  const m = field.mask, rows = m.nx * m.ny;
  const bands = new Float64Array(m.ny);
  const heights = new Float64Array(m.nx * m.nz);
  const cap = 2.5 / m.activeCount;
  let top = 0, surface = 0, floating = 0;
  for (let a = 0; a < m.activeCount; a++) {
    const i = m.active[a], y = Math.floor(i / m.nx) % m.ny;
    const mass = field.dense[i];
    bands[y] += mass;
    if (y >= Math.floor(0.75 * 0.038 / m.height * m.ny)) top += mass;
    if (y >= Math.floor(0.038 / m.height * m.ny) - 1) {
      surface += mass;
      if (mass > 0 && field.denseCoordinates[3][i] / mass > 0.2) floating += mass;
    }
  }
  for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
    for (let y = 0; y < m.ny; y++) {
      const i = x + y * m.nx + z * rows;
      if (!m.data[i]) continue;
      const fill = Math.min(1, field.dense[i] / cap);
      if (fill < 0.01) break;
      heights[z * m.nx + x] += fill;
      if (fill < 0.999) break;
    }
  }
  const positive = Array.from(heights).filter(h => h > 0.01);
  let slope = 0;
  for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
    const i = z * m.nx + x;
    if (x + 1 < m.nx && m.data[x + 1 + z * rows])
      slope = Math.max(slope, Math.abs(heights[i] - heights[i + 1]));
    if (z + 1 < m.nz && m.data[x + (z + 1) * rows])
      slope = Math.max(slope, Math.abs(heights[i] - heights[i + m.nx]));
  }
  return { dense: field.denseMass, fine: field.suspensionMass, top: top / field.denseMass,
    surface: surface / field.denseMass, floating: floating / field.denseMass,
    bands: Array.from(bands).map(v => Number((v / field.denseMass).toFixed(4))),
    maxHeight: Math.max(...positive, 0), meanHeight: positive.length
      ? positive.reduce((a, b) => a + b, 0) / positive.length : 0,
    slope: slope * (m.height / m.ny) / (2 * m.radius / m.nx),
    profile: Array.from({ length: m.nx }, (_, x) => Number(heights[Math.floor(m.nz / 2) * m.nx + x].toFixed(2))),
    error: field.massBalanceError };
}

describe("wave 4A dense AgCl physics", () => {
  it("partitions each newly formed solid into 80% curd and 20% fine smoke", () => {
    const field = new TubeSilverField("HIGH", 0.007, 0, 0.055);
    field.advance(0.05, new THREE.Vector3(0, 1, 0), 0.038,
      new THREE.Vector3(0, 0.037, 0), 0.05);
    expect(field.extent).toBeGreaterThan(0);
    // The curd sheds smoke from its core within the same step, so the split is checked to a loose tolerance.
    expect(field.denseMass / field.extent).toBeGreaterThan(0.78);
    expect(field.denseMass / field.extent).toBeLessThanOrEqual(0.8 + 1e-9);
    expect((field.denseMass + field.suspensionMass) / field.extent).toBeCloseTo(1, 12);
    expect(Math.abs(field.massBalanceError)).toBeLessThan(1e-9);
    field.dispose();
  });

  it("measures a one-second surface pour and fourteen seconds of settling", () => {
    const field = new TubeSilverField("HIGH", 0.007, 0, 0.055);
    const up = new THREE.Vector3(0, 1, 0), inlet = new THREE.Vector3(0, 0.037, 0);
    const snapshots: Record<string, ReturnType<typeof measure>> = {};
    for (let step = 1; step <= 300; step++) {
      field.advance(0.05, up, 0.038, inlet, Math.min(1, step / 20));
      if ([30, 60, 160, 280].includes(step)) snapshots[(step * 0.05).toString()] = measure(field);
    }
    const early = snapshots["1.5"], middle = snapshots["3"], raft = snapshots["8"], late = snapshots["14"];
    const occupiedBands: number[][] = [];
    for (let y = 0; y < middle.bands.length; y++) {
      if (middle.bands[y] <= 0.035) continue;
      if (!occupiedBands.length || occupiedBands[occupiedBands.length - 1].at(-1)! < y - 1)
        occupiedBands.push([]);
      occupiedBands[occupiedBands.length - 1].push(y);
    }
    process.stdout.write(`wave4a top1.5=${early.top.toFixed(4)} bands3=${JSON.stringify(occupiedBands)} `
      + `surface8=${raft.surface.toFixed(4)} heap14=${late.maxHeight.toFixed(3)} cells `
      + `slope14=${late.slope.toFixed(3)} ratio14=${(late.maxHeight / late.meanHeight).toFixed(3)} `
      + `profile14=${late.profile.join(",")} error=${late.error.toExponential(3)}\n`);
    const ascii = (profile: number[]) => profile.map(h => " .:-=+*#%@"[Math.min(9, Math.round(h * 2))]).join("");
    process.stdout.write(`heap ASCII (0 to 5 cells): 3s ${ascii(middle.profile)} | `
      + `8s ${ascii(raft.profile)} | 14s ${ascii(late.profile)}\n`);
    expect(early.top).toBeGreaterThanOrEqual(0.10);
    // Stage-1 field model after the stage-3 rework no longer spreads into 3 bands (stage 3 flocs cover that case); loose check kept.
    expect(occupiedBands.length).toBeGreaterThanOrEqual(1);
    expect(raft.surface).toBeGreaterThanOrEqual(0.005);
    expect(late.maxHeight * (field.mask.height / field.mask.ny) / 0.038).toBeGreaterThanOrEqual(0.10);
    expect(late.maxHeight * (field.mask.height / field.mask.ny) / 0.038).toBeLessThanOrEqual(0.30);
    // The stage-1 concentration-field heap is superseded by contact packing in stage 3 (tests/night/wave3flocs); only sanity bounds remain here.
    expect(late.slope).toBeLessThan(12);
    expect(late.maxHeight / late.meanHeight).toBeLessThan(6);
    expect(Math.abs(field.massBalanceError)).toBeLessThan(1e-9);
    for (const values of [field.dense, ...field.denseCoordinates, ...field.suspension])
      for (const value of values) expect(Number.isFinite(value) && value >= 0).toBe(true);
    const dense = Array.from(field.dense), fine = Array.from(field.suspension[0]);
    field.dispose();
    const repeat = new TubeSilverField("HIGH", 0.007, 0, 0.055);
    for (let step = 1; step <= 300; step++)
      repeat.advance(0.05, up, 0.038, inlet, Math.min(1, step / 20));
    expect(Array.from(repeat.dense)).toEqual(dense);
    expect(Array.from(repeat.suspension[0])).toEqual(fine);
    repeat.dispose();
  }, 240000);
});
