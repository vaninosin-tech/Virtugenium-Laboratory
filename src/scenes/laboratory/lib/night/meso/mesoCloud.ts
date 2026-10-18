/**
 * Mesoscopic cloud (prototype, experimental, not wired into the game): a refined copy of the FINE suspension.
 *
 * It is not a reservoir. Every unit of mass in it is a unit of the coarse fine-suspension field, moved on a grid
 * `refine` times finer (so the same conserved AgCl budget has one owner at a time):
 *   - mass enters only through addFromCoarse (the AgCl formed in a coarse cell, shared over its children);
 *   - mass moves only by conservative advection with the coarse velocity faces (interpolated) and subgrid diffusion;
 *   - restrictTo() gives the coarse cell amounts back (block sums), so a coarse consumer reads the same mass;
 *   - a renderer reads either this field or the coarse one, never both (no double optical counting).
 * Structure (thin extensions, necks, separated lobes, gaps) is not drawn: it appears where the flow stretches the
 * concentration and where the refined grid keeps it from being smoothed away.
 */
export interface MesoMask {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly data: Uint8Array;
  readonly active: Int32Array;
  readonly activeCount: number;
}

export interface MesoStats { substeps: number; maxCourant: number; fastFaces: number; capHits: number }

const MAX_SUBSTEPS = 256;

