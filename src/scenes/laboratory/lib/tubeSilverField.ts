import * as THREE from "three";
import { LiquidMask, SpeciesField, VelocityField } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { SilverSedimentField } from "./tubeSilverSediment";
import { TubeFlowSolver } from "./tubeFlowSolver";
import { precipitatePair, settleParticleClass } from "./tubePrecipitationPhysics";
import { silverStage, silverDiagnostic } from "./silverStage";
import { DEFAULT_FLOC_CONFIG, FlocSystem } from "./night/stage1/flocSystem";

/** Stage-one precipitate partition: visible curd and conserved, optically hidden fine solid. */
const STAGE_ONE_DENSE_FRACTION = 0.8;
/** Surface film: layers that spread, thickness the film holds (normalised), peel rate, air that stays with the film. */
const SURFACE_LAYERS = 2, SURFACE_SPREAD = 0.25, SURFACE_CAP = 1.3, SURFACE_PEEL = 0.2, SURFACE_AIR_KEPT = 0.2;
/** Share of the film that wets and drains each second. */
const SURFACE_LEAK = 0.06;
/** Passes of lateral spreading per step so the film can cover the whole surface within about a second. */
const SURFACE_SPREAD_PASSES = 8;
/** How much less a heap holds at the glass than at its centre. */
const HEAP_EDGE = 0.45;
/** Sideways dispersion of fresh cotton: passes per step and share of the gap moved per pass. */
const YOUNG_PASSES = 2, YOUNG_SPREAD = 0.2;
/** Haze shed by cotton per second (base, extra in the dense core). */
/** Chips torn off per second (share of the ragged parts) and how fast they sink (m/s). */
const CHIP_RATE = 0.002, CHIP_SINK = 0.012;
const HAZE_BASE = 0.002, HAZE_CORE = 0.004, HAZE_DILUTE = 0.04;
/** Share of the smoke that dissolves into the water tint each second. */
const SMOKE_TO_TINT = 0.03;
/** Cotton sets into curd with age: it sinks faster and presses harder (seconds, extra settling and load factors). */
/** Fractal dimension of the aggregates (reaction-limited cluster aggregation, literature range 1.4 to 2.8). */
const FRACTAL_DIMENSION = 1.9;
/** Surface raft: rows below the meniscus in which cotton is held, and the factor on its settling there. */
const RAFT_ROWS = 3, RAFT_HOLD = 0.04;
/** Settling law: speed of a unit aggregate (m/s), upper bound, growth time (s) and the flow speed that halves the size. */
const AGG_V0 = 0.0011, AGG_MAX_SPEED = 0.008, AGG_GROWTH_TIME = 6, AGG_BREAK_SHEAR = 0.05;
/** Rate (per unit relative concentration per second) at which fine solid joins flocs (Smoluchowski-like, ~ c). */
const FLOC_SOLID_FRACTION = () => { const v = (globalThis as { __silverPhi?: unknown }).__silverPhi; return typeof v === "number" ? v : 0.00003; };
const FLOC_MIN_PARCEL = 5e-6;
const FLOC_AGGREGATION = 14, FLOC_C0 = 0.25;
const HARDEN_FROM = 2.5, HARDEN_TO = 9, HARDEN_LOAD = 2;

/** R3 bookkeeping in normalized amounts. */
export function reactR2(silver: number, chloride: number, fraction = 1) {
  const extent = Math.min(Math.max(0, silver), Math.max(0, chloride))
    * THREE.MathUtils.clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  return { silver: silver - extent, chloride: chloride - extent, precipitate: extent };
}
export interface FlocAggregate {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mass: number;
  porosity: number;
  shape: number;
  segregated?: boolean;
}

/** Fine suspension, rare coarse aggregates, and a conserved bottom reservoir. */
export class TubeSilverField {
  readonly mask: LiquidMask;
  readonly velocity: VelocityField;
  readonly solver: TubeFlowSolver;
  readonly species: Record<string, SpeciesField>;
  readonly suspension: Float64Array[];
  readonly coarse: Float64Array;
  readonly flocs: FlocAggregate[] = [];
  readonly tracer: Float64Array;
  readonly productSource: Float64Array;
  readonly dense: Float64Array;
  /** Conserved mass-weighted birth coordinates (0-2), trapped air (3) and birth time (4), advected with the solid. */
  readonly denseCoordinates: Float64Array[];
  readonly densePixels: Float32Array;
  readonly denseTexture: THREE.Data3DTexture;
  readonly overlapPixels: Float32Array;
  readonly overlapTexture: THREE.Data3DTexture;
  readonly sedimentField: SilverSedimentField;
  /** Stage 1: dissolved tint of the water (suspension[1]) as a texture; `texture` then carries only the smoke. */
  readonly tintPixels: Float32Array;
  readonly tintTexture: THREE.Data3DTexture;
  /** Stage 1: small torn-off chips (`coarse`) as a texture. */
  readonly chipPixels: Float32Array;
  readonly chipTexture: THREE.Data3DTexture;
  readonly pixels: Float32Array;
  readonly texture: THREE.Data3DTexture;
  extent = 0;
  delivered = 0;
  private age = 0;
  private settlingBoost = 1;
  private accumulator = 0;
  private readonly scratch = new THREE.Vector3();
  private readonly wallJet = new THREE.Vector3();
  private readonly next: Float64Array;
  private readonly flow: Float32Array;
  private readonly priorUp = new THREE.Vector3(Infinity, Infinity, Infinity);
  private priorLevel = Infinity;
  private initialized = false;
  private readonly stageOne: boolean;
  /** Stage 3: the cotton is a set of cohesive Lagrangian flocs (FlocSystem) instead of a concentration field. */
  readonly flocMode: boolean;
  flocSystem!: FlocSystem;
  private liquidLevel = Infinity;
  private flocMass = new Float32Array(0);
  private flocVisual = new Float32Array(0);
  private readonly down = new THREE.Vector3();
  /** Surface-spreading closure of the plunging jet (alpha, delta are tunable, see the hydrodynamic note). */
  private get surfaceClosure() { return (globalThis as { __silverSpread?: unknown }).__silverSpread !== 0; }
  private get surfaceAlpha() { const v = (globalThis as { __silverAlpha?: unknown }).__silverAlpha; return typeof v === "number" ? v : 0.2; }
  private get surfaceDelta() { const v = (globalThis as { __silverDelta?: unknown }).__silverDelta; return typeof v === "number" ? v : 0.0015; }
  /** Buoyancy of the incoming solution in loadWeight units: g*(drho/rho)*(pour/liquid volume)/loadStrength (0 disables). */
  private get buoyancy() { const v = (globalThis as { __silverBuoy?: unknown }).__silverBuoy; return typeof v === "number" ? v : 0.1; }
  private get ionDiffusivity() {
    const override = (globalThis as { __silverMix?: unknown }).__silverMix;
    return typeof override === "number" ? override : 0.000002;
  }
  private get ionEddy() {
    const override = (globalThis as { __silverEddy?: unknown }).__silverEddy;
    return typeof override === "number" ? override : 0.3;
  }
  /** Stage 1 keeps the stream gentle so the first cotton forms under the surface. */
  private get jetScale() {
    if (!this.stageOne) return 1;
    const override = (globalThis as { __silverJet?: unknown }).__silverJet;
    return typeof override === "number" ? override : 0.1;
  }
  private loadWeight = new Float64Array(0);
  private topCell = new Int32Array(0);
  private filmMass = new Float64Array(0);
  private filmCoordinates: Float64Array[] = [];
  private heapHeight = new Float64Array(0);
  private heapFree = new Int32Array(0);
  private readonly packWeights = new Float64Array(6);
  private readonly packTargets = new Int32Array(6);
  private get packingLimit() {
    const override = (globalThis as { __silverPack?: unknown }).__silverPack;
    return typeof override === "number" ? override : 2.5;
  }
  /** Body force per unit dense concentration (m/s^2); tuned against the reference video. */
  private get loadStrength() {
    const override = (globalThis as { __silverLoad?: unknown }).__silverLoad;
    return typeof override === "number" ? override : 0.005;
  }

