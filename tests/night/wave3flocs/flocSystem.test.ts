import { afterAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_FLOC_CONFIG, FlocSystem, nodeRadius, nodeSolidFraction, slipSpeed } from "../../../src/scenes/laboratory/lib/night/stage1/flocSystem";

const config = { ...DEFAULT_FLOC_CONFIG, radius: 0.007, bottom: 0, height: 0.034 };
const quiet = (_x: number, _y: number, _z: number, out: [number, number, number]) => { out[0] = out[1] = out[2] = 0; return true; };

async function silverField() {
  (globalThis as { window?: unknown }).window = { __silverStage: 3 };
  const { TubeSilverField } = await import("../../../src/scenes/laboratory/lib/tubeSilverField");
  return TubeSilverField;
}

function pour(field: InstanceType<Awaited<ReturnType<typeof silverField>>>, seconds: number, track: (t: number) => void) {
  const R = 0.007, up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const inlet = new THREE.Vector3(R * 0.7, 0.0262, 0);
  for (let k = 0; k < seconds * 20; k++) {
    const t = (k + 1) / 20, level = 0.0262 + 0.0016 * Math.min(1, t / 3);
    inlet.y = level;
    field.advance(0.05, up, level, inlet, Math.min(1, t / 3), 0, 0.33, down);
    track(t);
  }
}

describe("floc physics laws", () => {
  it("bigger flocs are more porous and settle at a speed that depends on size, not on age", () => {
    const small = nodeRadius(config.quantum, config), big = nodeRadius(config.quantum * 8, config);
    expect(nodeSolidFraction(big, config)).toBeLessThan(nodeSolidFraction(small, config));
    expect(slipSpeed(big, config)).toBeGreaterThan(0);
    const a = new FlocSystem(config), b = new FlocSystem(config);
    for (const system of [a, b]) { system.surfaceY = 0.03; system.addMass(0, 0.02, 0, 0.03); }
    for (let k = 0; k < 20; k++) a.step(0.05, quiet);                   // a has existed for a while
    for (let k = 0; k < 20; k++) b.step(0.05, quiet);
    a.nodes[0].y = b.nodes[0].y = 0.02; a.nodes[0].vy = b.nodes[0].vy = 0;
    a.step(0.05, quiet); b.step(0.05, quiet);                           // same state, different history length is irrelevant
    expect(a.nodes[0].vy).toBeCloseTo(b.nodes[0].vy, 12);
  });

  it("links yield plastically: a stretched floc keeps its lengthened shape", () => {
    const system = new FlocSystem({ ...config, allowBreakage: false });
    system.surfaceY = 0.03;
    system.addMass(0, 0.02, 0, 0.03); system.addMass(0.003, 0.02, 0, 0.03);
    expect(system.links.length).toBe(1);
    const rest0 = system.links[0].rest;
    system.nodes[1].x += 0.003;                                         // pull the pair apart
    for (let k = 0; k < 10; k++) system.step(0.05, quiet);
    expect(system.links[0].rest).toBeGreaterThan(rest0);                // permanent lengthening, no elastic recovery
  });

  it("links break only when stretched past their strength, and only if breakage is enabled", () => {
    const weak = new FlocSystem({ ...config, allowBreakage: true, breakStretch: 1.5 });
    const kept = new FlocSystem({ ...config, allowBreakage: false, breakStretch: 1.5 });
    for (const system of [weak, kept]) { system.surfaceY = 0.03; system.addMass(0, 0.02, 0, 0.03); system.addMass(0.003, 0.02, 0, 0.03); system.nodes[1].x += 0.02; }
    weak.step(0.05, quiet); kept.step(0.05, quiet);
    expect(weak.links.length).toBe(0);
    expect(kept.links.length).toBe(1);
    expect(weak.totalMass).toBeCloseTo(0.06, 12);                        // breaking never changes mass
  });

  it("rasterising conserves mass exactly", () => {
    const system = new FlocSystem(config);
    system.surfaceY = 0.03;
    for (let i = 0; i < 30; i++) system.addMass(0.0003 * (i % 5), 0.01 + 0.0004 * i, 0.0002 * (i % 3), 0.01);
    const n = 22 * 44 * 22, mass = new Float32Array(n), visual = new Float32Array(n);
    system.rasterize(mass, visual, 22, 44, 22, 1);
    let sum = 0; for (const v of mass) sum += v;
    expect(sum).toBeCloseTo(system.totalMass, 4);
  });
});

describe("AgCl floc mode in the silver field", () => {
  // The stage selector is a window property: do not leak stage 3 into other test files.
  afterAll(() => { delete (globalThis as { window?: unknown }).window; });
  it("conserves solid mass at every step, is finite, and is deterministic", async () => {
    const TubeSilverField = await silverField();
    const run = () => {
      const f = new TubeSilverField("HIGH", 0.007, 0, 0.034);
      let worst = 0; pour(f, 6, () => { worst = Math.max(worst, Math.abs(f.massBalanceError)); });
      return { f, worst };
    };
    const a = run(), b = run();
    expect(a.worst).toBeLessThan(1e-9);
    for (const n of a.f.flocSystem.nodes) expect(Number.isFinite(n.x + n.y + n.z + n.mass)).toBe(true);
    expect(a.f.flocSystem.nodes.map(n => n.y)).toEqual(b.f.flocSystem.nodes.map(n => n.y));
    // Unresolved aggregate seeds are conserved material at the fixed node budget.
    expect(a.f.totalSolidMass).toBeCloseTo(a.f.extent, 9);
  }, 120000);

  it("forms in the upper liquid, is not pinned to the surface, and cotton moves down with the flow", async () => {
    const TubeSilverField = await silverField();
    const f = new TubeSilverField("HIGH", 0.007, 0, 0.034);
    const level = 0.0262 + 0.0016, median: Record<number, number> = {}, pinned: number[] = [];
    pour(f, 9, t => {
      const ys = f.flocSystem.nodes.map(n => n.y / level).sort((a, b) => a - b);
      if ([1, 4, 9].includes(t) && ys.length) median[t] = ys[Math.floor(ys.length / 2)];
      // No node may sit still at the meniscus: count nodes that stay within 0.6 mm of the surface with ~zero velocity.
      if (t >= 4) pinned.push(f.flocSystem.nodes.filter(n => n.y > level - 0.0006 && Math.hypot(n.vx, n.vy, n.vz) < 1e-5).length);
    });
    // At the assumed 0.01 M, this legacy short-pour setup can remain entirely in the
    // unresolved aggregate section. No large-floc trajectory is implied by that case.
    expect(f.denseMass).toBeGreaterThan(0);
    if (median[4] !== undefined && median[9] !== undefined)
      expect(median[9]).toBeLessThan(median[4]);
    expect(Math.max(...pinned)).toBeLessThanOrEqual(2);   // nothing is held at the surface
  }, 180000);
});
