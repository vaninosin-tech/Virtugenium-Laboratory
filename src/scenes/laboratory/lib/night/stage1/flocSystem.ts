/**
 * Cohesive, porous AgCl flocs carried by the liquid (the Lagrangian half of a hybrid Eulerian-Lagrangian model).
 *
 * Eulerian side (TubeSilverField): fluid velocity, dissolved reagents, fine suspended solid.
 * Lagrangian side (this file): large visible aggregates, each a connected structure of nodes (sub-clusters).
 *
 * Physics:
 *  - a node moves with the local fluid velocity plus a slip velocity from the balance of gravity, buoyancy and
 *    drag on a porous aggregate; the slip depends on the node's effective density (solid fraction), never on age;
 *  - the solid fraction of a node falls with its size (fractal dimension Df): big nodes are more porous;
 *  - nodes are joined by breakable links; a link that is stretched beyond its yield is permanently lengthened
 *    (plastic deformation, no elastic recovery); links only break when `allowBreakage` is true and the tension
 *    exceeds their strength;
 *  - nodes cannot interpenetrate beyond a soft limit, so a heap forms by contact and not by a height rule;
 *  - mass is conserved: node masses change only by joining fine solid, breaking, or leaving as sediment.
 */
export interface FlocConfig {
  radius: number; bottom: number; height: number;
  /** Mass quantum (normalised reagent units) of a freshly spawned node. */
  quantum: number;
  /** Radius of a quantum node (m). */
  quantumRadius: number;
  fractalDimension: number;
  /** Solid fraction of a quantum node; falls as (r/r0)^(Df-3). */
  solidFraction: number;
  liquidDensity: number; solidDensity: number;
  dragCoefficient: number;
  /** Velocity relaxation time (s) of a node towards fluid velocity plus slip. */
  relaxation: number;
  linkRange: number;
  maxLinksPerNode: number;
  /** Fraction of the stretch removed per relaxation sweep (position based, not a spring). */
  linkStiffness: number;
  /** Stretch ratio at which a link yields (permanent lengthening) and the share of the excess made permanent. */
  yieldStretch: number; plasticShare: number;
  /** Link breaks when stretched beyond this ratio (only if breakage is enabled). */
  breakStretch: number;
  allowBreakage: boolean;
  maxNodes: number;
}

export const DEFAULT_FLOC_CONFIG: Omit<FlocConfig, "radius" | "bottom" | "height"> = {
  quantum: 0.012,
  quantumRadius: 0.0017,
  fractalDimension: 1.9,
  solidFraction: 0.0004,
  liquidDensity: 1000, solidDensity: 5560,
  dragCoefficient: 1.1,
  relaxation: 0.12,
  linkRange: 0.0052,
  maxLinksPerNode: 4,
  linkStiffness: 0.35,
  yieldStretch: 1.25, plasticShare: 0.5,
  breakStretch: 3.0,
  allowBreakage: false,
  maxNodes: 220,
};

export interface FlocNode {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  mass: number;
  /** Set when the node rests on the floor or on other nodes. */
  resting: boolean;
}
export interface FlocLink { a: number; b: number; rest: number; }

/** Samples the carrier flow at a point (m/s). Returns false when the point is outside the liquid. */
export type FlowSampler = (x: number, y: number, z: number, out: [number, number, number]) => boolean;

const G = 9.81;

/** Radius of a node of mass m: aggregates grow as m^(1/Df). */
export function nodeRadius(mass: number, c: Pick<FlocConfig, "quantum" | "quantumRadius" | "fractalDimension">) {
  // A node never looks smaller than 60 % of the quantum radius: a sub-cluster is a visible piece, not a speck.
  return c.quantumRadius * Math.max(0.6, Math.pow(Math.max(mass, 1e-12) / c.quantum, 1 / c.fractalDimension));
}

/** Solid fraction of a node: bigger flocs are more porous (phi ~ r^(Df-3)). */
export function nodeSolidFraction(radius: number, c: Pick<FlocConfig, "quantumRadius" | "fractalDimension" | "solidFraction">) {
  return Math.min(0.5, c.solidFraction * Math.pow(radius / c.quantumRadius, c.fractalDimension - 3));
}

/**
 * Terminal slip speed of a porous aggregate in the intermediate/turbulent drag regime:
 * v = sqrt( (4/3) g d (effective density excess / liquid density) / Cd ).  Depends on size and porosity only.
 */
export function slipSpeed(radius: number, c: FlocConfig) {
  const phi = nodeSolidFraction(radius, c);
  const excess = phi * (c.solidDensity - c.liquidDensity) / c.liquidDensity;
  return Math.sqrt((4 / 3) * G * 2 * radius * excess / c.dragCoefficient);
}

