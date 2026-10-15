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
  /** Fraction of the settling slip that remains for a node held at the surface. */
  surfaceHold: number;
  /** Share of the vertical carrier flow that the free surface blocks for a node lying in it. */
  surfaceBlock: number;
  /** Mass (normalised reagent units) the free surface holds before new cotton displaces it downward. */
  surfaceCapacity: number;
  /** How fast the excess is displaced (1/s). */
  displacementRate: number;
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
  surfaceHold: 0.04,
  surfaceBlock: 0.85,
  surfaceCapacity: 0.06,
  displacementRate: 4,
  contact: 0.75,
  linkStiffness: 0.35,
  yieldStretch: 1.25, plasticShare: 0.5,
  breakStretch: 3.0,
  allowBreakage: false,
  maxNodes: 260,
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
  /** Height of the free surface (m); set by the caller each step. */
  surfaceY = Infinity;
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
    if (best >= 0 && this.nodes[best].mass < c.quantum * 3) { this.nodes[best].mass += mass; return; }
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
    for (const { j, d } of candidates.slice(0, 2)) this.link(index, j, Math.max(d, c.quantumRadius * 0.8));
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
    for (const n of this.nodes) {
      const r = nodeRadius(n.mass, c);
      const inside = sample(n.x, n.y, n.z, flow);
      const ux = inside ? flow[0] : 0, uy = inside ? flow[1] : 0, uz = inside ? flow[2] : 0;
      // Velocity relaxes towards fluid velocity plus the slip from gravity, buoyancy and drag.
      // A node that touches the free surface is held by surface tension (a raft): it only leaves the surface when
      // crowded out by neighbours (the separation step), not by time.
      const atSurface = n.y > this.surfaceY - 1.3 * r;
      const slip = slipSpeed(r, c) * (upY >= 0 ? -1 : 1) * (atSurface ? c.surfaceHold : 1);
      const k = 1 - Math.exp(-dt / c.relaxation);
      // At the free surface the vertical carrier flow is blocked: a raft is only swept sideways there.
      const uyEff = atSurface ? uy * (1 - c.surfaceBlock) : uy;
      n.vx += (ux - n.vx) * k; n.vy += (uyEff + slip - n.vy) * k; n.vz += (uz - n.vz) * k;
      // Eddy dispersion grows with the local flow speed; the draw is a deterministic hash of node and step.
      const flowSpeed = Math.hypot(ux, uy, uz), eddy = Math.sqrt(2 * c.eddyDiffusivity * dt) * (0.3 + Math.min(1, flowSpeed / 0.01));
      const hid = this.nodes.indexOf(n) * 12.9898 + this.tick * 78.233;
      const rnd = (o: number) => { const v = Math.sin(hid + o * 37.719) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };
      n.x += n.vx * dt + eddy * rnd(1); n.y += n.vy * dt + eddy * 0.5 * rnd(2); n.z += n.vz * dt + eddy * rnd(3);
    }
    this.crowdSurface(dt);
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
        // A node held in the free surface is not dragged down by its links; the lower node is pulled up instead.
        const heldA = a.y > this.surfaceY - 1.3 * nodeRadius(a.mass, c), heldB = b.y > this.surfaceY - 1.3 * nodeRadius(b.mass, c);
        const lift = (heldA && !heldB) ? 1 : (heldB && !heldA) ? -1 : 0;
        a.x += nx * excess * wa; a.z += nz * excess * wa;
        b.x -= nx * excess * wb; b.z -= nz * excess * wb;
        if (lift === 0) { a.y += ny * excess * wa; b.y -= ny * excess * wb; }
        else if (lift === 1) { b.y -= ny * excess; }
        else { a.y += ny * excess; }
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
      const ra = nodeRadius(a.mass, c), rb = nodeRadius(b.mass, c), min = c.contact * (ra + rb);
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
      const ceiling = this.surfaceY - 0.6 * r;
      if (n.y > ceiling) { n.y = ceiling; n.vy = Math.min(0, n.vy); }
    }
  }

  /**
   * The free surface can hold a limited mass per unit area (surface tension against the weight of wet cotton).
   * New cotton arriving at the surface crowds it: the most crowded surface nodes are pushed below and released
   * (they lose the surface hold), so the raft is renewed from above and drains downward. No timer is involved.
   */
  private crowdSurface(dt: number) {
    const c = this.config, held: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.y > this.surfaceY - 1.3 * nodeRadius(n.mass, c)) held.push(i);
    }
    if (!held.length) return;
    const area = Math.PI * c.radius * c.radius;
    let mass = 0; for (const i of held) mass += this.nodes[i].mass;
    const capacity = c.surfaceCapacity;
    if (mass <= capacity) return;
    // Push down the nodes with the largest local overlap first; a node is displaced by the excess share per second.
    const share = Math.min(1, (mass - capacity) / mass * c.displacementRate * dt);
    const order = held.map(i => {
      let crowd = 0;
      for (const j of held) if (j !== i) { const a = this.nodes[i], b = this.nodes[j]; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < 2.2 * c.quantumRadius) crowd++; }
      return { i, crowd };
    }).sort((p, q) => q.crowd - p.crowd);
    const count = Math.max(1, Math.round(held.length * share));
    for (let k = 0; k < count && k < order.length; k++) {
      const n = this.nodes[order[k].i], r = nodeRadius(n.mass, c);
      n.y = this.surfaceY - 1.5 * r; n.vy = Math.min(n.vy, -slipSpeed(r, c));
    }
    void area;
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
