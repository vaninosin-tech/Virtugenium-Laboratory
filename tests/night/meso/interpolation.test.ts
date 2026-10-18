import { describe, expect, it } from 'vitest';
import { MesoCloud, type MesoMask } from '../../../src/scenes/laboratory/lib/night/meso/mesoCloud';

// The optimised stencil interpolation against the direct definition (linear along the normal between the two coarse faces,
// bilinear across it, a face exists only between two wet coarse cells), on a mask with dry cells and random face values.
const NX = 7, NY = 9, NZ = 6;
function reference(mask: MesoMask, r: number, coarse: Float32Array[], wet: Uint8Array, nx: number, ny: number, nz: number) {
  const dims = [mask.nx, mask.ny, mask.nz], fdims = [nx, ny, nz], out = [new Float32Array(nx * ny * nz), new Float32Array(nx * ny * nz), new Float32Array(nx * ny * nz)];
  const cidx = (x: number, y: number, z: number) => (z * mask.ny + y) * mask.nx + x;
  for (let axis = 0; axis < 3; axis++) {
    const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
    const U = (k: number, a: number, b: number) => {
      if (k <= 0 || k > dims[axis]) return 0;
      const c = [0, 0, 0]; c[axis] = k - 1; c[t1] = a; c[t2] = b;
      const idx = cidx(c[0], c[1], c[2]), n = [c[0], c[1], c[2]]; n[axis] += 1;
      if (!mask.data[idx] || n[axis] >= dims[axis] || !mask.data[cidx(n[0], n[1], n[2])]) return 0;
      return coarse[axis][idx];
    };
    for (let fz = 0; fz < nz; fz++) for (let fy = 0; fy < ny; fy++) for (let fx = 0; fx < nx; fx++) {
      const f = [fx, fy, fz], i = (fz * ny + fy) * nx + fx;
      if (!wet[i]) continue;
      const jn = [fx, fy, fz]; jn[axis] += 1;
      if (jn[axis] >= fdims[axis] || !wet[(jn[2] * ny + jn[1]) * nx + jn[0]]) continue;
      const X = (f[axis] + 1) / r, k0 = Math.floor(X + 1e-12), tx = X - k0;
      const Y = (f[t1] + 0.5) / r - 0.5, a0 = Math.floor(Y), ty = Y - a0, Z = (f[t2] + 0.5) / r - 0.5, b0 = Math.floor(Z), tz = Z - b0;
      let sum = 0;
      for (let ka = 0; ka <= 1; ka++) for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
        const w = (ka ? tx : 1 - tx) * (a ? ty : 1 - ty) * (b ? tz : 1 - tz); if (w === 0) continue;
        sum += w * U(k0 + ka, Math.min(dims[t1] - 1, Math.max(0, a0 + a)), Math.min(dims[t2] - 1, Math.max(0, b0 + b)));
      }
      out[axis][i] = sum;
    }
  }
  return out;
}
describe('MesoCloud face interpolation', () => {
  for (const r of [1, 2, 3]) it(`stencil version equals the direct definition at refine ${r}`, () => {
    const data = new Uint8Array(NX * NY * NZ).fill(1);
    for (let i = 0; i < data.length; i++) if ((i * 7919) % 13 === 0) data[i] = 0;
    const active = Int32Array.from(Array.from(data.keys()).filter(i => data[i])), mask: MesoMask = { nx: NX, ny: NY, nz: NZ, data, active, activeCount: active.length };
    const cloud = new MesoCloud(mask, r); cloud.activeFloor = -1;
    const coarse = [0, 1, 2].map(a => Float32Array.from({ length: data.length }, (_, i) => Math.sin(i * (a + 1.3)) * 0.01));
    cloud.values[cloud.index(2, 2, 2)] = 1;
    cloud.advect(coarse, 1e-9, [1e-3, 1e-3, 1e-3], 0);
    const expected = reference(mask, r, coarse, cloud.wet, cloud.nx, cloud.ny, cloud.nz);
    for (let axis = 0; axis < 3; axis++) for (let i = 0; i < expected[axis].length; i++) expect(cloud.lastFaces[axis][i]).toBeCloseTo(expected[axis][i], 6);
  });
});
