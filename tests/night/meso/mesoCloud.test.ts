import { describe, expect, it } from "vitest";
import { MesoCloud, type MesoMask } from "../../../src/scenes/laboratory/lib/night/meso/mesoCloud";

const NX = 8, NY = 12, NZ = 4, H = 0.002;
function mask(): MesoMask {
  const data = new Uint8Array(NX * NY * NZ).fill(1);
  const active = Int32Array.from({ length: data.length }, (_, i) => i);
  return { nx: NX, ny: NY, nz: NZ, data, active, activeCount: data.length };
}
/** Divergence-free closed-box vortex in x-y from a stream function that vanishes on the walls. */
function vortex(amp: number) {
  const n = NX * NY * NZ, u = new Float32Array(n), v = new Float32Array(n), w = new Float32Array(n);
  const psi = (x: number, y: number) => amp * Math.sin(Math.PI * x / NX) ** 2 * Math.sin(Math.PI * y / NY) ** 2;
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = (z * NY + y) * NX + x;
    u[i] = (psi(x + 1, y + 1) - psi(x + 1, y)) / H;       // + x face: dpsi/dy
    v[i] = -(psi(x + 1, y + 1) - psi(x, y + 1)) / H;      // + y face: -dpsi/dx
  }
  return [u, v, w];
}
function blob(m: MesoCloud, amount: number) {
  const a = new Float64Array(NX * NY * NZ);
  for (let z = 0; z < NZ; z++) for (let y = 7; y < 9; y++) for (let x = 2; x < 4; x++) a[(z * NY + y) * NX + x] = amount;
  m.addFromCoarse(a); return a;
}

describe("MesoCloud prototype", () => {
  it("restriction returns exactly the coarse amounts that were added", () => {
    const m = new MesoCloud(mask(), 3), a = blob(m, 0.37), out = m.restrictTo(new Float64Array(a.length));
    for (let i = 0; i < a.length; i++) expect(out[i]).toBeCloseTo(a[i], 14);
  });
  it("conserves mass to 1e-12 and stays non-negative under a closed vortex", () => {
    const m = new MesoCloud(mask(), 3); blob(m, 0.37);
    const m0 = m.mass, f = vortex(2e-6);
    let negative = 0;
    for (let s = 0; s < 400; s++) {
      m.advect(f, 0.05, [H, H, H], 1e-9);
      for (let i = 0; i < m.values.length; i++) if (m.values[i] < 0) negative++;
    }
    expect(Math.abs(m.mass - m0) / m0).toBeLessThan(1e-12);
    expect(negative).toBe(0);
  });
  it("a closed flow keeps mass inside walls (no export through boundary)", () => {
    const m = new MesoCloud(mask(), 2); blob(m, 1);
    for (let s = 0; s < 100; s++) m.advect(vortex(3e-6), 0.05, [H, H, H], 0);
    expect(m.restrictTo(new Float64Array(NX * NY * NZ)).reduce((a, b) => a + b, 0)).toBeCloseTo(m.mass, 12);
  });
  it("stretching: the refined grid keeps a thinner filament than the coarse one", () => {
    const run = (r: number) => {
      const m = new MesoCloud(mask(), r); blob(m, 1);
      for (let s = 0; s < 300; s++) m.advect(vortex(4e-6), 0.05, [H, H, H], 0);
      return m.values.reduce((a, b) => a + (b > 0 ? 1 : 0), 0) / m.cellCount;   // wetted share of the box
    };
    // Same flow, same mass: finer grid resolves the filament, so the cloud is more concentrated, not more diffused.
    const peak = (r: number) => { const m = new MesoCloud(mask(), r); blob(m, 1); for (let s = 0; s < 300; s++) m.advect(vortex(4e-6), 0.05, [H, H, H], 0); return m.components(0.25).peak * r ** 3; };
    expect(peak(3)).toBeGreaterThan(peak(1));
    expect(run(3)).toBeGreaterThan(0);
  });
  it("separation emerges from transport only: a bar pulled in x and squeezed in y necks and splits", () => {
    const m = new MesoCloud(mask(), 3);
    const a = new Float64Array(NX * NY * NZ);
    // Bar with a slightly thinner middle (a seed of a neck, not a separate object).
    for (let z = 0; z < NZ; z++) for (let y = 5; y < 7; y++) for (let x = 1; x < 7; x++) a[(z * NY + y) * NX + x] = (x === 3 || x === 4) ? 0.8 : 1;
    m.addFromCoarse(a);
    const c0 = m.components(0.25).count, m0 = m.mass;
    // Planar extension: u = s (x - xc), v = -s (y - yc), divergence free in the interior; faces at walls are not used.
    const n = NX * NY * NZ, u = new Float32Array(n), v = new Float32Array(n), w = new Float32Array(n), s = 0.35;
    for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const i = (z * NY + y) * NX + x;
      u[i] = s * ((x + 1) * H - NX * H / 2); v[i] = -s * ((y + 1) * H - NY * H / 2);
    }
    for (let k = 0; k < 120; k++) m.advect([u, v, w], 0.05, [H, H, H], 0);
    expect(c0).toBe(1);
    expect(m.components(0.25).count).toBeGreaterThan(1);
    expect(Math.abs(m.mass - m0) / m0).toBeLessThan(1e-12);
  });
  it("syncMask moves mass of dried cells into wet ones without loss", () => {
    const mk = mask(), m = new MesoCloud(mk, 2); blob(m, 1);
    const before = m.mass;
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) mk.data[(z * NY + 8) * NX + x] = 0;
    m.syncMask();
    expect(m.mass).toBeCloseTo(before, 12);
    for (let i = 0; i < m.values.length; i++) if (!m.wet[i]) expect(m.values[i]).toBe(0);
  });
});
