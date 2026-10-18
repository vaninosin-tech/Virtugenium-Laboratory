/**
 * Soft AgCl deposit with load-dependent porosity (prototype, experimental, not wired into the game).
 *
 * The solid mass is the only conserved quantity. A column holds `layers` stacked parcels (bottom first); each parcel
 * has a solid mass and a void ratio e. Bulk volume of a parcel is mass / (rhoS) * (1 + e): it follows from mass,
 * solid density and porosity, never from a drawn height.
 *   - mass enters only through deposit(), meant to be fed by modelled settling or bottom contact;
 *   - the effective stress on a parcel is the submerged weight of the solid above and half of its own, per area;
 *   - the equilibrium void ratio falls with that stress:  e_eq = e_c + (e_0 - e_c) (1 + s / s_ref)^(-m);
 *   - e relaxes toward e_eq with the time constant tau (a drained consolidation time, minutes to hours for soft clays);
 *     this is a documented law with parameters, not a timer that triggers an event or a fixed height;
 *   - a slope above the yield slope creeps mass toward the lower neighbour (conservative, bounded per step).
 */
export interface DepositParams {
  rhoS: number; rhoW: number; g: number;
  e0: number; eC: number; sRef: number; m: number; tau: number;
  cellArea: number; yieldSlope: number; creepRate: number; spacing: number;
  /** Discretisation scale: solid mass (kg) a parcel takes before the next layer starts. Not physics. */
  layerMass: number;
}
export const DEFAULT_DEPOSIT: DepositParams = {
  rhoS: 5560, rhoW: 1000, g: 9.81,
  e0: 30,            // freshly settled floc bed, porosity ~0.97
  eC: 2.5,           // strongly compacted, porosity ~0.71
  sRef: 0.5, m: 0.6, // Pa; soft-soil scale for a bed a few mm high
  tau: 1800,         // s
  cellArea: 1e-6, yieldSlope: 1.2, creepRate: 0.2, spacing: 1e-3, layerMass: 2e-6,
};

export class ConsolidatingDeposit {
  readonly mass: Float64Array;   // kg solid, [column][layer]
  readonly e: Float64Array;      // void ratio, [column][layer]
  creptTotal = 0;
  constructor(readonly nx: number, readonly nz: number, readonly layers = 8, readonly p: DepositParams = DEFAULT_DEPOSIT) {
    this.mass = new Float64Array(nx * nz * layers); this.e = new Float64Array(nx * nz * layers).fill(p.e0);
  }
  private at(c: number, l: number) { return c * this.layers + l; }
  get solidMass() { let s = 0; for (const v of this.mass) s += v; return s; }
  /** Add solid mass (kg) to a column; it lands on top as fresh, loose material. Fills the next layer when the top is thick. */
  deposit(column: number, kg: number) {
    if (!(kg > 0)) return;
    const { p, layers } = this, cap = p.layerMass;
    let l = 0; while (l < layers - 1 && this.mass[this.at(column, l)] >= cap) l++;
    const k = this.at(column, l), old = this.mass[k];
    // Mix void ratio by solid mass (the new material is loose).
    this.e[k] = (this.e[k] * old + p.e0 * kg) / (old + kg); this.mass[k] += kg;
  }
  /** Bulk thickness of a column (m): sum of parcel volumes over the cell footprint. */
  height(column: number) {
    let v = 0;
    for (let l = 0; l < this.layers; l++) { const k = this.at(column, l); v += this.mass[k] / this.p.rhoS * (1 + this.e[k]); }
    return v / this.p.cellArea;
  }
  bulkVolume() { let v = 0; for (let k = 0; k < this.mass.length; k++) v += this.mass[k] / this.p.rhoS * (1 + this.e[k]); return v; }
  meanPorosity() {
    let vs = 0, vt = 0;
    for (let k = 0; k < this.mass.length; k++) { const s = this.mass[k] / this.p.rhoS; vs += s; vt += s * (1 + this.e[k]); }
    return vt > 0 ? 1 - vs / vt : 0;
  }
  /** Effective stress (Pa) at the middle of a parcel. */
  stress(column: number, layer: number) {
    const { p } = this; let above = 0;
    for (let l = layer + 1; l < this.layers; l++) above += this.mass[this.at(column, l)];
    above += 0.5 * this.mass[this.at(column, layer)];
    return (p.rhoS - p.rhoW) / p.rhoS * p.g * above / p.cellArea;
  }
  consolidate(dt: number) {
    const { p } = this, a = 1 - Math.exp(-dt / p.tau);
    for (let c = 0; c < this.nx * this.nz; c++) for (let l = 0; l < this.layers; l++) {
      const k = this.at(c, l); if (this.mass[k] <= 0) continue;
      const eq = p.eC + (p.e0 - p.eC) * Math.pow(1 + this.stress(c, l) / p.sRef, -p.m);
      if (this.e[k] > eq) this.e[k] += (eq - this.e[k]) * a;      // compaction only: a bed does not re-swell by itself
    }
  }
  /** Slope-limited creep: mass moves from the top layer of a high column toward a lower neighbour; solid mass is conserved. */
  creep(dt: number) {
    const { p, nx, nz } = this;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const c = z * nx + x, hc = this.height(c);
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const xn = x + dx, zn = z + dz; if (xn >= nx || zn >= nz) continue;
        const n = zn * nx + xn, hn = this.height(n), from = hc >= hn ? c : n, to = from === c ? n : c;
        const dh = Math.abs(hc - hn), slope = dh / p.spacing;
        if (slope <= p.yieldSlope) continue;
        const excess = (slope - p.yieldSlope) / slope;             // fraction of the height step above yield
        let top = this.layers - 1; while (top > 0 && this.mass[this.at(from, top)] <= 0) top--;
        const k = this.at(from, top), move = Math.min(this.mass[k], this.mass[k] * p.creepRate * excess * Math.min(1, dt));
        if (move <= 0) continue;
        this.mass[k] -= move; this.creptTotal += move;
        const eMoved = this.e[k];
        let l = 0; while (l < this.layers - 1 && this.mass[this.at(to, l)] >= p.layerMass) l++;
        const kt = this.at(to, l), old = this.mass[kt];
        this.e[kt] = (this.e[kt] * old + eMoved * move) / (old + move); this.mass[kt] += move;
      }
    }
  }
}
