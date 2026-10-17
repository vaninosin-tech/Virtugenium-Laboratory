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
  eddyDiffusivity: number;
  /** Erosion of fine particles from loose parts: rate (1/s) at the reference relative speed (m/s). */
  erosionRate: number; erosionRef: number;
  /** Compaction: load that gives half pressure, rate (1/s), extra settling of a compacted node. */
  compactionLoad: number; compactionRate: number; compactionSlip: number;
  /** Minimum centre distance as a share of the sum of radii (soft contact; <1 means wool-like overlap). */
  contact: number;
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
  quantum: 0.03,
  quantumRadius: 0.0021,
  fractalDimension: 1.9,
  solidFraction: 0.00018,
  liquidDensity: 1000, solidDensity: 5560,
  dragCoefficient: 1.1,
  relaxation: 0.12,
  linkRange: 0.0034,
  maxLinksPerNode: 3,
  /** Turbulent dispersion of a node (m^2/s): eddies of the stream scatter the pieces sideways. */
  eddyDiffusivity: 6e-6,
  erosionRate: 0.3, erosionRef: 0.003,
  compactionLoad: 0.05, compactionRate: 0.9, compactionSlip: 2.5,
  contact: 0.75,
  linkStiffness: 0.35,
  yieldStretch: 1.25, plasticShare: 0.5,
  breakStretch: 2.4,
  allowBreakage: true,
  maxNodes: 260,
};

export interface FlocNode {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  mass: number;
  /** Carrier flow seen at the last step (for the relative velocity). */
  ux: number; uy: number; uz: number;
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
  /** Height of the free surface (m); set by the caller each step. */
  surfaceY = Infinity;
  private readonly flow: [number, number, number] = [0, 0, 0];
  private readonly adjacency: number[][] = [];
  private readonly scratch = new Float32Array(32768);
  private rasterNx = 0; private rasterNy = 0; private rasterNz = 0;
  private rasterCx = 0; private rasterCy = 0; private rasterCz = 0;
  private readonly radii: number[] = [];
  private load = new Float64Array(0);
  private readonly cells = new Map<number, number[]>();
  private readonly columns = new Map<number, number[]>();
  private readonly candidates: number[] = [];
  private maxRadius = 0;