  constructor(quality: "LOW" | "MEDIUM" | "HIGH", radius: number, bottom: number, height: number,
    readonly silverAmount = 1.15) {
    this.flocMode = silverStage() === 3;
    this.stageOne = silverStage() === 1 || this.flocMode;
    // Stage 1 carries a connected dense phase and needs the finer field grid.
    // Stage 3 carries the structure in the flocs, so the carrier grid can be coarser (cost grows with the cell count).
    const flocGrid = this.flocMode ? (quality === "LOW" ? { width: 12, height: 24, depth: 12 } : { width: 16, height: 32, depth: 16 }) : null;
    const size = flocGrid ?? (this.stageOne ? (quality === "LOW" ? TUBE_SIMULATION.field.LOW : TUBE_SIMULATION.field.HIGH)
      : quality === "LOW" ? TUBE_SIMULATION.jetFlow.LOW : TUBE_SIMULATION.jetFlow.HIGH);
    this.mask = new LiquidMask(size.width, size.height, size.depth, radius, bottom, height);
    this.velocity = new VelocityField(this.mask);
    this.solver = new TubeFlowSolver(this.mask, this.stageOne ? { lowDiffusion: true, ambientStrength: 0.03 } : {});
    this.species = { "Ag+": new SpeciesField("Ag+", this.mask),
      "Cl-": new SpeciesField("Cl-", this.mask) };
    this.suspension = [0, 1, 2].map(() => new Float64Array(this.mask.data.length));
    this.coarse = new Float64Array(this.mask.data.length);
    this.tracer = new Float64Array(this.mask.data.length);
    this.productSource = new Float64Array(this.mask.data.length);
    this.dense = new Float64Array(this.mask.data.length);
    this.loadWeight = new Float64Array(this.mask.data.length);
    this.denseCoordinates = [0, 1, 2, 3, 4].map(() => new Float64Array(this.mask.data.length));
    this.densePixels = new Float32Array(this.mask.data.length * 4);
    this.overlapPixels = new Float32Array(this.mask.data.length);
    this.denseTexture = new THREE.Data3DTexture(this.densePixels, this.mask.nx, this.mask.ny, this.mask.nz);
    this.overlapTexture = new THREE.Data3DTexture(this.overlapPixels, this.mask.nx, this.mask.ny, this.mask.nz);
    for (const texture of [this.denseTexture, this.overlapTexture]) {
      texture.format = texture === this.denseTexture ? THREE.RGBAFormat : THREE.RedFormat;
      texture.type = THREE.FloatType;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
    }
    this.sedimentField = new SilverSedimentField(this.mask.nx, this.mask.nz);
    this.chipPixels = new Float32Array(this.mask.data.length);
    this.chipTexture = new THREE.Data3DTexture(this.chipPixels, this.mask.nx, this.mask.ny, this.mask.nz);
    this.chipTexture.format = THREE.RedFormat; this.chipTexture.type = THREE.FloatType;
    this.chipTexture.minFilter = this.chipTexture.magFilter = THREE.LinearFilter;
    this.chipTexture.wrapS = this.chipTexture.wrapT = this.chipTexture.wrapR = THREE.ClampToEdgeWrapping;
    this.chipTexture.unpackAlignment = 1; this.chipTexture.needsUpdate = true;
    this.tintPixels = new Float32Array(this.mask.data.length);
    this.tintTexture = new THREE.Data3DTexture(this.tintPixels, this.mask.nx, this.mask.ny, this.mask.nz);
    this.tintTexture.format = THREE.RedFormat; this.tintTexture.type = THREE.FloatType;
    this.tintTexture.minFilter = this.tintTexture.magFilter = THREE.LinearFilter;
    this.tintTexture.wrapS = this.tintTexture.wrapT = this.tintTexture.wrapR = THREE.ClampToEdgeWrapping;
    this.tintTexture.unpackAlignment = 1; this.tintTexture.needsUpdate = true;
    this.next = new Float64Array(this.mask.data.length);
    this.flow = this.solver.flow;
    this.pixels = new Float32Array(this.mask.data.length);
    this.texture = new THREE.Data3DTexture(this.pixels, this.mask.nx, this.mask.ny, this.mask.nz);
    this.texture.format = THREE.RedFormat; this.texture.type = THREE.FloatType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1; this.texture.needsUpdate = true;
  }

  get progress() { return Math.min(1, this.extent); }
  get ageSeconds() { return this.age; }
  get suspensionMass() { return this.suspension.reduce((sum, field) =>
    sum + field.reduce((a, b) => a + b, 0), 0); }
  get sediment() { return this.sedimentField.values; }
  get sedimentMass() { return this.sedimentField.mass; }
  get coarseMass() { return this.flocs.reduce((sum, floc) => sum + floc.mass, 0)
    + this.coarse.reduce((sum, amount) => sum + amount, 0); }
  get denseMass() { return this.flocMode ? (this.flocSystem?.totalMass ?? 0) : this.dense.reduce((sum, amount) => sum + amount, 0); }
  get totalSolidMass() { return this.denseMass + this.suspensionMass + this.coarseMass + this.sedimentMass; }
  get massBalanceError() { return this.totalSolidMass - this.extent; }

