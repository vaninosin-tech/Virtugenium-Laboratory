/**
 * Mesoscopic cloud (experimental, not wired into the game): a refined copy of the FINE suspension.
 *
 * It is not a reservoir. Every unit of mass in it is a unit of the coarse fine-suspension field, moved on a grid `refine` times
 * finer (so the same conserved AgCl budget has one owner at a time):
 *   - mass enters only through addFromCoarse (the AgCl formed in a coarse cell, shared over its children);
 *   - mass moves only by conservative advection with the coarse velocity faces (interpolated) and by subgrid mixing;
 *   - restrictTo() gives the coarse cell amounts back (block sums), so a coarse consumer reads the same mass;
 *   - a renderer reads either this field or the coarse one, never both (no double optical counting).
 * Structure (thin extensions, necks, separated lobes, gaps) is not drawn: it appears where the flow stretches the concentration and
 * where the refined grid keeps it from being smoothed away.
 *
 * Active region: the work is done only in coarse blocks that hold mass, plus their wet neighbour blocks (the halo, so material
 * can leave a block into the next one within a pass). The list is rebuilt before every advect call, so the region moves and grows with
 * the cloud. Nothing is deleted: a block whose mass falls below `activeFloor` (relative to the total) is frozen, not zeroed, and joins
 * the computation again as soon as a neighbour exports into it. Mass in a frozen block is part of `mass`, `restrictTo` and `components`.
 *
 * Unresolved mixing: a cell mixes with a diffusivity kappa = base + eta * eddy, where `eddy` is the coarse field's own eddy
 * diffusivity of the parent cell (the same closure the fine suspension uses) and eta = (h_fine / h_coarse)^p scales it to the finer
 * grid (p = 4/3 by Richardson's law). Explicit, conservative, cut into sub-steps so that kappa dt / h^2 <= 1/8.
 */
export interface MesoMask {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly data: Uint8Array;
  readonly active: Int32Array;
  readonly activeCount: number;
}

export interface MesoMixing {
  /** Molecular-scale diffusivity (m2/s). */
  base: number;
  /** Eddy diffusivity (m2/s) of each coarse cell, as the flow solver reports it, before the per-field scale. Optional. */
  coarseEddy?: ArrayLike<number>;
  /** Factor applied to the coarse eddy for this grid: (h_fine / h_coarse)^p. Default (1 / refine)^(4/3). */
  eta?: number;
  /** The coarse closure multiplies the eddy by this scale for the fine suspension (FINE_EDDY_SCALE, 0.02). Default 1. */
  eddyScale?: number;
}

export interface MesoStats {
  substeps: number; maxCourant: number; fastFaces: number; capHits: number;
  activeBlocks: number; activeCells: number;
  interpolateMs: number; advectMs: number; diffuseMs: number;
  /** Sum of the absolute cell changes caused by transport and by mixing in this step (units of mass). */
  transportChange: number; mixingChange: number;
}

const MAX_SUBSTEPS = 256;
const now = () => (typeof performance !== "undefined" ? performance.now() : 0);