  private insertCell(i: number) {
    const n = this.nodes[i], inv = 1 / this.config.linkRange;
    const x = Math.floor(n.x * inv), y = Math.floor(n.y * inv), z = Math.floor(n.z * inv);
    const key = this.cellKey(x, y, z);
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = []; this.cells.set(key, bucket); }
    bucket.push(i);
    const columnKey = this.columnKey(x, z);
    let column = this.columns.get(columnKey);
    if (!column) { column = []; this.columns.set(columnKey, column); }
    column.push(i);
  }

  private cellKey(x: number, y: number, z: number) {
    return (x + 512) + (y + 512) * 1024 + (z + 512) * 1048576;
  }
  private columnKey(x: number, z: number) { return (x + 512) + (z + 512) * 1024; }

  /** Reuse the buckets; node order in each bucket is insertion order. */
  private rebuildCells() {
    for (const bucket of this.cells.values()) bucket.length = 0;
    for (const bucket of this.columns.values()) bucket.length = 0;
    this.maxRadius = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const r = nodeRadius(n.mass, this.config);
      this.radii[i] = r;
      if (r > this.maxRadius) this.maxRadius = r;
      this.insertCell(i);
    }
  }

  /** Candidate indices in ascending order, preserving the old pair accumulation order. */
  private nearby(i: number, horizontal: number, vertical = horizontal) {
    const n = this.nodes[i], inv = 1 / this.config.linkRange, found = this.candidates;
    found.length = 0;
    const x0 = Math.floor((n.x - horizontal) * inv), x1 = Math.floor((n.x + horizontal) * inv);
    const y0 = Math.floor((n.y - vertical) * inv), y1 = Math.floor((n.y + vertical) * inv);
    const z0 = Math.floor((n.z - horizontal) * inv), z1 = Math.floor((n.z + horizontal) * inv);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const bucket = this.cells.get(this.cellKey(x, y, z));
      if (bucket) for (const j of bucket) if (j !== i) found.push(j);
    }
    // Bucket order is deterministic (insertion order, fixed loop order), so no sort is needed.
    return found;
  }

  private nearbyColumn(i: number, horizontal: number) {
    const n = this.nodes[i], inv = 1 / this.config.linkRange, found = this.candidates;
    found.length = 0;
    const x0 = Math.floor((n.x - horizontal) * inv), x1 = Math.floor((n.x + horizontal) * inv);
    const z0 = Math.floor((n.z - horizontal) * inv), z1 = Math.floor((n.z + horizontal) * inv);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const bucket = this.columns.get(this.columnKey(x, z));
      if (bucket) for (const j of bucket) if (j !== i) found.push(j);
    }
    found.sort((a, b) => a - b);
    return found;
  }

  private nearbyPoint(x: number, y: number, z: number, reach: number) {
    const inv = 1 / this.config.linkRange, found = this.candidates;
    found.length = 0;
    const x0 = Math.floor((x - reach) * inv), x1 = Math.floor((x + reach) * inv);
    const y0 = Math.floor((y - reach) * inv), y1 = Math.floor((y + reach) * inv);
    const z0 = Math.floor((z - reach) * inv), z1 = Math.floor((z + reach) * inv);
    for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const bucket = this.cells.get(this.cellKey(ix, iy, iz));
      if (bucket) for (const i of bucket) found.push(i);
    }
    found.sort((a, b) => a - b);
    return found;
  }

  constructor(config: FlocConfig) {
    this.config = config;
    this.compaction = new Float64Array(config.maxNodes);
    this.load = new Float64Array(config.maxNodes);
  }

  get totalMass() { let sum = 0; for (const n of this.nodes) sum += n.mass; for (const q of this.pending) sum += q.mass; return sum; }
  /** Mass waiting for a free node slot (it still counts as floc mass; no mass is lost or piled on one node). */
  private readonly pending: { x: number; y: number; z: number; mass: number }[] = [];

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
    for (const i of this.nearbyPoint(x, y, z, Math.max(this.maxRadius, c.quantumRadius) * 1.3)) {
      const n = this.nodes[i], d = Math.hypot(n.x - x, n.y - y, n.z - z);
      // Fine solid joins a floc that is within about one quantum radius of it (cluster growth).
      const reach = Math.max(nodeRadius(n.mass, c), c.quantumRadius) * 1.3;
      if (d < reach && d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && this.nodes[best].mass < c.quantum * 3) {
      this.nodes[best].mass += mass;
      const radius = nodeRadius(this.nodes[best].mass, c);
      if (radius > this.maxRadius) this.maxRadius = radius;
      return;
    }
    if (this.nodes.length >= c.maxNodes) {
      // Node budget exhausted: keep the mass in the pending list (merged into a nearby node only if it stays small),
      // and let step() free a slot by merging the two lightest neighbouring nodes. A node never grows without bound.
      this.pending.push({ x, y, z, mass });
      return;
    }
    const index = this.nodes.length;
    this.nodes.push({ x, y, z, vx: 0, vy: 0, vz: 0, mass, ux: 0, uy: 0, uz: 0, resting: false });
    this.compaction[index] = 0;
    this.adjacency.push([]);
    // Link to the nearest nodes within range so the new piece belongs to a connected structure.
    const candidates: { j: number; d: number }[] = [];
    for (const j of this.nearbyPoint(x, y, z, c.linkRange)) {
      const n = this.nodes[j], d = Math.hypot(n.x - x, n.y - y, n.z - z);
      if (d < c.linkRange && this.adjacency[j].length < c.maxLinksPerNode) candidates.push({ j, d });
    }
    candidates.sort((p, q) => p.d - q.d);
    for (const { j, d } of candidates.slice(0, 2)) this.link(index, j, Math.max(d, c.quantumRadius * 0.8));
    this.insertCell(index);
    const radius = nodeRadius(mass, c);
    if (radius > this.maxRadius) this.maxRadius = radius;
  }

  private link(a: number, b: number, rest: number) {
    this.links.push({ a, b, rest });
    this.adjacency[a].push(b); this.adjacency[b].push(a);
  }

  /** Advance by dt seconds. `sample` returns the carrier flow; `up` is the unit vector against gravity. */
  private tick = 0;
  step(dt: number, sample: FlowSampler, upY = 1) {
    const c = this.config, flow = this.flow;
    this.tick++;
    this.mergeAndFlush();
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i], r = nodeRadius(n.mass, c);
      this.radii[i] = r;
      const inside = sample(n.x, n.y, n.z, flow);
      const ux = inside ? flow[0] : 0, uy = inside ? flow[1] : 0, uz = inside ? flow[2] : 0;
      n.ux = ux; n.uy = uy; n.uz = uz;
      // Velocity relaxes towards fluid velocity plus the slip from gravity, buoyancy and drag.
      // A node that touches the free surface is held by surface tension (a raft): it only leaves the surface when
      // crowded out by neighbours (the separation step), not by time.
      const slip = slipSpeed(r, c) * (1 + c.compactionSlip * this.compactionOf(i)) * (upY >= 0 ? -1 : 1);
      const k = 1 - Math.exp(-dt / c.relaxation);
      // At the free surface the vertical carrier flow is blocked: a raft is only swept sideways there.
      n.vx += (ux - n.vx) * k; n.vy += (uy + slip - n.vy) * k; n.vz += (uz - n.vz) * k;
      // Eddy dispersion grows with the local flow speed; the draw is a deterministic hash of node and step.
      const flowSpeed = Math.hypot(ux, uy, uz), eddy = Math.sqrt(2 * c.eddyDiffusivity * dt) * (0.3 + Math.min(1, flowSpeed / 0.01));
      const hid = i * 12.9898 + this.tick * 78.233;
      const hx = Math.sin(hid + 37.719) * 43758.5453;
      const hy = Math.sin(hid + 2 * 37.719) * 43758.5453;
      const hz = Math.sin(hid + 3 * 37.719) * 43758.5453;
      n.x += n.vx * dt + eddy * ((hx - Math.floor(hx)) * 2 - 1);
      n.y += n.vy * dt + eddy * 0.5 * ((hy - Math.floor(hy)) * 2 - 1);
      n.z += n.vz * dt + eddy * ((hz - Math.floor(hz)) * 2 - 1);
    }
    this.rebuildCells();
    this.compact(dt);
    // A link breaks from the stretch the flow has just imposed, before the constraint pulls the nodes back.
    if (c.allowBreakage) this.breakLinks();
    for (let sweep = 0; sweep < 3; sweep++) { this.relaxLinks(); this.separate(); this.confine(); }
    this.rebuildCells();
  }

  /** Free node slots by merging the lightest close pair, then place pending mass in the freed slots. */
  private mergeAndFlush() {
    const c = this.config, nodes = this.nodes;
    let guard = 0;
    while (this.pending.length && guard++ < 8) {
      if (nodes.length >= c.maxNodes) {
        let bi = -1, bj = -1, best = Infinity;
        this.rebuildCells();
        for (let i = 0; i < nodes.length; i++) for (const j of this.nearby(i, c.linkRange * 1.3)) {
          if (j <= i) continue;
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y, nodes[i].z - nodes[j].z);
          if (d > c.linkRange * 1.3) continue;
          const cost = nodes[i].mass + nodes[j].mass + d * 10;
          if (cost < best) { best = cost; bi = i; bj = j; }
        }
        if (bi < 0) break;
        this.mergeNodes(bi, bj);
      }
      const q = this.pending.shift()!;
      this.addMass(q.x, q.y, q.z, q.mass);
    }
  }

  private mergeNodes(i: number, j: number) {
    const a = this.nodes[i], b = this.nodes[j], m = a.mass + b.mass;
    a.x = (a.x * a.mass + b.x * b.mass) / m; a.y = (a.y * a.mass + b.y * b.mass) / m; a.z = (a.z * a.mass + b.z * b.mass) / m;
    a.vx = (a.vx * a.mass + b.vx * b.mass) / m; a.vy = (a.vy * a.mass + b.vy * b.mass) / m; a.vz = (a.vz * a.mass + b.vz * b.mass) / m;
    a.mass = m;
    // re-point b's links to a (drop self links and duplicates), then remove node j by swapping the last node in.
    const last = this.nodes.length - 1;
    for (const l of this.links) { if (l.a === j) l.a = i; if (l.b === j) l.b = i; }
    for (let k = this.links.length - 1; k >= 0; k--) if (this.links[k].a === this.links[k].b) this.links.splice(k, 1);
    if (j !== last) {
      for (const l of this.links) { if (l.a === last) l.a = j; if (l.b === last) l.b = j; }
      this.nodes[j] = this.nodes[last];
      if (this.compaction.length > j) this.compaction[j] = last < this.compaction.length ? this.compaction[last] : 0;
    }
    this.nodes.pop();
    this.rebuildCells();
    // The old variable-length array was sliced to this size. A later spawn triggers the reset in compact().
    this.compactionCount = this.nodes.length;
    this.adjacency.length = 0;
    for (let k = 0; k < this.nodes.length; k++) this.adjacency.push([]);
    for (const l of this.links) { this.adjacency[l.a].push(l.b); this.adjacency[l.b].push(l.a); }
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
    const reach = c.contact * (2 * this.maxRadius) + c.linkRange;
    for (let i = 0; i < nodes.length; i++) for (const j of this.nearby(i, reach)) {
      if (j <= i) continue;
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const ra = this.radii[i], rb = this.radii[j], min = c.contact * (ra + rb);
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
      if (n.y < floor) { n.y = floor; n.vy = Math.max(0, n.vy); n.vx *= 0.2; n.vz *= 0.2; n.resting = true; } else n.resting = false;
      // The free surface holds a node: it cannot leave the liquid, it floats half in.
      // The liquid boundary only: a node is carried with the liquid and cannot leave it (no pinning, no hold height).
      const ceiling = this.surfaceY + 0.5 * r;
      if (n.y > ceiling) { n.y = ceiling; n.vy = Math.min(0, n.vy); }
    }
  }

  /**
   * Compaction under load: a node carries the weight of the connected nodes above it. Under load its links shorten
   * (rest length shrinks, permanently) and its pores close (solid fraction rises). Cause is load, never time.
   */
  private compact(dt: number) {
    const c = this.config, nodes = this.nodes;
    if (this.compactionCount !== nodes.length) {
      this.compaction.fill(0);
      this.compactionCount = nodes.length;
    }
    const load = this.load;
    load.fill(0, 0, nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const reachMax = (this.radii[i] + this.maxRadius) * 2.2;
      for (const j of this.nearbyColumn(i, reachMax)) {
        const a = nodes[i], b = nodes[j];
        if (b.y <= a.y) continue;
        const dx = b.x - a.x, dz = b.z - a.z, reach = (this.radii[i] + this.radii[j]) * 2.2;
        if (dx * dx + dz * dz < reach * reach && b.y - a.y < 8 * reach) load[i] += b.mass;
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const pressure = load[i] / (load[i] + c.compactionLoad);
      this.compaction[i] = Math.min(1, this.compaction[i] + pressure * c.compactionRate * dt);
    }
    for (const l of this.links) {
      const k = 0.5 * (this.compaction[l.a] + this.compaction[l.b]);
      l.rest = Math.max(c.quantumRadius * 0.5, l.rest * (1 - 0.6 * k * dt));
    }
  }
  /**
   * Erosion: the flow strips fine particles off the loose, uncompacted parts of a floc. The rate grows with the
   * velocity of the node relative to the surrounding liquid (shear) and with how open the structure is; dense
   * compacted cores are left alone. The stripped mass is returned to the caller (it becomes fine suspension).
   */
  erode(dt: number, emit: (x: number, y: number, z: number, mass: number) => void) {
    const c = this.config;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const rel = Math.hypot(n.vx - n.ux, n.vy - n.uy, n.vz - n.uz);
      const open = 1 - this.compactionOf(i);
      const rate = c.erosionRate * open * Math.min(1, rel / c.erosionRef);
      const moved = Math.min(n.mass * 0.5, n.mass * rate * dt);
      if (moved <= 1e-12) continue;
      n.mass -= moved; emit(n.x, n.y, n.z, moved);
    }
  }
  /** 0 (fluffy) to 1 (fully compacted) for a node; used for solid fraction and for the look of the curd. */
  compactionOf(i: number) { return this.compaction?.[i] ?? 0; }
  private compaction = new Float64Array(0);
  private compactionCount = 0;

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
  private splat(x: number, y: number, z: number, radius: number, amountA: number,
    targetA: Float32Array | null, amountB: number, targetB: Float32Array) {
      const c = this.config, R = c.radius;
      const nx = this.rasterNx, ny = this.rasterNy, nz = this.rasterNz;
      const cx = this.rasterCx, cy = this.rasterCy, cz = this.rasterCz, scratch = this.scratch;
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
  }

  rasterize(mass: Float32Array, visual: Float32Array, nx: number, ny: number, nz: number, scale: number) {
    const c = this.config, R = c.radius;
    mass.fill(0); visual.fill(0);
    this.rasterNx = nx; this.rasterNy = ny; this.rasterNz = nz;
    this.rasterCx = nx / (2 * R); this.rasterCy = ny / c.height; this.rasterCz = nz / (2 * R);
    for (let index = 0; index < this.nodes.length; index++) {
      const n = this.nodes[index], r = nodeRadius(n.mass, c);
      // Deterministic irregularity: every node is a slightly different lump, so no two are alike and the raft is ragged.
      const h = Math.sin(index * 12.9898) * 43758.5453, j = h - Math.floor(h);
      const lump = 0.8 + 0.5 * j;
      this.splat(n.x, n.y, n.z, r * lump, n.mass * scale, mass, n.mass * scale, visual);
      // Wet cotton has hanging lobes: a lighter tuft below and to the side that follows the node's own motion.
      const tuftMass = n.mass * 0.18, speed = Math.hypot(n.vx, n.vy, n.vz) + 1e-9;
      const tx = n.x - n.vx / speed * r * 0.9 + (j - 0.5) * r, ty = n.y - Math.abs(n.vy) / speed * r * 0.9 - r * 0.4, tz = n.z - n.vz / speed * r * 0.9 + (0.5 - j) * r;
      this.splat(tx, ty, tz, r * 0.6, 0, null, tuftMass * scale, visual);
    }
    for (const l of this.links) {
      const a = this.nodes[l.a], b = this.nodes[l.b];
      const bridge = 0.35 * Math.min(a.mass, b.mass);
      const rr = 0.6 * Math.min(nodeRadius(a.mass, c), nodeRadius(b.mass, c));
      this.splat((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, rr, 0, null, bridge * scale, visual);
    }
  }
}