  diagnostics() {
    let upper = 0, lower = 0, upperCount = 0, lowerCount = 0, speed = 0;
    const m = this.mask;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const y = Math.floor(i / m.nx) % m.ny;
      if (y >= m.ny / 2) { upper += this.pixels[i]; upperCount++; }
      else { lower += this.pixels[i]; lowerCount++; }
      speed += Math.hypot(this.flow[i * 3], this.flow[i * 3 + 1], this.flow[i * 3 + 2]);
    }
    return { dense: this.denseMass, suspended: this.suspensionMass, coarse: this.coarseMass,
      settled: this.sedimentMass, formed: this.extent, massBalanceError: this.massBalanceError,
      silverRemaining: this.species["Ag+"].total, chlorideRemaining: this.species["Cl-"].total,
      upperTurbidity: upper / Math.max(1, upperCount),
      lowerTurbidity: lower / Math.max(1, lowerCount),
      meanSpeed: speed / Math.max(1, m.activeCount),
      flow: this.solver.diagnostics(), tracer: this.solver.scalarDiagnostics(this.tracer),
      chloride: this.solver.scalarDiagnostics(this.species["Cl-"].values) };
  }

  advance(dt: number, up: THREE.Vector3, level: number, inlet: THREE.Vector3,
    delivery: number, agitation = 0, jetStrength = 1, jetDirection?: THREE.Vector3) {
    const m = this.mask;
    this.liquidLevel = level;
    this.velocity.gravityUp.copy(up);
    // A heavy frame must not snowball: stage 3 never catches up more than 3 steps (simulated time runs slower instead).
    this.accumulator = Math.min(this.flocMode ? 0.15 : 0.5, this.accumulator + Math.max(0, dt));
    while (this.accumulator >= TUBE_SIMULATION.field.stepSeconds - 1e-10) {
      const step = TUBE_SIMULATION.field.stepSeconds;
      this.accumulator -= step; this.age += step;
      if (this.priorUp.distanceToSquared(up) > 0.0004 ||
        Math.abs(this.priorLevel - level) > m.height / m.ny * 0.5) {
        const old = m.data.slice();
        m.update(up, level);
        this.solver.refreshMask();
        this.priorUp.copy(up); this.priorLevel = level;
        // Keep amounts in the closed liquid when a moving meniscus vacates cells.
        for (const values of [...Object.values(this.species).map(s => s.values), ...this.suspension, this.coarse, this.tracer, this.dense, ...this.denseCoordinates]) {
          for (let i = 0; i < old.length; i++) {
            if (!old[i] || m.data[i] || values[i] === 0) continue;
            let nearest = -1, distance = Infinity;
            const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
            for (let a = 0; a < m.activeCount; a++) {
              const j = m.active[a], dx = j % m.nx - x;
              const dy = Math.floor(j / m.nx) % m.ny - y;
              const dz = Math.floor(j / (m.nx * m.ny)) - z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < distance) { distance = d; nearest = j; }
            }
            if (nearest >= 0) values[nearest] += values[i];
            values[i] = 0;
          }
        }
      }
      if (!this.initialized && m.activeCount) {
        for (let a = 0; a < m.activeCount; a++)
          this.species["Ag+"].values[m.active[a]] = this.silverAmount / m.activeCount;
        this.initialized = true;
      }
      const amount = Math.max(0, Math.min(1, delivery) - this.delivered);
      this.inject(inlet, amount, jetStrength);
      if (this.flocMode) {
        // Heavy flocs load the liquid; the poured (lighter) NaCl solution is buoyant: weight is negative where the
        // incoming-solution tracer is. Acceleration = g * (relative density difference) * volume fraction.
        for (let a = 0; a < m.activeCount; a++) {
          const i = m.active[a];
          this.loadWeight[i] = (this.flocMass.length ? this.flocMass[i] / m.activeCount : 0) - this.buoyancy * this.tracer[i];
        }
      } else if (this.stageOne) {
        // Flocs that trapped air at the surface float until the liquid wets them.
        const wetting = Math.exp(-step / 18), air = this.denseCoordinates[3];
        for (let a = 0; a < m.activeCount; a++) {
          const i = m.active[a];
          air[i] *= wetting;
          const lift = this.dense[i] > 1e-20 ? Math.min(1, air[i] / this.dense[i]) : 0;
          this.loadWeight[i] = this.dense[i] * (1 - lift) * (1 + HARDEN_LOAD * this.hardening(i));
        }
      }
      const wall = THREE.MathUtils.smoothstep(Math.hypot(inlet.x, inlet.z) / m.radius, 0.38, 0.80);
      this.wallJet.copy(jetDirection ?? up);
      if (!jetDirection) this.wallJet.negate();
      this.wallJet.x += inlet.x / m.radius * wall * 0.55;
      this.wallJet.z += inlet.z / m.radius * wall * 0.55;
      this.solver.step(step, inlet, this.wallJet,
        amount > 0 ? 0.2 * this.jetScale * Math.min(3, Math.max(0.4, jetStrength)) : 0,
        agitation, agitation > 0.01 ? (x, y, z) => this.velocity.at(x, y, z, this.age) : undefined,
        0, this.stageOne ? { values: this.loadWeight, scale: m.activeCount * this.loadStrength,
          down: this.down.copy(up).negate() } : undefined,
        this.stageOne && amount > 0 && this.surfaceClosure
          ? { x: inlet.x, z: inlet.z, level, flow: Math.max(0.05, jetStrength) * 1e-6, alpha: this.surfaceAlpha,
            delta: this.surfaceDelta, r0: 0.001, relaxation: 12 } : undefined);
      const kinetic = this.solver.diagnostics().energy;
      // The stream stirs the added solution into the Ag+ liquid within about a second.
      const ionMixing = (this.stageOne ? this.ionDiffusivity : 0.00012) + agitation * 0.000003;
      const ionEddy = this.stageOne ? this.ionEddy : undefined;
      for (const field of Object.values(this.species)) this.solver.transport(field.values, step, ionMixing, ionEddy);
      this.solver.transport(this.tracer, step, ionMixing, ionEddy);
      if (this.stageOne && !this.flocMode) {
        this.holdFilm();
        this.solver.transport(this.dense, step, 0);
        for (const coordinate of this.denseCoordinates)
          this.solver.transport(coordinate, step, 0);
        this.releaseFilm();
        this.settleDense(step);
        this.spreadYoung();
        this.compactDense();
        this.packDense();
        this.repose();
        this.spreadSurface();
        this.peelSurface();
        this.emitHaze(step);
        this.shedChips(step);
        this.sinkChips(step);
        this.dissolveSmoke(step);
      }
      const calm = this.delivered >= 0.999 && agitation < 0.02
        && kinetic / Math.max(1, m.activeCount) < 0.00004;
      const targetBoost = calm ? TUBE_SIMULATION.silver.settlingAcceleration : 1;
      this.settlingBoost += (targetBoost - this.settlingBoost) * (1 - Math.exp(-step / 0.8));
      this.sedimentField.settle(step);
      for (let k = 0; k < 3; k++) {
        if (this.stageOne && k === 1) this.solver.transport(this.suspension[k], step, 0.00003, 1);
        else if (this.stageOne && k === 0) this.solver.transport(this.suspension[k], step, 0.000012, 0.6);
        else this.solver.transport(this.suspension[k], step, this.stageOne ? 0.000001 : 0.000018);
        if (!this.stageOne) this.settle(this.suspension[k], step,
          TUBE_SIMULATION.silver.settlingSpeeds[k] * this.settlingBoost);
      }
      this.solver.transport(this.coarse, step, this.stageOne ? 0.000004 : 0.000003, this.stageOne ? 0.8 : undefined);
      const ba = this.species["Ag+"].values, so = this.species["Cl-"].values;
      this.productSource.fill(0);
      const tracerOnly = silverDiagnostic() === "tracer";
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        // Phase A diagnostic (?silverDiag=tracer): precipitation is disabled and only the incoming NaCl is traced.
        const formed = tracerOnly ? 0 : precipitatePair(ba[i], so[i], m.activeCount, 0.0005, step,
          this.suspension[0][i] + this.suspension[1][i] + this.suspension[2][i]);
        ba[i] -= formed; so[i] -= formed; this.extent += formed;
        this.productSource[i] = formed;
        if (this.flocMode) { this.suspension[0][i] += formed; continue; }
        if (this.stageOne) {
          if (formed <= 0) continue;
          const curd = formed * STAGE_ONE_DENSE_FRACTION;
          this.suspension[0][i] += formed - curd;
          // The stream makes the cotton where the reagents meet. Whatever forms in the surface layers is
          // buoyed there as a raft (the rim); the rest is carried down by the flow.
          this.dense[i] += curd;
          this.denseCoordinates[0][i] += curd * ((i % m.nx + 0.5) / m.nx);
          this.denseCoordinates[1][i] += curd * ((Math.floor(i / m.nx) % m.ny + 0.5) / m.ny);
          this.denseCoordinates[2][i] += curd * ((Math.floor(i / (m.nx * m.ny)) + 0.5) / m.nz);
          this.denseCoordinates[4][i] += curd * this.age;
          continue;
        }
        // Dense, freshly nucleated parcels flocculate locally. All visible
        // lobes draw from this solid reservoir; dilute parcels remain fine.
        const flocculation = THREE.MathUtils.smoothstep(
          (formed + this.suspension[0][i]) * m.activeCount, 0.001, 0.035);
        const aggregate = formed * TUBE_SIMULATION.silver.flocMassFraction * flocculation;
        this.coarse[i] += aggregate;
        const fine = formed - aggregate;
        for (let k = 0; k < 3; k++) this.suspension[k][i] += fine * [0.58, 0.28, 0.14][k];
      }
      if (this.flocMode) { this.advanceFlocSystem(step); this.dissolveSmoke(step); }
      if (!this.stageOne) this.advanceFlocs(step, agitation);
      // Redispersion moves an actual fraction of the bottom reservoir into liquid.
      if (agitation > 0.02) for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
        const column = z * m.nx + x;
        for (let y = 0; y < m.ny; y++) {
          const i = m.index(x, y, z);
          if (!m.data[i]) continue;
          const release = this.sedimentField.release(column,
            Math.min(0.3, agitation * step * 1.5));
          this.suspension[0][i] += release;
          break;
        }
      }
      const suspensionMass = this.suspensionMass;
      const opticalMix = THREE.MathUtils.clamp((suspensionMass - 0.10) * 7, 0, 0.78);
      for (let i = 0; i < this.pixels.length; i++) {
        const local = (this.suspension[0][i] + this.suspension[1][i]
          + this.suspension[2][i]) * m.activeCount;
        // Coarse-grain the conserved fine phase as mixing spreads through the
        // liquid. The spatial mean remains the same, so no optical mass appears.
        this.pixels[i] = m.data[i] ? ((1 - opticalMix) * local
          + opticalMix * suspensionMass)
          * TUBE_SIMULATION.silver.suspensionOpticalScale : 0;
        if (this.stageOne) {
          this.pixels[i] = m.data[i] ? this.suspension[0][i] * m.activeCount : 0;
          this.tintPixels[i] = m.data[i] ? this.suspension[1][i] * m.activeCount : 0;
          this.chipPixels[i] = m.data[i] ? this.coarse[i] * m.activeCount : 0;
        }
      }
      if (this.stageOne) { this.tintTexture.needsUpdate = true; this.chipTexture.needsUpdate = true; }
      this.texture.needsUpdate = true;
      if (this.flocMode) {
        for (let i = 0; i < this.flocVisual.length; i++) {
          const offset = i * 4;
          this.densePixels[offset] = this.flocVisual[i];
          this.densePixels[offset + 1] = (i % m.nx + 0.5) / m.nx;
          this.densePixels[offset + 2] = (Math.floor(i / m.nx) % m.ny + 0.5) / m.ny;
          this.densePixels[offset + 3] = (Math.floor(i / (m.nx * m.ny)) + 0.5) / m.nz;
          this.overlapPixels[i] = (silverDiagnostic() === "tracer" ? this.tracer[i] * 6 : this.productSource[i]) * m.activeCount;
        }
        this.denseTexture.needsUpdate = true;
        this.overlapTexture.needsUpdate = true;
      } else if (this.stageOne) {
        for (let i = 0; i < this.dense.length; i++) {
          const mass = this.dense[i];
          const offset = i * 4;
          this.densePixels[offset] = mass * m.activeCount;
          for (let axis = 0; axis < 3; axis++)
            this.densePixels[offset + axis + 1] = mass > 1e-20
              ? this.denseCoordinates[axis][i] / mass : 0;
          this.overlapPixels[i] = (silverDiagnostic() === "tracer" ? this.tracer[i] * 6 : this.productSource[i]) * m.activeCount;
        }
        this.denseTexture.needsUpdate = true;
        this.overlapTexture.needsUpdate = true;
      }
    }
  }

  /**
   * Settling speed of a porous fractal aggregate (m/s). The effective density of an aggregate of size s made of
   * primary AgCl particles falls as s^(Df-3), so Stokes drag gives v ~ s^(Df-1): bigger floc, faster fall,
   * but far slower than a compact grain. Aggregates grow with the time they have been shearing together
   * (cluster-cluster aggregation) and are capped by breakage where the local shear is strong.
   */
  private aggregateSpeed(i: number): number {
    const m = this.mask, mass = this.dense[i];
    const age = Math.max(0, this.age - this.denseCoordinates[4][i] / Math.max(mass, 1e-20));
    const flow = this.flow, shear = Math.hypot(flow[i * 3], flow[i * 3 + 1], flow[i * 3 + 2]);
    const grown = 1 + age / AGG_GROWTH_TIME;
    const broken = 1 / (1 + shear / AGG_BREAK_SHEAR);
    const size = Math.max(0.05, this.clumpMass(i) * m.activeCount) * grown * broken;
    // A thin raft lies in the surface layers (surface tension holds the first cotton there) until it is displaced.
    const column = Math.floor(i / (m.nx * m.ny)) * m.nx + i % m.nx;
    const rowsBelowTop = this.topCell[column] >= 0 ? (this.topCell[column] - i) / m.nx : 99;
    const raft = rowsBelowTop < RAFT_ROWS ? RAFT_HOLD : 1;
    return raft * Math.min(AGG_MAX_SPEED, AGG_V0 * Math.pow(size, FRACTAL_DIMENSION - 1));
  }

  /** Mean cotton mass of the cell and its six neighbours (centre weighted), the size of the clump it belongs to. */
  private clumpMass(i: number): number {
    const m = this.mask, rows = m.nx, planes = m.nx * m.ny;
    const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / planes);
    let sum = this.dense[i] * 2, weight = 2;
    if (x > 0 && m.data[i - 1]) { sum += this.dense[i - 1]; weight++; }
    if (x + 1 < m.nx && m.data[i + 1]) { sum += this.dense[i + 1]; weight++; }
    if (y > 0 && m.data[i - rows]) { sum += this.dense[i - rows]; weight++; }
    if (y + 1 < m.ny && m.data[i + rows]) { sum += this.dense[i + rows]; weight++; }
    if (z > 0 && m.data[i - planes]) { sum += this.dense[i - planes]; weight++; }
    if (z + 1 < m.nz && m.data[i + planes]) { sum += this.dense[i + planes]; weight++; }
    return sum / weight;
  }

  /** Density-dependent hindered settling between wet cells; each transfer is conservative. */
  private settleDense(dt: number) {
    const m = this.mask;
    const up = this.velocity.gravityUp;
    const axis = Math.abs(up.y) >= Math.abs(up.x) && Math.abs(up.y) >= Math.abs(up.z) ? 1
      : Math.abs(up.x) >= Math.abs(up.z) ? 0 : 2;
    const sign = up.getComponent(axis) >= 0 ? -1 : 1;
    const stride = axis === 0 ? 1 : axis === 1 ? m.nx : m.nx * m.ny;
    const limit = axis === 0 ? m.nx : axis === 1 ? m.ny : m.nz;
    const spacing = axis === 1 ? m.height / m.ny : 2 * m.radius / limit;
    // Hindered settling remains a conservative wet-cell flux. A new tuft needs
    // several seconds to cross the liquid, while compact material can pile up.
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const cell = axis === 0 ? i % m.nx : axis === 1
        ? Math.floor(i / m.nx) % m.ny : Math.floor(i / (m.nx * m.ny));
      if (cell + sign < 0 || cell + sign >= limit) continue;
      const j = i + sign * stride;
      if (!m.data[j] || this.dense[i] <= 0) continue;
      // A clump sinks as a whole: its speed follows the mass of the neighbourhood, not of the single cell.
      const speed = this.aggregateSpeed(i);
      const fraction = Math.min(0.45, speed * dt / spacing);
      const moved = this.dense[i] * fraction;
      this.dense[i] -= moved; this.dense[j] += moved;
      for (let component = 0; component < this.denseCoordinates.length; component++) {
        const values = this.denseCoordinates[component];
        const part = values[i] * fraction;
        values[i] -= part; values[j] += part;
      }
    }
    // Porous curd rises against the carrier flow while its trapped air wets out.
    // Traverse from the top down so a parcel cannot cross several rows in one step.
    for (let a = m.activeCount - 1; a >= 0; a--) {
      const i = m.active[a];
      const cell = axis === 0 ? i % m.nx : axis === 1
        ? Math.floor(i / m.nx) % m.ny : Math.floor(i / (m.nx * m.ny));
      if (cell - sign < 0 || cell - sign >= limit || this.dense[i] <= 0) continue;
      const j = i - sign * stride;
      if (!m.data[j]) continue;
      const lift = Math.min(1, this.denseCoordinates[3][i] / this.dense[i]);
      if (lift < 0.25) continue;
      const fraction = Math.min(0.35, 0.02 * lift * lift * dt / spacing);
      const moved = this.dense[i] * fraction;
      this.dense[i] -= moved; this.dense[j] += moved;
      for (const values of this.denseCoordinates) {
        const part = values[i] * fraction;
        values[i] -= part; values[j] += part;
      }
    }
    // Air-rich curd at the meniscus spreads into adjacent wet cells as a
    // shallow raft. Pairwise flux keeps both the curd and trapped air conserved.
    if (axis === 1) for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], y = Math.floor(i / m.nx) % m.ny;
      if (y + 1 < m.ny && m.data[i + m.nx]) continue;
      if (this.dense[i] <= 0 || this.denseCoordinates[3][i] < this.dense[i] * 0.25) continue;
      const x = i % m.nx, z = Math.floor(i / (m.nx * m.ny));
      for (const [j, valid] of [[i + 1, x + 1 < m.nx], [i - 1, x > 0],
        [i + m.nx * m.ny, z + 1 < m.nz], [i - m.nx * m.ny, z > 0]] as const) {
        if (!valid || !m.data[j] || (y + 1 < m.ny && m.data[j + m.nx])) continue;
        const delta = this.dense[i] - this.dense[j];
        if (delta <= 0) continue;
        const amount = Math.min(this.dense[i], delta * 0.08);
        const fraction = amount / this.dense[i];
        this.dense[i] -= amount; this.dense[j] += amount;
        for (const values of this.denseCoordinates) {
          const part = values[i] * fraction;
          values[i] -= part; values[j] += part;
        }
      }
    }
  }

  /** Local coagulation sharpens a continuous concentration field without changing its mass. */
  private compactDense() {
    const m = this.mask;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      for (let axis = 0; axis < 3; axis++) {
        if ((axis === 0 ? x : axis === 1 ? y : z) >=
          (axis === 0 ? m.nx : axis === 1 ? m.ny : m.nz) - 1) continue;
        const j = i + (axis === 0 ? 1 : axis === 1 ? m.nx : m.nx * m.ny);
        if (!m.data[j]) continue;
        const from = this.dense[i] < this.dense[j] ? i : j;
        const to = from === i ? j : i;
        const low = this.dense[from], high = this.dense[to];
        if (low <= 0 || high < low * 1.08) continue;
        // Amplify flow-created concentration peaks in all three directions.
        // This conservative phase separation leaves clear channels between curds.
        const fraction = 0.20 * Math.min(1, high / low - 1.08);
        const amount = low * fraction;
        for (const coordinate of this.denseCoordinates) {
          const portion = coordinate[from] * fraction;
          coordinate[from] -= portion; coordinate[to] += portion;
        }
        this.dense[from] -= amount; this.dense[to] += amount;
      }
    }
  }

  /** Wet curd has a maximum packing density; the excess slides sideways and upward into a heap. */
  private packDense() {
    const m = this.mask, up = this.velocity.gravityUp;
    const baseCap = this.packingLimit / m.activeCount;
    // A settled heap is domed: it holds less at the glass than in the middle.
    const capAt = (i: number) => {
      const x = i % m.nx, z = Math.floor(i / (m.nx * m.ny));
      const radial = Math.hypot((x + 0.5) / m.nx - 0.5, (z + 0.5) / m.nz - 0.5) * 2;
      return baseCap * (1 - HEAP_EDGE * THREE.MathUtils.smoothstep(radial, 0.3, 1));
    };
    const strides = [1, m.nx, m.nx * m.ny], limits = [m.nx, m.ny, m.nz];
    for (let pass = 0; pass < 8; pass++) {
      // Alternate the sweep direction so the relaxation does not drift the heap to one side.
      const backwards = (pass + Math.floor(this.age * 20)) % 2 === 1;
      for (let n = 0; n < m.activeCount; n++) {
        const i = m.active[backwards ? m.activeCount - 1 - n : n];
        const cap = capAt(i);
        const excess = this.dense[i] - cap;
        if (excess <= 0) continue;
        const coords = [i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny))];
        let total = 0, count = 0;
        for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
          if (coords[axis] + sign < 0 || coords[axis] + sign >= limits[axis]) continue;
          const j = i + sign * strides[axis];
          if (!m.data[j]) continue;
          const lift = sign * up.getComponent(axis);
          const room = Math.max(0, capAt(j) - this.dense[j]) + (lift > 0.5 ? cap * 0.05 : 0);
          this.packWeights[count] = room * (lift > 0.5 ? 0.12 : 1);
          this.packTargets[count++] = j;
          total += this.packWeights[count - 1];
        }
        if (total <= 0) continue;
        const moving = excess * 0.6;
        for (let k = 0; k < count; k++) {
          const j = this.packTargets[k], amount = moving * this.packWeights[k] / total;
          if (amount <= 0) continue;
          const fraction = amount / this.dense[i];
          for (const coordinate of this.denseCoordinates) {
            const portion = coordinate[i] * fraction;
            coordinate[i] -= portion; coordinate[j] += portion;
          }
          this.dense[i] -= amount; this.dense[j] += amount;
        }
      }
    }
  }

  /** Fractional height-field relaxation of the contiguous bottom pile. */
  private repose() {
    const m = this.mask, rows = m.nx, columns = m.nx * m.nz;
    if (this.heapHeight.length !== columns) {
      this.heapHeight = new Float64Array(columns); this.heapFree = new Int32Array(columns);
    }
    const cap = this.packingLimit / m.activeCount;
    // A cell is much taller than it is wide. An 18 degree local relaxation
    // target leaves room for continuing deposition while keeping the measured
    // surface below the 35 degree repose bound.
    const limit = Math.tan(18 * Math.PI / 180) * (2 * m.radius / m.nx)
      / (m.height / m.ny);
    for (let pass = 0; pass < 40; pass++) {
      for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
        const c = z * m.nx + x;
        let height = 0, free = -1;
        for (let y = 0; y < m.ny; y++) {
          const i = x + y * rows + z * rows * m.ny;
          if (!m.data[i]) continue;
          const fill = Math.min(1, this.dense[i] / cap);
          if (fill < 0.01) { free = i; break; }
          height += fill;
          if (fill < 0.999) { free = i; break; }
        }
        this.heapFree[c] = free;
        this.heapHeight[c] = height;
      }
      const flip = (pass + Math.floor(this.age * 20)) % 2 === 1;
      for (let z = 0; z < m.nz; z++) for (let xn = 0; xn < m.nx; xn++) {
        const x = flip ? m.nx - 1 - xn : xn;
        const c = z * m.nx + x;
        if (this.heapHeight[c] <= 0) continue;
        const source = this.heapFree[c] >= 0 && this.dense[this.heapFree[c]] > 0.01 * cap
          ? this.heapFree[c] : this.heapFree[c] - rows;
        if (source < 0 || !m.data[source] || this.dense[source] <= 0) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= m.nx || nz >= m.nz) continue;
          const n = nz * m.nx + nx, target = this.heapFree[n];
          if (target < 0 || !m.data[target]) continue;
          const drop = this.heapHeight[c] - this.heapHeight[n] - limit;
          if (drop <= 0) continue;
          const amount = Math.min(this.dense[source], Math.max(0, cap - this.dense[target]),
            0.5 * drop * cap);
          if (amount <= 0) continue;
          const fraction = amount / this.dense[source];
          for (const component of this.denseCoordinates) {
            const portion = component[source] * fraction;
            component[source] -= portion; component[target] += portion;
          }
          this.dense[source] -= amount; this.dense[target] += amount;
          this.heapHeight[c] -= amount / cap;
          this.heapHeight[n] += amount / cap;
        }
      }
    }
  }

  /** 0 for fresh fluffy cotton, 1 for cotton that has had time to set into heavy curd. */
  private hardening(i: number): number {
    const mass = this.dense[i];
    if (mass <= 1e-20) return 0;
    return THREE.MathUtils.smoothstep(this.age - this.denseCoordinates[4][i] / mass, HARDEN_FROM, HARDEN_TO);
  }

  /** Young, fluffy cotton is dispersed sideways by the turbulence of the stream; set cotton is not. Conservative. */
  private spreadYoung() {
    const m = this.mask, strides = [1, m.nx * m.ny, m.nx];
    for (let pass = 0; pass < YOUNG_PASSES; pass++) for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      if (this.dense[i] <= 1e-20) continue;
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      for (let axis = 0; axis < 3; axis++) {
        const coordinate = axis === 0 ? x : axis === 1 ? z : y;
        if (coordinate + 1 >= (axis === 0 ? m.nx : axis === 1 ? m.nz : m.ny)) continue;
        const j = i + strides[axis];
        if (!m.data[j]) continue;
        const gap = this.dense[i] - this.dense[j];
        if (Math.abs(gap) < 1e-14) continue;
        const donor = gap > 0 ? i : j, taker = gap > 0 ? j : i;
        const fresh = 1 - this.hardening(donor);
        const fraction = YOUNG_SPREAD * (axis === 2 ? 0.5 : 1) * fresh * Math.abs(gap) / Math.max(this.dense[donor], 1e-20);
        if (fraction <= 0) continue;
        for (const component of this.denseCoordinates) {
          const portion = component[donor] * fraction;
          component[donor] -= portion; component[taker] += portion;
        }
        const moved = this.dense[donor] * fraction;
        this.dense[donor] -= moved; this.dense[taker] += moved;
      }
    }
  }

  /** Primary particles flocculate where the fine solid is concentrated (rate ~ concentration), then the flocs move. */
  private advanceFlocSystem(dt: number) {
    const m = this.mask, smoothing = this.suspension[0];
    if (!this.flocSystem) {
      this.flocSystem = new FlocSystem({ ...DEFAULT_FLOC_CONFIG, radius: m.radius, bottom: m.bottom, height: m.height,
        // Test C runs with fragmentation disabled; test D enables it (window.__silverBreak = 1).
        allowBreakage: (globalThis as { __silverBreak?: unknown }).__silverBreak === 1,
        // Porosity of the flocs sets how fast they settle (v ~ sqrt(solid fraction)); calibrated on the reference.
        solidFraction: FLOC_SOLID_FRACTION() });
      this.flocMass = new Float32Array(m.data.length); this.flocVisual = new Float32Array(m.data.length);
    }
    const point = this.scratch;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], fine = smoothing[i];
      if (fine <= 1e-12) continue;
      // Smoluchowski: collisions of primary particles scale with concentration squared, so dilute regions stay a
      // fine suspension and only concentrated parts (the mixing zone) flocculate.
      // Diagnostic C (window.__silverAgg = 0): aggregation disabled, the fine suspension alone must make the cloud.
      if ((globalThis as { __silverAgg?: unknown }).__silverAgg === 0) continue;
      const concentration = fine * m.activeCount;
      const rate = Math.min(0.6, FLOC_AGGREGATION * concentration * (concentration / (concentration + FLOC_C0)) * dt);
      const moved = fine * rate;
      // Tiny amounts stay in the suspension until more accumulates: one floc update per significant parcel, not per cell.
      if (moved <= FLOC_MIN_PARCEL) continue;
      smoothing[i] -= moved;
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      m.point(x, y, z, point);
      this.flocSystem.addMass(point.x, point.y, point.z, moved);
    }
    this.flocSystem.erode(dt, (x, y, z, mass) => {
      const gx = Math.min(m.nx - 1, Math.max(0, Math.floor((x + m.radius) / (2 * m.radius) * m.nx)));
      const gy = Math.min(m.ny - 1, Math.max(0, Math.floor((y - m.bottom) / m.height * m.ny)));
      const gz = Math.min(m.nz - 1, Math.max(0, Math.floor((z + m.radius) / (2 * m.radius) * m.nz)));
      let cell = m.index(gx, gy, gz);
      if (!m.data[cell]) { let best = -1, d = Infinity; for (let a = 0; a < m.activeCount; a++) { const j = m.active[a]; const dx = j % m.nx - gx, dy = Math.floor(j / m.nx) % m.ny - gy, dz = Math.floor(j / (m.nx * m.ny)) - gz; const q = dx * dx + dy * dy + dz * dz; if (q < d) { d = q; best = j; } } cell = best; }
      if (cell >= 0) this.suspension[0][cell] += mass;
    });
    this.flocSystem.surfaceY = this.liquidLevel;
    this.flocSystem.step(dt, (x, y, z, out) => this.sampleFlow(x, y, z, out), this.velocity.gravityUp.y);
    this.flocSystem.rasterize(this.flocMass, this.flocVisual, m.nx, m.ny, m.nz, m.activeCount);
  }

  /** Trilinear carrier velocity at a point, weighted by wet cells; false when no wet cell is near. */
  private sampleFlow(x: number, y: number, z: number, out: [number, number, number]): boolean {
    const m = this.mask, R = m.radius;
    const gx = (x + R) / (2 * R) * m.nx - 0.5, gy = (y - m.bottom) / m.height * m.ny - 0.5, gz = (z + R) / (2 * R) * m.nz - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    let wx = 0, wy = 0, wz = 0, wsum = 0;
    for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const xi = x0 + dx, yi = y0 + dy, zi = z0 + dz;
      if (xi < 0 || yi < 0 || zi < 0 || xi >= m.nx || yi >= m.ny || zi >= m.nz) continue;
      const i = m.index(xi, yi, zi);
      if (!m.data[i]) continue;
      const w = (dx ? gx - x0 : 1 - (gx - x0)) * (dy ? gy - y0 : 1 - (gy - y0)) * (dz ? gz - z0 : 1 - (gz - z0));
      wx += this.flow[i * 3] * w; wy += this.flow[i * 3 + 1] * w; wz += this.flow[i * 3 + 2] * w; wsum += w;
    }
    if (wsum < 1e-6) { out[0] = out[1] = out[2] = 0; return false; }
    out[0] = wx / wsum; out[1] = wy / wsum; out[2] = wz / wsum;
    return true;
  }

  /** Index of the highest wet cell of every column; -1 where the column holds no liquid. */
  private surfaceTop(): Int32Array {
    const m = this.mask, columns = m.nx * m.nz;
    if (this.topCell.length !== columns) this.topCell = new Int32Array(columns);
    for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
      let top = -1;
      for (let y = m.ny - 1; y >= 0; y--) { const i = x + y * m.nx + z * m.nx * m.ny; if (m.data[i]) { top = i; break; } }
      this.topCell[z * m.nx + x] = top;
    }
    return this.topCell;
  }

  /** The stream hits the surface and the solid spreads along it as a thin film (conservative lateral diffusion). */
  private spreadSurface() {
    const m = this.mask, top = this.surfaceTop(), rows = m.nx;
    const move = (from: number, to: number, fraction: number) => {
      const amount = this.dense[from] * fraction;
      if (amount <= 0) return;
      for (const component of this.denseCoordinates) {
        const portion = component[from] * fraction;
        component[from] -= portion; component[to] += portion;
      }
      this.dense[from] -= amount; this.dense[to] += amount;
    };
    for (let pass = 0; pass < SURFACE_SPREAD_PASSES; pass++)
    for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
      const a = top[z * m.nx + x];
      if (a < 0) continue;
      for (let layer = 0; layer < SURFACE_LAYERS; layer++) {
        const i = a - layer * rows;
        if (i < 0 || !m.data[i]) continue;
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx >= m.nx || nz >= m.nz) continue;
          const b = top[nz * m.nx + nx];
          if (b < 0) continue;
          const j = b - layer * rows;
          if (j < 0 || !m.data[j]) continue;
          const gap = this.dense[i] - this.dense[j];
          if (Math.abs(gap) < 1e-12) continue;
          const donor = gap > 0 ? i : j, taker = gap > 0 ? j : i;
          move(donor, taker, SURFACE_SPREAD * Math.abs(gap) / Math.max(this.dense[donor], 1e-20));
        }
      }
    }
  }

  /** Air-bearing cotton in the top layers stays at the surface: the flow cannot carry it away. */
  private holdFilm() {
    const m = this.mask, top = this.surfaceTop(), rows = m.nx, air = this.denseCoordinates[3];
    if (this.filmMass.length !== m.data.length) {
      this.filmMass = new Float64Array(m.data.length);
      this.filmCoordinates = this.denseCoordinates.map(() => new Float64Array(m.data.length));
    }
    for (let c = 0; c < top.length; c++) {
      const a = top[c];
      if (a < 0) continue;
      for (let layer = 0; layer < SURFACE_LAYERS; layer++) {
        const i = a - layer * rows;
        if (i < 0 || !m.data[i] || this.dense[i] <= 1e-20) continue;
        const lift = Math.min(1, air[i] / this.dense[i]) ** 2;
        const kept = this.dense[i] * lift;
        this.filmMass[i] = kept; this.dense[i] -= kept;
        for (let k = 0; k < this.denseCoordinates.length; k++) {
          const held = this.denseCoordinates[k][i] * lift;
          this.filmCoordinates[k][i] = held; this.denseCoordinates[k][i] -= held;
        }
      }
    }
  }

  private releaseFilm() {
    const m = this.mask;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      if (this.filmMass[i] === 0) continue;
      this.dense[i] += this.filmMass[i]; this.filmMass[i] = 0;
      for (let k = 0; k < this.denseCoordinates.length; k++) {
        this.denseCoordinates[k][i] += this.filmCoordinates[k][i]; this.filmCoordinates[k][i] = 0;
      }
    }
  }

  /** A film thicker than the surface can hold is displaced: pieces are pushed below and wet as they go. */
  private peelStep = 0.05;
  private peelSurface() {
    const m = this.mask, top = this.surfaceTop(), rows = m.nx;
    const air = this.denseCoordinates[3];
    for (let c = 0; c < top.length; c++) {
      const a = top[c];
      if (a < 0) continue;
      // The film holds less near the glass, so displaced cotton runs down along the wall.
      const x = c % m.nx, z = Math.floor(c / m.nx);
      const radial = Math.hypot((x + 0.5) / m.nx - 0.5, (z + 0.5) / m.nz - 0.5) * 2;
      const cap = SURFACE_CAP * (1 - 0.65 * THREE.MathUtils.smoothstep(radial, 0.45, 0.95)) / m.activeCount;
      for (let layer = 0; layer < SURFACE_LAYERS; layer++) {
        const i = a - layer * rows, j = i - rows;
        if (i < 0 || j < 0 || !m.data[i] || !m.data[j]) continue;
        const excess = this.dense[i] - cap;
        // New cotton arriving at the film displaces the old one; the film also slowly wets and drains.
        const amount = Math.max(0, excess) * SURFACE_PEEL + this.dense[i] * SURFACE_LEAK * this.peelStep;
        if (amount <= 0) continue;
        const fraction = amount / this.dense[i];
        for (let k = 0; k < this.denseCoordinates.length; k++) {
          const component = this.denseCoordinates[k];
          const portion = component[i] * fraction * (k === 3 ? SURFACE_AIR_KEPT : 1);
          component[i] -= portion; component[j] += portion;
        }
        this.dense[i] -= amount; this.dense[j] += amount;
        if (air[i] > this.dense[i]) air[i] = this.dense[i];
      }
    }
  }

  /** The dense core of a mass sheds fine solid into the liquid: this is the haze that tints the water. */
  private emitHaze(dt: number) {
    const m = this.mask, air = this.denseCoordinates[3];
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], mass = this.dense[i];
      if (mass <= 1e-20) continue;
      const concentration = mass * m.activeCount;
      const core = THREE.MathUtils.smoothstep(concentration, 0.5, 2.2);
      // The loose, porous parts of the cotton shed the most; the dense core stays clean.
      const dilute = 1 - THREE.MathUtils.smoothstep(concentration, 0.3, 1.6);
      const wet = 1 - Math.min(1, air[i] / mass);
      // The haze of the reference only builds up after the first seconds (minutes of real time later).
      const emitted = mass * Math.min(0.2, dt * this.hazeDelay() * (HAZE_BASE + HAZE_CORE * core + HAZE_DILUTE * dilute) * (0.35 + 0.65 * wet));
      const fraction = emitted / mass;
      for (const component of this.denseCoordinates) component[i] -= component[i] * fraction;
      this.dense[i] -= emitted; this.suspension[0][i] += emitted;
    }
  }

  /** Loose ragged parts tear off the cotton as small chips; the faster the flow, the more of them. */
  private shedChips(dt: number) {
    const m = this.mask, flow = this.flow;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], mass = this.dense[i];
      if (mass <= 1e-20) continue;
      const concentration = mass * m.activeCount;
      const ragged = THREE.MathUtils.smoothstep(concentration, 0.2, 0.6) * (1 - THREE.MathUtils.smoothstep(concentration, 0.9, 2.2));
      if (ragged <= 0) continue;
      const speed = Math.hypot(flow[i * 3], flow[i * 3 + 1], flow[i * 3 + 2]);
      const rate = CHIP_RATE * ragged * (0.3 + Math.min(1, speed / 0.02));
      const moved = mass * Math.min(0.2, dt * rate), fraction = moved / mass;
      for (const component of this.denseCoordinates) component[i] -= component[i] * fraction;
      this.dense[i] -= moved; this.coarse[i] += moved;
    }
  }

  /** Chips sink on their own; the ones that reach the floor or the heap join it. */
  private sinkChips(dt: number) {
    const m = this.mask, rows = m.nx, step = this.velocity.gravityUp.y >= 0 ? -1 : 1;
    const fraction = Math.min(0.45, CHIP_SINK * dt / (m.height / m.ny));
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], amount = this.coarse[i];
      if (amount <= 1e-20) continue;
      const j = i + step * rows;
      const y = Math.floor(i / m.nx) % m.ny;
      const floor = y + step < 0 || y + step >= m.ny || !m.data[j];
      const moved = amount * (floor ? 1 : fraction);
      this.coarse[i] -= moved;
      if (!floor) { this.coarse[j] += moved; continue; }
      // Landed: the chip becomes part of the heap, wet and no longer buoyant.
      this.dense[i] += moved;
      this.denseCoordinates[0][i] += moved * ((i % m.nx + 0.5) / m.nx);
      this.denseCoordinates[1][i] += moved * ((y + 0.5) / m.ny);
      this.denseCoordinates[2][i] += moved * ((Math.floor(i / (m.nx * m.ny)) + 0.5) / m.nz);
      this.denseCoordinates[4][i] += moved * this.age;
    }
  }

  private hazeDelay(): number { return THREE.MathUtils.smoothstep(this.age, 5, 20); }

  /** Smoke thins out into the water: the tint is accumulated slowly from it, never present at once. */
  private dissolveSmoke(dt: number) {
    const m = this.mask, smoke = this.suspension[0], tint = this.suspension[1];
    const share = 1 - Math.exp(-dt * SMOKE_TO_TINT);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], moved = smoke[i] * share;
      smoke[i] -= moved; tint[i] += moved;
    }
  }

  private advanceFlocs(dt: number, agitation: number) {
    const m = this.mask;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      if (this.coarse[i] < 0.000015) continue;
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      const position = m.point(x, y, z, new THREE.Vector3());
      let nearest: FlocAggregate | undefined;
      let distance = m.radius * 1.7;
      for (const floc of this.flocs) {
        const d = floc.position.distanceTo(position);
        if (d < distance) { nearest = floc; distance = d; }
      }
      const mass = this.coarse[i];
      if (nearest && nearest.mass + mass < 0.12) {
        nearest.position.multiplyScalar(nearest.mass / (nearest.mass + mass))
          .addScaledVector(position, mass / (nearest.mass + mass));
        nearest.mass += mass;
      } else if (this.flocs.length < 72) {
        this.flocs.push({ position, velocity: new THREE.Vector3(), mass,
          porosity: 0.22 + 0.50 * Math.abs(Math.sin(i * 17.17)), shape: i });
      } else continue;
      this.coarse[i] = 0;
    }
    // Compact pieces fall from a porous parent; both retain conserved mass.
    const existing = this.flocs.length;
    for (let n = 0; n < existing && this.flocs.length < 72; n++) {
      const floc = this.flocs[n];
      if (floc.segregated || floc.porosity < 0.45 || floc.mass < 0.004) continue;
      const detached = floc.mass * 0.58;
      floc.mass -= detached;
      floc.segregated = true;
      this.flocs.push({
        position: floc.position.clone().addScaledVector(this.velocity.gravityUp, -m.radius * 0.6),
        velocity: this.velocity.gravityUp.clone().multiplyScalar(-0.05),
        mass: detached, porosity: 0.26, shape: floc.shape + 307, segregated: true,
      });
    }
    for (let n = this.flocs.length - 1; n >= 0; n--) {
      const floc = this.flocs[n];
      const ix = THREE.MathUtils.clamp(Math.floor((floc.position.x / m.radius + 1) * m.nx / 2), 0, m.nx - 1);
      const iy = THREE.MathUtils.clamp(Math.floor((floc.position.y - m.bottom) / m.height * m.ny), 0, m.ny - 1);
      const iz = THREE.MathUtils.clamp(Math.floor((floc.position.z / m.radius + 1) * m.nz / 2), 0, m.nz - 1);
      const i = m.index(ix, iy, iz);
      const flow = new THREE.Vector3(this.flow[i * 3], this.flow[i * 3 + 1], this.flow[i * 3 + 2]);
      const settling = TUBE_SIMULATION.silver.coarseSettlingSpeed * this.settlingBoost
        * Math.sqrt(Math.max(0.16, floc.mass * 28)) * (1 - floc.porosity) ** 2
        * (0.2 + 9 * (1 - THREE.MathUtils.smoothstep(floc.porosity, 0.35, 0.65)));
      const shear = Math.max(0, flow.distanceTo(floc.velocity) - 0.0015);
      floc.velocity.lerp(flow.multiplyScalar(0.35).addScaledVector(this.velocity.gravityUp, -settling),
        1 - Math.exp(-dt * 2));
      floc.position.addScaledVector(floc.velocity, dt);
      const radial = Math.hypot(floc.position.x, floc.position.z);
      if (radial > m.radius * 0.84) {
        floc.position.x *= m.radius * 0.84 / radial;
        floc.position.z *= m.radius * 0.84 / radial;
      }
      const bowl = m.bottom + m.radius - Math.sqrt(Math.max(0, m.radius * m.radius - radial * radial));
      // Shear strips material from porous clumps into a daughter and a fine
      // concentration field. With little flow the connected core persists.
      if (shear > 0 && floc.mass > 0.002) {
        const detached = Math.min(floc.mass * 0.07,
          floc.mass * shear * dt * 9);
        floc.mass -= detached;
        this.suspension[0][i] += detached * 0.55;
        if (this.flocs.length < 72 && detached > 0.00004) {
          const direction = new THREE.Vector3(
            Math.sin(floc.shape * 2.17), -0.35, Math.cos(floc.shape * 2.17)).normalize();
          const child = floc.position.clone().addScaledVector(direction, m.radius * 0.35);
          this.flocs.push({ position: child, velocity: floc.velocity.clone(),
            mass: detached * 0.45, porosity: Math.min(0.88, floc.porosity + 0.07),
            shape: floc.shape + 97 + this.flocs.length, segregated: true });
        } else this.suspension[0][i] += detached * 0.45;
      }
      // Unequal velocities across a porous curd strip its surface into fine
      // suspended AgCl, even after the stronger jet shear has subsided.
      if (floc.mass > 0.001) {
        const released = floc.mass * Math.min(0.035,
          dt * (0.024 + 1.8 * shear) * floc.porosity);
        floc.mass -= released;
        this.suspension[0][i] += released;
      }
      if (agitation > 0.08 && floc.mass > 0.0001) {
        const released = floc.mass * Math.min(0.25, agitation * dt * 1.6);
        floc.mass -= released;
        this.suspension[0][i] += released;
        floc.velocity.addScaledVector(this.velocity.gravityUp, agitation * dt * 0.006);
      }
      const contact = m.radius * Math.min(0.5,
        0.14 + 0.45 * Math.cbrt(floc.mass / 0.12));
      if (floc.position.y <= bowl + contact && agitation < 0.08) {
        this.sedimentField.deposit(iz * m.nx + ix, floc.mass);
        this.flocs.splice(n, 1);
      } else floc.position.y = Math.max(bowl + m.radius * 0.03, floc.position.y);
    }
    // Nearby porous bodies coalesce into a connected cotton mass. The merge
    // preserves product mass and momentum; its apparent volume follows mass.
    for (let a = this.flocs.length - 1; a >= 0; a--) {
      const first = this.flocs[a];
      const reachA = m.radius * (0.12 + 0.48 * Math.cbrt(first.mass / 0.12));
      for (let b = 0; b < a; b++) {
        const second = this.flocs[b];
        const reachB = m.radius * (0.12 + 0.48 * Math.cbrt(second.mass / 0.12));
        if (first.position.distanceToSquared(second.position) > (reachA + reachB) ** 2 * 0.32
          || first.velocity.distanceToSquared(second.velocity) > 0.02 ** 2) continue;
        const total = first.mass + second.mass;
        if (total > 0.12) continue;
        second.position.multiplyScalar(second.mass / total)
          .addScaledVector(first.position, first.mass / total);
        second.velocity.multiplyScalar(second.mass / total)
          .addScaledVector(first.velocity, first.mass / total);
        second.porosity = (second.porosity * second.mass + first.porosity * first.mass) / total;
        second.segregated = second.segregated || first.segregated;
        second.mass = total;
        this.flocs.splice(a, 1);
        break;
      }
    }
  }

  private inject(inlet: THREE.Vector3, amount: number, jetStrength: number) {
    if (!amount) return;
    const m = this.mask;
    const weights = this.next;
    let sum = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      const p = m.point(x, y, z, this.scratch);
      const depth = Math.max(0, inlet.y - p.y);
      const dx = p.x - inlet.x;
      const dz = p.z - inlet.z;
      const wall = THREE.MathUtils.smoothstep(Math.hypot(inlet.x, inlet.z) / m.radius, 0.38, 0.80);
      const width = m.radius * ((this.stageOne ? 0.30 : 0.20) + 0.06 * Math.min(3, jetStrength)) * (1 - 0.38 * wall);
      // Stage 1: the solution is poured ONTO the liquid, so it first lies as a thin layer at the surface and
      // is mixed downward by the stream momentum and by its own weight, not injected into the bulk.
      const vertical = m.radius * (this.stageOne ? 0.14 : 0.36 + 0.12 * Math.min(3, jetStrength));
      weights[i] = p.y <= inlet.y && depth < vertical * 2
        ? Math.exp(-(dx * dx + dz * dz) / (width * width) - depth * depth / (vertical * vertical)) : 0;
      sum += weights[i];
    }
    if (sum < 1e-20) return;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], added = amount * weights[i] / sum;
      this.species["Cl-"].values[i] += added;
      this.tracer[i] += added;
    }
    this.delivered += amount;
  }

  private settle(values: Float64Array, dt: number, settling: number) {
    settleParticleClass(this.mask, values, this.next, this.velocity.gravityUp, dt, settling,
      (column, mass) => this.sedimentField.deposit(column, mass));
  }

  dispose() { this.chipTexture.dispose(); this.tintTexture.dispose(); this.texture.dispose(); this.denseTexture.dispose(); this.overlapTexture.dispose(); }
}