export class MesoCloud {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly values: Float64Array;
  /** Fine cell is wet when its coarse parent is wet. */
  readonly wet: Uint8Array;
  /** Mass in a block below this fraction of the total is frozen (not computed), never deleted. */
  activeFloor = 1e-13;
  private readonly parentWet: Uint8Array;
  private readonly parent: Int32Array;
  private readonly faces: Float32Array[];
  private readonly fast: Uint8Array[];
  private readonly outgoing: Float64Array;
  private readonly next: Float64Array;
  private readonly stride: [number, number, number];
  private readonly blockCount: number;
  private readonly blockMass: Float64Array;
  private readonly activeBlocks: Int32Array;
  private activeBlockCount = 0;
  private readonly blockMark: Uint8Array;
  private readonly lim: number[];
  private readonly co = [0, 0, 0];
  private fi = new Int32Array(1 << 15); private fj = new Int32Array(1 << 15); private fr = new Float64Array(1 << 15);
  private kappaCell = new Float32Array(0);
  private transportChange = 0;
  private massTotal = 0;
  constructor(readonly mask: MesoMask, readonly refine = 3) {
    if (!Number.isInteger(refine) || refine < 1) throw new RangeError("refine must be a positive integer");
    this.nx = mask.nx * refine; this.ny = mask.ny * refine; this.nz = mask.nz * refine;
    const n = this.nx * this.ny * this.nz;
    this.values = new Float64Array(n); this.wet = new Uint8Array(n); this.parentWet = new Uint8Array(mask.data.length);
    this.parent = new Int32Array(n);
    this.faces = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    this.fast = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
    this.outgoing = new Float64Array(n); this.next = new Float64Array(n);
    this.stride = [1, this.nx, this.nx * this.ny]; this.lim = [this.nx, this.ny, this.nz];
    this.blockCount = mask.data.length;
    this.blockMass = new Float64Array(this.blockCount); this.activeBlocks = new Int32Array(this.blockCount);
    this.blockMark = new Uint8Array(this.blockCount);
    this.parentWet.set(mask.data);
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++)
      this.parent[(z * this.ny + y) * this.nx + x] = (Math.floor(z / refine) * mask.ny + Math.floor(y / refine)) * mask.nx + Math.floor(x / refine);
    this.rebuildWet();
  }
  index(x: number, y: number, z: number) { return (z * this.ny + y) * this.nx + x; }
  private rebuildWet() { for (let i = 0; i < this.wet.length; i++) this.wet[i] = this.mask.data[this.parent[i]]; }
  get mass() { let s = 0; for (let i = 0; i < this.values.length; i++) s += this.values[i]; return s; }
  get cellCount() { return this.values.length; }
  /** Active blocks and cells of the last advect call. */
  get activeBlocksNow() { return this.activeBlockCount; }

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
    for (let b = 0; b < this.blockCount; b++) this.blockMass[b] = this.blockSum(b);   // blocks that received mass above
  }

  private blockSum(b: number) {
    const r = this.refine, m = this.mask, cx = b % m.nx, cy = Math.floor(b / m.nx) % m.ny, cz = Math.floor(b / (m.nx * m.ny));
    let s = 0;
    for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) {
      const base = this.index(cx * r, cy * r + dy, cz * r + dz);
      for (let dx = 0; dx < r; dx++) s += this.values[base + dx];
    }
    return s;
  }

  /** Mass formed in each coarse cell (amounts), shared equally by its children. */
  addFromCoarse(amounts: ArrayLike<number>) {
    const m = this.mask, r = this.refine, children = r * r * r;
    for (let a = 0; a < m.activeCount; a++) {
      const c = m.active[a], amount = amounts[c];
      if (!(amount > 0)) continue;
      const cx = c % m.nx, cy = Math.floor(c / m.nx) % m.ny, cz = Math.floor(c / (m.nx * m.ny));
      const each = amount / children;
      for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++)
        this.values[this.index(cx * r + dx, cy * r + dy, cz * r + dz)] += each;
      this.blockMass[c] += amount;
    }
  }
  /** Block sums back to the coarse grid. */
  restrictTo(out: Float64Array) {
    out.fill(0); const m = this.mask, r = this.refine;
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++)
      out[(Math.floor(z / r) * m.ny + Math.floor(y / r)) * m.nx + Math.floor(x / r)] += this.values[this.index(x, y, z)];
    return out;
  }

  /** Active blocks: blocks with mass above the floor plus all their wet neighbours (26). */
  private buildActive(everything = false) {
    const m = this.mask, floor = this.activeFloor * (this.massTotal > 0 ? this.massTotal : 1);
    this.blockMark.fill(0);
    let count = 0;
    const mark = (nb: number) => { if (m.data[nb] && !this.blockMark[nb]) { this.blockMark[nb] = 1; this.activeBlocks[count++] = nb; } };
    for (let b = 0; b < this.blockCount; b++) {
      if (everything) { mark(b); continue; }
      if (!(this.blockMass[b] > floor)) continue;
      // The full 3 x 3 x 3 neighbourhood: mass moves at most one cell per pass along one axis and then mixes one cell further, so
      // after a step it can sit diagonally next to the block it started in, and every cell that holds mass needs all its neighbours.
      const cx = b % m.nx, cy = Math.floor(b / m.nx) % m.ny, cz = Math.floor(b / (m.nx * m.ny));
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy, z = cz + dz;
        if (x < 0 || y < 0 || z < 0 || x >= m.nx || y >= m.ny || z >= m.nz) continue;
        mark((z * m.ny + y) * m.nx + x);
      }
    }
    this.activeBlockCount = count;
  }

  /**
   * Fine face velocities from the coarse staggered faces (face value at the + side of its coarse cell along each axis): linear along
   * the face normal between the two coarse faces, bilinear across it. The fine faces that lie on a coarse face carry exactly the
   * coarse velocity, so the volume flux through every coarse cell boundary is preserved. Only active blocks are filled.
   */
  private interpolateFaces(coarse: ArrayLike<number>[]) {
    const m = this.mask, r = this.refine, dims = [m.nx, m.ny, m.nz], plane = m.nx * m.ny, fdims = [this.nx, this.ny, this.nz];
    // Coarse face values with the wall rule applied once: a face exists only between two wet coarse cells.
    if (this.validFaces[0].length !== m.data.length) for (let axis = 0; axis < 3; axis++) this.validFaces[axis] = new Float32Array(m.data.length);
    for (let axis = 0; axis < 3; axis++) {
      const u = this.validFaces[axis], step = axis === 0 ? 1 : axis === 1 ? m.nx : plane;
      for (let idx = 0; idx < u.length; idx++) {
        const c = axis === 0 ? idx % m.nx : axis === 1 ? Math.floor(idx / m.nx) % m.ny : Math.floor(idx / plane);
        u[idx] = m.data[idx] && c + 1 < dims[axis] && m.data[idx + step] ? Number(coarse[axis][idx]) : 0;
      }
      this.faces[axis].fill(0);
    }
    // Interpolation stencil per local offset inside a block: along the normal the face sits at (d + 1) / r of the block, across it at
    // the cell centre (d + 0.5) / r; both are linear between two coarse values.
    const nrm = new Int32Array(r), nw = new Float64Array(r), trn = new Int32Array(r), tw = new Float64Array(r);
    for (let d = 0; d < r; d++) {
      const X = (d + 1) / r; nrm[d] = Math.floor(X + 1e-12); nw[d] = X - nrm[d];          // offset in coarse faces from the block's lower face, weight of the upper
      const Y = (d + 0.5) / r - 0.5; trn[d] = Math.floor(Y); tw[d] = Y - trn[d];           // offset in coarse cells across (may be -1), weight of the upper
    }
    for (let axis = 0; axis < 3; axis++) {
      const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3, face = this.faces[axis], uv = this.validFaces[axis];
      const stride = [1, m.nx, plane], bs = [0, 0, 0], loc = [0, 0, 0];
      for (let k = 0; k < this.activeBlockCount; k++) {
        const bl = this.activeBlocks[k]; bs[0] = bl % m.nx; bs[1] = Math.floor(bl / m.nx) % m.ny; bs[2] = Math.floor(bl / plane);
        for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) {
          const i = this.index(bs[0] * r + dx, bs[1] * r + dy, bs[2] * r + dz);
          if (!this.wet[i]) continue;
          loc[0] = dx; loc[1] = dy; loc[2] = dz;
          const fa = bs[axis] * r + loc[axis];
          if (fa + 1 >= fdims[axis] || !this.wet[i + this.stride[axis]]) continue;
          // Coarse cell whose + face is the lower normal neighbour: k0 - 1, where k0 = bs[axis] + nrm; values at faces k0 and k0 + 1.
          const k0 = bs[axis] + nrm[loc[axis]], tx = nw[loc[axis]];
          const a0 = bs[t1] + trn[loc[t1]], ty = tw[loc[t1]], b0 = bs[t2] + trn[loc[t2]], tz = tw[loc[t2]];
          let sum = 0;
          for (let ka = 0; ka <= 1; ka++) {
            const wx = ka ? tx : 1 - tx; if (wx === 0) continue;
            const cn = k0 + ka - 1; if (cn < 0 || cn >= dims[axis]) continue;           // wall: face value 0
            for (let a = 0; a <= 1; a++) {
              const wy = a ? ty : 1 - ty; if (wy === 0) continue;
              const ca = Math.min(dims[t1] - 1, Math.max(0, a0 + a));
              for (let bb = 0; bb <= 1; bb++) {
                const wz = bb ? tz : 1 - tz; if (wz === 0) continue;
                const cb = Math.min(dims[t2] - 1, Math.max(0, b0 + bb));
                sum += wx * wy * wz * uv[cn * stride[axis] + ca * stride[t1] + cb * stride[t2]];
              }
            }
          }
          face[i] = sum;
        }
      }
    }
  }
  private validFaces: Float32Array[] = [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
  /** The fine face velocities of the last advect call (read-only, for tests and diagnostics). */
  get lastFaces() { return this.faces; }

  /**
   * Conservative advection (second-order limited donor cell) with the coarse faces, then explicit subgrid mixing. Faces with a Courant
   * number above 0.9 are advected in sub-steps (first order), the others in one pass; a donor never exports more than it holds.
   * Sum(values) is unchanged. `mixing` is a diffusivity (m2/s) or a MesoMixing.
   */
  advect(coarseFaces: ArrayLike<number>[], dt: number, spacing: [number, number, number], mixing: number | MesoMixing = 0): MesoStats {
    const t0 = now();
    this.massTotal = this.mass;
    for (let b = 0; b < this.blockCount; b++) this.blockMass[b] = this.blockSum(b);       // exact block masses (cheap next to the passes)
    // Faces that need sub-steps can carry mass several cells in one call; then the whole wet domain is active (the pour only).
    let estimate = 0;
    for (let a = 0; a < this.mask.activeCount; a++) { const c = this.mask.active[a];
      for (let axis = 0; axis < 3; axis++) estimate = Math.max(estimate, Math.abs(Number(coarseFaces[axis][c])) * dt / (spacing[axis] / this.refine)); }
    this.buildActive(estimate > 0.9);
    this.interpolateFaces(coarseFaces);
    const tInterp = now();
    const h = [spacing[0] / this.refine, spacing[1] / this.refine, spacing[2] / this.refine];
    let maxC = 0, fastCount = 0, capHits = 0;
    for (let axis = 0; axis < 3; axis++) this.fast[axis].fill(0);
    const r = this.refine, m = this.mask;
    for (let k = 0; k < this.activeBlockCount; k++) {
      const bl = this.activeBlocks[k], bx = bl % m.nx, by = Math.floor(bl / m.nx) % m.ny, bz = Math.floor(bl / (m.nx * m.ny));
      for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) {
        const i = this.index(bx * r + dx, by * r + dy, bz * r + dz);
        for (let axis = 0; axis < 3; axis++) {
          const c = Math.abs(this.faces[axis][i]) * dt / h[axis];
          if (c > maxC) maxC = c;
          if (c > 0.9) { this.fast[axis][i] = 1; fastCount++; }
        }
      }
    }
    const substeps = Math.max(1, Math.ceil(maxC / 0.9));
    if (substeps > MAX_SUBSTEPS) capHits++;
    const n = Math.min(MAX_SUBSTEPS, substeps);
    this.transportChange = 0;
    this.pass(dt, h, true, false);                                            // slow faces, one pass
    for (let s = 0; s < n && fastCount > 0; s++) this.pass(dt / n, h, false, true);   // fast faces, sub-steps
    const tAdvect = now();
    let mixingChange = 0;
    const active = typeof mixing === "number" ? mixing > 0 : (mixing.base > 0 || !!mixing.coarseEddy);
    if (active) mixingChange = this.diffuse(mixing, dt, h);
    const tMix = now();
    return { substeps: n, maxCourant: maxC, fastFaces: fastCount, capHits, activeBlocks: this.activeBlockCount,
      activeCells: this.activeBlockCount * r * r * r, interpolateMs: tInterp - t0, advectMs: tAdvect - tInterp, diffuseMs: tMix - tAdvect,
      transportChange: this.transportChange, mixingChange };
  }

  private grow() {
    const m2 = this.fi.length * 2, a = new Int32Array(m2), b = new Int32Array(m2), c = new Float64Array(m2);
    a.set(this.fi); b.set(this.fj); c.set(this.fr); this.fi = a; this.fj = b; this.fr = c;
  }

  private pass(dt: number, h: number[], slow: boolean, fastOnly: boolean) {
    const { stride } = this, v = this.values, out = this.outgoing, lim = this.lim, co = this.co, m = this.mask, r = this.refine;
    let n = 0;
    for (let k = 0; k < this.activeBlockCount; k++) {
      const bl = this.activeBlocks[k], bx = bl % m.nx, by = Math.floor(bl / m.nx) % m.ny, bz = Math.floor(bl / (m.nx * m.ny));
      for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) {
        const x = bx * r + dx, y = by * r + dy, z = bz * r + dz, i = this.index(x, y, z);
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
        }
      }
    }
    // Outgoing totals per donor, from scratch for exactly the cells that take part (a cell outside the active list can be a donor too).
    for (let q = 0; q < n; q++) { out[this.fi[q]] = 0; out[this.fj[q]] = 0; }
    for (let q = 0; q < n; q++) out[this.fr[q] >= 0 ? this.fi[q] : this.fj[q]] += Math.abs(this.fr[q]);
    for (let q = 0; q < n; q++) {
      const donor = this.fr[q] >= 0 ? this.fi[q] : this.fj[q];
      if (out[donor] > v[donor]) this.fr[q] *= v[donor] / out[donor];
    }
    for (let q = 0; q < n; q++) { v[this.fi[q]] -= this.fr[q]; v[this.fj[q]] += this.fr[q]; this.transportChange += 2 * Math.abs(this.fr[q]); }
    for (let q = 0; q < n; q++) { // round-off only: the limiter already keeps donors non-negative
      if (v[this.fi[q]] < 0) v[this.fi[q]] = 0;
      if (v[this.fj[q]] < 0) v[this.fj[q]] = 0;
    }
  }

  /** Explicit conservative mixing in sub-steps so that kappa dt / h^2 <= 1/8; returns the summed absolute change. */
  private diffuse(mixing: number | MesoMixing, dt: number, h: number[]) {
    const m = this.mask, r = this.refine, { stride } = this, v = this.values, next = this.next, lim = this.lim, co = this.co;
    const base = typeof mixing === "number" ? mixing : mixing.base;
    const eddy = typeof mixing === "number" ? undefined : mixing.coarseEddy;
    const eta = typeof mixing === "number" ? 0 : (mixing.eta ?? Math.pow(1 / this.refine, 4 / 3)) * (mixing.eddyScale ?? 1);
    if (this.kappaCell.length !== this.values.length) this.kappaCell = new Float32Array(this.values.length);
    const kappa = this.kappaCell;
    let kmax = base;
    for (let k = 0; k < this.activeBlockCount; k++) {
      const bl = this.activeBlocks[k], bx = bl % m.nx, by = Math.floor(bl / m.nx) % m.ny, bz = Math.floor(bl / (m.nx * m.ny)), e = eddy ? Number(eddy[bl]) * eta : 0;
      for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) kappa[this.index(bx * r + dx, by * r + dy, bz * r + dz)] = base + e;
      if (base + e > kmax) kmax = base + e;
    }
    const hmin = Math.min(...h), sub = Math.max(1, Math.ceil(kmax * dt / (hmin * hmin) * 8)), s = dt / sub;
    let change = 0;
    for (let q = 0; q < sub; q++) {
      for (let k = 0; k < this.activeBlockCount; k++) {
        const bl = this.activeBlocks[k], bx = bl % m.nx, by = Math.floor(bl / m.nx) % m.ny, bz = Math.floor(bl / (m.nx * m.ny));
        for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) { const i = this.index(bx * r + dx, by * r + dy, bz * r + dz); next[i] = v[i]; }
      }
      for (let k = 0; k < this.activeBlockCount; k++) {
        const bl = this.activeBlocks[k], bx = bl % m.nx, by = Math.floor(bl / m.nx) % m.ny, bz = Math.floor(bl / (m.nx * m.ny));
        for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) {
          const x = bx * r + dx, y = by * r + dy, z = bz * r + dz, i = this.index(x, y, z); if (!this.wet[i]) continue;
          co[0] = x; co[1] = y; co[2] = z;
          for (let axis = 0; axis < 3; axis++) {
            if (co[axis] + 1 >= lim[axis]) continue;
            const j = i + stride[axis]; if (!this.wet[j] || !this.blockMark[this.parent[j]]) continue;   // a partner outside the list would lose its share
            const flow = 0.5 * (kappa[i] + kappa[j]) * s / (h[axis] * h[axis]) * (v[i] - v[j]);
            next[i] -= flow; next[j] += flow; change += 2 * Math.abs(flow);
          }
        }
      }
      for (let k = 0; k < this.activeBlockCount; k++) {
        const bl = this.activeBlocks[k], bx = bl % m.nx, by = Math.floor(bl / m.nx) % m.ny, bz = Math.floor(bl / (m.nx * m.ny));
        for (let dz = 0; dz < r; dz++) for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) { const i = this.index(bx * r + dx, by * r + dy, bz * r + dz); v[i] = next[i]; }
      }
    }
    return change;
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