export class MesoCloud {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly values: Float64Array;
  /** Fine cell is wet when its coarse parent is wet. */
  readonly wet: Uint8Array;
  private readonly parentWet: Uint8Array;
  private readonly faces: Float32Array[];
  private readonly fast: Uint8Array[];
  private readonly outgoing: Float64Array;
  private readonly next: Float64Array;
  private readonly stride: [number, number, number];
  constructor(readonly mask: MesoMask, readonly refine = 3) {
    if (!Number.isInteger(refine) || refine < 1) throw new RangeError("refine must be a positive integer");
    this.nx = mask.nx * refine; this.ny = mask.ny * refine; this.nz = mask.nz * refine;
    const n = this.nx * this.ny * this.nz;
    this.values = new Float64Array(n); this.wet = new Uint8Array(n); this.parentWet = new Uint8Array(mask.data.length);
    this.faces = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    this.fast = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
    this.outgoing = new Float64Array(n); this.next = new Float64Array(n);
    this.stride = [1, this.nx, this.nx * this.ny]; this.lim = [this.nx, this.ny, this.nz];
    this.parentWet.set(mask.data);
    this.rebuildWet();
  }
  index(x: number, y: number, z: number) { return (z * this.ny + y) * this.nx + x; }
  private parentOf(fx: number, fy: number, fz: number) {
    const r = this.refine;
    return (Math.floor(fz / r) * this.mask.ny + Math.floor(fy / r)) * this.mask.nx + Math.floor(fx / r);
  }
  private rebuildWet() {
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++)
      this.wet[this.index(x, y, z)] = this.mask.data[this.parentOf(x, y, z)];
  }
  get mass() { let s = 0; for (let i = 0; i < this.values.length; i++) s += this.values[i]; return s; }
  get cellCount() { return this.values.length; }

  /** The coarse mask changed (level, tilt): cells that dried hand their mass to the nearest wet fine cell; new wet cells start empty. */
  syncMask() {
    const m = this.mask;
    let changed = false;
    for (let i = 0; i < m.data.length; i++) if (m.data[i] !== this.parentWet[i]) { changed = true; break; }
    if (!changed) return;
    const oldWet = this.wet.slice();
    this.parentWet.set(m.data); this.rebuildWet();
    const wetList: number[] = [];
    for (let i = 0; i < this.wet.length; i++) if (this.wet[i]) wetList.push(i);
    for (let i = 0; i < this.values.length; i++) {
      if (!oldWet[i] || this.wet[i] || this.values[i] === 0) continue;
      const x = i % this.nx, y = Math.floor(i / this.nx) % this.ny, z = Math.floor(i / (this.nx * this.ny));
      let best = -1, bestD = Infinity;
      for (const j of wetList) {
        const dx = j % this.nx - x, dy = Math.floor(j / this.nx) % this.ny - y, dz = Math.floor(j / (this.nx * this.ny)) - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best >= 0) this.values[best] += this.values[i];
      this.values[i] = 0;
    }
  }

  /** Mass formed in each coarse cell (amounts), shared equally by its wet children. */
  addFromCoarse(amounts: ArrayLike<number>) {
    const m = this.mask, r = this.refine, children = r * r * r;
    for (let a = 0; a < m.activeCount; a++) {
      const c = m.active[a], amount = amounts[c];
      if (!(amount > 0)) continue;
      const cx = c % m.nx, cy = Math.floor(c / m.nx) % m.ny, cz = Math.floor(c / (m.nx * m.ny));
      const each = amount / children;
      for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++)
        this.values[this.index(cx * r + dx, cy * r + dy, cz * r + dz)] += each;
    }
  }
  /** Block sums back to the coarse grid. */
  restrictTo(out: Float64Array) {
    out.fill(0); const m = this.mask, r = this.refine;
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++)
      out[(Math.floor(z / r) * m.ny + Math.floor(y / r)) * m.nx + Math.floor(x / r)] += this.values[this.index(x, y, z)];
    return out;
  }

  /**
   * Fine face velocities from the coarse staggered faces (face value at the + side of its coarse cell along each axis):
   * linear along the face normal between the two coarse faces, bilinear across it. The fine faces that lie on a coarse
   * face carry exactly the coarse velocity, so the volume flux through every coarse cell boundary is preserved.
   */
  private interpolateFaces(coarse: ArrayLike<number>[]) {
    const m = this.mask, r = this.refine, dims = [m.nx, m.ny, m.nz], fdims = [this.nx, this.ny, this.nz];
    const cidx = (x: number, y: number, z: number) => (z * m.ny + y) * m.nx + x;
    for (let axis = 0; axis < 3; axis++) {
      const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3, face = this.faces[axis];
      const U = (k: number, a: number, b: number) => {
        // k = coarse face coordinate along `axis` (0 is the left wall); a, b = coarse cell coordinates along t1, t2.
        if (k <= 0 || k > dims[axis]) return 0;
        const c = [0, 0, 0]; c[axis] = k - 1; c[t1] = a; c[t2] = b;
        const idx = cidx(c[0], c[1], c[2]);
        // The face only exists between two wet coarse cells.
        const n = [c[0], c[1], c[2]]; n[axis] += 1;
        if (!m.data[idx] || n[axis] >= dims[axis] || !m.data[cidx(n[0], n[1], n[2])]) return 0;
        return coarse[axis][idx];
      };
      for (let fz = 0; fz < this.nz; fz++) for (let fy = 0; fy < this.ny; fy++) for (let fx = 0; fx < this.nx; fx++) {
        const f = [fx, fy, fz], i = this.index(fx, fy, fz);
        face[i] = 0;
        if (!this.wet[i]) continue;
        const jn = [fx, fy, fz]; jn[axis] += 1;
        if (jn[axis] >= fdims[axis] || !this.wet[this.index(jn[0], jn[1], jn[2])]) continue;
        const X = (f[axis] + 1) / r, k0 = Math.floor(X + 1e-12), tx = X - k0;
        const Y = (f[t1] + 0.5) / r - 0.5, a0 = Math.floor(Y), ty = Y - a0;
        const Z = (f[t2] + 0.5) / r - 0.5, b0 = Math.floor(Z), tz = Z - b0;
        const clampA = (v: number) => Math.min(dims[t1] - 1, Math.max(0, v)), clampB = (v: number) => Math.min(dims[t2] - 1, Math.max(0, v));
        let sum = 0;
        for (let ka = 0; ka <= 1; ka++) for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
          const wx = ka ? tx : 1 - tx, wy = a ? ty : 1 - ty, wz = b ? tz : 1 - tz, w = wx * wy * wz;
          if (w === 0) continue;
          sum += w * U(k0 + ka, clampA(a0 + a), clampB(b0 + b));
        }
        face[i] = sum;
      }
    }
  }

  /**
   * Conservative advection (second-order limited donor cell) with the coarse faces, plus explicit subgrid diffusion
   * `kappa` (m2/s) over a cell size `h` (m). Faces with a Courant number above 0.9 are advected in sub-steps (first
   * order), the others in one pass; a donor never exports more than it holds. Sum(values) is unchanged.
   */
  advect(coarseFaces: ArrayLike<number>[], dt: number, spacing: [number, number, number], kappa = 0): MesoStats {
    this.interpolateFaces(coarseFaces);
    const h = [spacing[0] / this.refine, spacing[1] / this.refine, spacing[2] / this.refine];
    let maxC = 0, fastCount = 0, capHits = 0;
    for (let axis = 0; axis < 3; axis++) this.fast[axis].fill(0);
    for (let i = 0; i < this.values.length; i++) for (let axis = 0; axis < 3; axis++) {
      const c = Math.abs(this.faces[axis][i]) * dt / h[axis];
      if (c > maxC) maxC = c;
      if (c > 0.9) { this.fast[axis][i] = 1; fastCount++; }
    }
    const substeps = Math.max(1, Math.ceil(maxC / 0.9));
    if (substeps > MAX_SUBSTEPS) capHits++;
    const n = Math.min(MAX_SUBSTEPS, substeps);
    this.pass(dt, h, true, false);                                            // slow faces, one pass
    for (let s = 0; s < n && fastCount > 0; s++) this.pass(dt / n, h, false, true);   // fast faces, sub-steps
    if (kappa > 0) this.diffuse(kappa, dt, h);
    return { substeps: n, maxCourant: maxC, fastFaces: fastCount, capHits };
  }

  private pass(dt: number, h: number[], slow: boolean, fastOnly: boolean) {
    const { nx, ny, nz, stride } = this, v = this.values, out = this.outgoing;
    const lim = this.lim, co = this.co;
    out.fill(0); let n = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = this.index(x, y, z);
      if (!this.wet[i]) continue;
      co[0] = x; co[1] = y; co[2] = z;
      for (let axis = 0; axis < 3; axis++) {
        if (fastOnly ? !this.fast[axis][i] : (slow && this.fast[axis][i])) continue;
        const u = this.faces[axis][i]; if (u === 0) continue;
        const j = i + stride[axis];
        if (co[axis] + 1 >= lim[axis] || !this.wet[j]) continue;
        const f = u * dt / h[axis], up = f >= 0 ? i : j, down = f >= 0 ? j : i;
        let q = v[up];
        if (!fastOnly) {
          // Minmod-limited slope (second order); first order at walls, dry cells and extrema.
          const uc = f >= 0 ? co[axis] - 1 : co[axis] + 2, upstream = f >= 0 ? up - stride[axis] : up + stride[axis];
          if (uc >= 0 && uc < lim[axis] && this.wet[upstream]) {
            const sl = v[up] - v[upstream], sr = v[down] - v[up];
            if (sl * sr > 0) q = v[up] + 0.5 * (1 - Math.min(1, Math.abs(f))) * (sl > 0 ? Math.min(sl, sr) : Math.max(sl, sr));
            if (q < 0) q = 0;
          }
        }
        const raw = q * f;
        if (n === this.fi.length) this.grow();
        this.fi[n] = i; this.fj[n] = j; this.fr[n] = raw; n++;
        out[raw >= 0 ? i : j] += Math.abs(raw);
      }
    }
    for (let k = 0; k < n; k++) {
      const donor = this.fr[k] >= 0 ? this.fi[k] : this.fj[k];
      if (out[donor] > v[donor]) this.fr[k] *= v[donor] / out[donor];
    }
    for (let k = 0; k < n; k++) { v[this.fi[k]] -= this.fr[k]; v[this.fj[k]] += this.fr[k]; }
    for (let k = 0; k < n; k++) { // round-off only: the limiter already keeps donors non-negative
      if (v[this.fi[k]] < 0) v[this.fi[k]] = 0;
      if (v[this.fj[k]] < 0) v[this.fj[k]] = 0;
    }
  }
  private fi = new Int32Array(1 << 16); private fj = new Int32Array(1 << 16); private fr = new Float64Array(1 << 16);
  private readonly lim: number[]; private readonly co = [0, 0, 0];
  private grow() {
    const m = this.fi.length * 2, a = new Int32Array(m), b = new Int32Array(m), c = new Float64Array(m);
    a.set(this.fi); b.set(this.fj); c.set(this.fr); this.fi = a; this.fj = b; this.fr = c;
  }
  /** Explicit conservative diffusion, cut into sub-steps so that kappa dt / h^2 <= 1/8 on the finest spacing. */
  private diffuse(kappa: number, dt: number, h: number[]) {
    const hmin = Math.min(...h), n = Math.max(1, Math.ceil(kappa * dt / (hmin * hmin) * 8)), s = dt / n;
    const { nx, ny, nz, stride } = this, v = this.values, next = this.next;
    for (let sub = 0; sub < n; sub++) {
      next.set(v);
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const i = this.index(x, y, z); if (!this.wet[i]) continue;
        const co = [x, y, z], lim = [nx, ny, nz];
        for (let axis = 0; axis < 3; axis++) {
          if (co[axis] + 1 >= lim[axis]) continue;
          const j = i + stride[axis]; if (!this.wet[j]) continue;
          const flow = kappa * s / (h[axis] * h[axis]) * (v[i] - v[j]);
          next[i] -= flow; next[j] += flow;
        }
      }
      v.set(next);
    }
  }

  /** 6-connected components of the cells above `fraction` of the peak concentration; sizes in cells, largest first. */
  components(fraction = 0.25) {
    let peak = 0; for (let i = 0; i < this.values.length; i++) if (this.values[i] > peak) peak = this.values[i];
    const limit = peak * fraction, label = new Int32Array(this.values.length).fill(-1), sizes: number[] = [];
    const stack: number[] = [];
    for (let s = 0; s < this.values.length; s++) {
      if (label[s] >= 0 || !(this.values[s] > limit) || !this.wet[s]) continue;
      let count = 0; label[s] = sizes.length; stack.push(s);
      while (stack.length) {
        const i = stack.pop()!; count++;
        const x = i % this.nx, y = Math.floor(i / this.nx) % this.ny, z = Math.floor(i / (this.nx * this.ny));
        const nb = [x > 0 ? i - 1 : -1, x + 1 < this.nx ? i + 1 : -1, y > 0 ? i - this.nx : -1, y + 1 < this.ny ? i + this.nx : -1,
          z > 0 ? i - this.nx * this.ny : -1, z + 1 < this.nz ? i + this.nx * this.ny : -1];
        for (const j of nb) if (j >= 0 && label[j] < 0 && this.wet[j] && this.values[j] > limit) { label[j] = sizes.length; stack.push(j); }
      }
      sizes.push(count);
    }
    return { peak, count: sizes.length, sizes: sizes.sort((a, b) => b - a), label };
  }
}