export class FlocSystem {
  readonly nodes: FlocNode[] = [];
  readonly links: FlocLink[] = [];
  readonly config: FlocConfig;
  /** Mass that has left the flocs as sediment (handed back to the caller). */
  settledMass = 0;
  private readonly flow: [number, number, number] = [0, 0, 0];
  private readonly adjacency: number[][] = [];
  private readonly scratch = new Float32Array(32768);

  constructor(config: FlocConfig) { this.config = config; }

  get totalMass() { let sum = 0; for (const n of this.nodes) sum += n.mass; return sum; }

  /** Bowl height of the floor at radial distance r from the axis. */
  floorHeight(r: number) {
    const R = this.config.radius;
    const rr = Math.min(r, R * 0.999);
    return this.config.bottom + R - Math.sqrt(Math.max(0, R * R - rr * rr));
  }

  /**
   * Fine solid joins the flocs at a point. It grows a node that is close enough (cluster growth) or
   * spawns a new node that is linked to its neighbours, so the structure stays connected.
   */
  addMass(x: number, y: number, z: number, mass: number) {
    const c = this.config;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i], d = Math.hypot(n.x - x, n.y - y, n.z - z);
      // Fine solid joins a floc that is within about one quantum radius of it (cluster growth).
      const reach = Math.max(nodeRadius(n.mass, c), c.quantumRadius) * 1.3;
      if (d < reach && d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && this.nodes[best].mass < c.quantum * 8) { this.nodes[best].mass += mass; return; }
    if (this.nodes.length >= c.maxNodes) {
      // Too many nodes: add to the nearest one instead of creating more.
      let near = 0, nd = Infinity;
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i], d = Math.hypot(n.x - x, n.y - y, n.z - z);
        if (d < nd) { nd = d; near = i; }
      }
      this.nodes[near].mass += mass; return;
    }
    const index = this.nodes.length;
    this.nodes.push({ x, y, z, vx: 0, vy: 0, vz: 0, mass, resting: false });
    this.adjacency.push([]);
    // Link to the nearest nodes within range so the new piece belongs to a connected structure.
    const candidates: { j: number; d: number }[] = [];
    for (let j = 0; j < index; j++) {
      const n = this.nodes[j], d = Math.hypot(n.x - x, n.y - y, n.z - z);
      if (d < c.linkRange && this.adjacency[j].length < c.maxLinksPerNode) candidates.push({ j, d });
    }
    candidates.sort((p, q) => p.d - q.d);
    for (const { j, d } of candidates.slice(0, 3)) this.link(index, j, Math.max(d, c.quantumRadius * 0.8));
  }

  private link(a: number, b: number, rest: number) {
    this.links.push({ a, b, rest });
    this.adjacency[a].push(b); this.adjacency[b].push(a);
  }

  /** Advance by dt seconds. `sample` returns the carrier flow; `up` is the unit vector against gravity. */
  step(dt: number, sample: FlowSampler, upY = 1) {
    const c = this.config, flow = this.flow;
    for (const n of this.nodes) {
      const r = nodeRadius(n.mass, c);
      const inside = sample(n.x, n.y, n.z, flow);
      const ux = inside ? flow[0] : 0, uy = inside ? flow[1] : 0, uz = inside ? flow[2] : 0;
      // Velocity relaxes towards fluid velocity plus the slip from gravity, buoyancy and drag.
      const slip = slipSpeed(r, c) * (upY >= 0 ? -1 : 1);
      const k = 1 - Math.exp(-dt / c.relaxation);
      n.vx += (ux - n.vx) * k; n.vy += (uy + slip - n.vy) * k; n.vz += (uz - n.vz) * k;
      n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
    }
    for (let sweep = 0; sweep < 3; sweep++) { this.relaxLinks(); this.separate(); this.confine(); }
    if (c.allowBreakage) this.breakLinks();
  }

  /** Position-based link constraint with plastic yield: no elastic recovery of the rest length. */
  private relaxLinks() {
    const c = this.config;
    for (const l of this.links) {
      const a = this.nodes[l.a], b = this.nodes[l.b];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz) || 1e-9;
      const stretch = d / l.rest;
      if (stretch > 1) {
        // Beyond the rest length the nodes are pulled back by a share of the excess, split by mass.
        const excess = (d - l.rest) * c.linkStiffness;
        const wa = b.mass / (a.mass + b.mass), wb = a.mass / (a.mass + b.mass);
        const nx = dx / d, ny = dy / d, nz = dz / d;
        a.x += nx * excess * wa; a.y += ny * excess * wa; a.z += nz * excess * wa;
        b.x -= nx * excess * wb; b.y -= ny * excess * wb; b.z -= nz * excess * wb;
        if (stretch > c.yieldStretch) l.rest += (d - l.rest) * c.plasticShare * 0.1;
      }
    }
  }

  /** Soft limit on interpenetration: nodes overlap like wool, but not completely. */
  private separate() {
    const c = this.config, nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const ra = nodeRadius(a.mass, c), rb = nodeRadius(b.mass, c), min = 0.55 * (ra + rb);
      if (d2 >= min * min || d2 < 1e-18) continue;
      const d = Math.sqrt(d2), push = (min - d) * 0.5;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      a.x -= nx * push; a.y -= ny * push; a.z -= nz * push;
      b.x += nx * push; b.y += ny * push; b.z += nz * push;
    }
  }

  /** Glass wall and rounded floor; a node that touches the floor rests there. */
  private confine() {
    const c = this.config, R = c.radius;
    for (const n of this.nodes) {
      const r = nodeRadius(n.mass, c) * 0.5;
      const radial = Math.hypot(n.x, n.z), limit = R - r;
      if (radial > limit && radial > 1e-9) { n.x *= limit / radial; n.z *= limit / radial; n.vx *= 0.3; n.vz *= 0.3; }
      const floor = this.floorHeight(Math.hypot(n.x, n.z)) + r;
      if (n.y < floor) { n.y = floor; n.vy = Math.max(0, n.vy); n.resting = true; } else n.resting = false;
    }
  }

  private breakLinks() {
    const c = this.config;
    for (let k = this.links.length - 1; k >= 0; k--) {
      const l = this.links[k], a = this.nodes[l.a], b = this.nodes[l.b];
      if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / l.rest > c.breakStretch) {
        this.adjacency[l.a] = this.adjacency[l.a].filter(i => i !== l.b);
        this.adjacency[l.b] = this.adjacency[l.b].filter(i => i !== l.a);
        this.links.splice(k, 1);
      }
    }
  }

  /** Connected component sizes (nodes), largest first. */
  componentSizes() {
    const seen = new Uint8Array(this.nodes.length), sizes: number[] = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (seen[s]) continue;
      let count = 0; const stack = [s]; seen[s] = 1;
      while (stack.length) { const i = stack.pop()!; count++; for (const j of this.adjacency[i]) if (!seen[j]) { seen[j] = 1; stack.push(j); } }
      sizes.push(count);
    }
    return sizes.sort((p, q) => q - p);
  }

  /**
   * Deposit node mass into a grid (exact: every node distributes exactly its mass over the voxels it covers)
   * and, optionally, a visual-only bridge density along links so connected parts read as one body.
   */
  rasterize(mass: Float32Array, visual: Float32Array, nx: number, ny: number, nz: number, scale: number) {
    const c = this.config, R = c.radius;
    mass.fill(0); visual.fill(0);
    const cx = nx / (2 * R), cy = ny / c.height, cz = nz / (2 * R);
    const scratch = this.scratch;
    // Each splat computes its Gaussian weights once, normalises them to the amount, and adds to up to two targets.
    const splat = (x: number, y: number, z: number, radius: number, amountA: number, targetA: Float32Array | null, amountB: number, targetB: Float32Array) => {
      const gx = (x + R) * cx - 0.5, gy = (y - c.bottom) * cy - 0.5, gz = (z + R) * cz - 0.5;
      const rx = radius * cx * 1.3 + 0.5, ry = radius * cy * 1.3 + 0.5, rz = radius * cz * 1.3 + 0.5;
      const x0 = Math.max(0, Math.floor(gx - rx)), x1 = Math.min(nx - 1, Math.ceil(gx + rx));
      const y0 = Math.max(0, Math.floor(gy - ry)), y1 = Math.min(ny - 1, Math.ceil(gy + ry));
      const z0 = Math.max(0, Math.floor(gz - rz)), z1 = Math.min(nz - 1, Math.ceil(gz + rz));
      const inv = 1 / (0.5 * radius * radius);
      let total = 0, n = 0;
      for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const dx = (i - gx) / cx, dy = (j - gy) / cy, dz = (k - gz) / cz;
        const w = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv);
        if (n < scratch.length) scratch[n] = w;
        total += w; n++;
      }
      if (total <= 0) return;
      n = 0;
      for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const w = scratch[n++] / total, at = (k * ny + j) * nx + i;
        if (targetA) targetA[at] += amountA * w;
        targetB[at] += amountB * w;
      }
    };
    for (const n of this.nodes) {
      const r = nodeRadius(n.mass, c);
      splat(n.x, n.y, n.z, r, n.mass * scale, mass, n.mass * scale, visual);
    }
    for (const l of this.links) {
      const a = this.nodes[l.a], b = this.nodes[l.b];
      const bridge = 0.35 * Math.min(a.mass, b.mass);
      const rr = 0.6 * Math.min(nodeRadius(a.mass, c), nodeRadius(b.mass, c));
      splat((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, rr, 0, null, bridge * scale, visual);
    }
  }
}
