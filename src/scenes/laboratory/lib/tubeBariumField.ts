import * as THREE from "three";
import { LiquidMask, SpeciesField, VelocityField } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { BariumSedimentField } from "./tubeBariumSediment";
import { TubeFlowSolver } from "./tubeFlowSolver";

/** R3 bookkeeping in normalized amounts. */
export function reactR3(barium: number, sulfate: number, fraction = 1) {
  const extent = Math.min(Math.max(0, barium), Math.max(0, sulfate))
    * THREE.MathUtils.clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  return { barium: barium - extent, sulfate: sulfate - extent, precipitate: extent };
}

/** Fine suspension, rare coarse aggregates, and a conserved bottom reservoir. */
export class TubeBariumField {
  readonly mask: LiquidMask;
  readonly velocity: VelocityField;
  readonly solver: TubeFlowSolver;
  readonly species: Record<string, SpeciesField>;
  readonly suspension: Float64Array[];
  readonly coarse: Float64Array;
  readonly tracer: Float64Array;
  readonly sedimentField: BariumSedimentField;
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

  constructor(quality: "LOW" | "MEDIUM" | "HIGH", radius: number, bottom: number, height: number,
    readonly bariumAmount = 1.1) {
    const size = quality === "LOW" ? TUBE_SIMULATION.jetFlow.LOW : TUBE_SIMULATION.jetFlow.HIGH;
    this.mask = new LiquidMask(size.width, size.height, size.depth, radius, bottom, height);
    this.velocity = new VelocityField(this.mask);
    this.solver = new TubeFlowSolver(this.mask);
    this.species = { "Ba2+": new SpeciesField("Ba2+", this.mask),
      "SO4(2-)": new SpeciesField("SO4(2-)", this.mask) };
    this.suspension = [0, 1, 2].map(() => new Float64Array(this.mask.data.length));
    this.coarse = new Float64Array(this.mask.data.length);
    this.tracer = new Float64Array(this.mask.data.length);
    this.sedimentField = new BariumSedimentField(this.mask.nx, this.mask.nz);
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
  get coarseMass() { return this.coarse.reduce((sum, amount) => sum + amount, 0); }

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
    return { suspended: this.suspensionMass, coarse: this.coarseMass,
      settled: this.sedimentMass, formed: this.extent,
      upperTurbidity: upper / Math.max(1, upperCount),
      lowerTurbidity: lower / Math.max(1, lowerCount),
      meanSpeed: speed / Math.max(1, m.activeCount),
      flow: this.solver.diagnostics(), tracer: this.solver.scalarDiagnostics(this.tracer),
      sulfate: this.solver.scalarDiagnostics(this.species["SO4(2-)"].values) };
  }

  advance(dt: number, up: THREE.Vector3, level: number, inlet: THREE.Vector3,
    delivery: number, agitation = 0, jetStrength = 1, jetDirection?: THREE.Vector3) {
    const m = this.mask;
    this.velocity.gravityUp.copy(up);
    this.accumulator = Math.min(0.5, this.accumulator + Math.max(0, dt));
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
        for (const values of [...Object.values(this.species).map(s => s.values), ...this.suspension, this.coarse, this.tracer]) {
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
          this.species["Ba2+"].values[m.active[a]] = this.bariumAmount / m.activeCount;
        this.initialized = true;
      }
      const amount = Math.max(0, Math.min(1, delivery) - this.delivered);
      this.inject(inlet, amount, jetStrength);
      const wall = THREE.MathUtils.smoothstep(Math.hypot(inlet.x, inlet.z) / m.radius, 0.38, 0.80);
      this.wallJet.copy(jetDirection ?? up);
      if (!jetDirection) this.wallJet.negate();
      this.wallJet.x += inlet.x / m.radius * wall * 0.55;
      this.wallJet.z += inlet.z / m.radius * wall * 0.55;
      this.solver.step(step, inlet, this.wallJet,
        amount > 0 ? 0.2 * Math.min(3, Math.max(0.4, jetStrength)) : 0,
        agitation, agitation > 0.01 ? (x, y, z) => this.velocity.at(x, y, z, this.age) : undefined);
      const kinetic = this.solver.diagnostics().energy;
      const ionMixing = 0.000035 + agitation * 0.000001;
      for (const field of Object.values(this.species)) this.solver.transport(field.values, step, ionMixing);
      this.solver.transport(this.tracer, step, ionMixing);
      const calm = this.delivered >= 0.999 && agitation < 0.02
        && kinetic / Math.max(1, m.activeCount) < 0.00004;
      const targetBoost = calm ? TUBE_SIMULATION.barium.settlingAcceleration : 1;
      this.settlingBoost += (targetBoost - this.settlingBoost) * (1 - Math.exp(-step / 0.8));
      if (calm) this.sedimentField.settle(step);
      for (let k = 0; k < 3; k++) {
        this.solver.transport(this.suspension[k], step, 0.000006);
        this.settle(this.suspension[k], step,
          TUBE_SIMULATION.barium.settlingSpeeds[k] * this.settlingBoost);
      }
      this.solver.transport(this.coarse, step, 0.000003);
      this.settle(this.coarse, step, TUBE_SIMULATION.barium.coarseSettlingSpeed * this.settlingBoost);
      const ba = this.species["Ba2+"].values, so = this.species["SO4(2-)"].values;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        const r = reactR3(ba[i], so[i], 1 - Math.exp(-24 * step));
        ba[i] = r.barium; so[i] = r.sulfate; this.extent += r.precipitate;
        for (let k = 0; k < 3; k++) this.suspension[k][i] += r.precipitate * [0.78, 0.18, 0.04][k];
        // A sparse fraction of fine particles coalesces only in dense local clouds.
        if (this.suspension[0][i] * m.activeCount > 0.02) {
          const aggregate = Math.min(this.suspension[0][i],
            r.precipitate * TUBE_SIMULATION.barium.coarseMassFraction);
          this.suspension[0][i] -= aggregate;
          this.coarse[i] += aggregate;
        }
      }
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
      for (let i = 0; i < this.pixels.length; i++)
        this.pixels[i] = m.data[i] ? (this.suspension[0][i] + this.suspension[1][i]
          + this.suspension[2][i]) * m.activeCount * TUBE_SIMULATION.barium.suspensionOpticalScale : 0;
      this.texture.needsUpdate = true;
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
      const width = m.radius * (0.20 + 0.06 * Math.min(3, jetStrength)) * (1 - 0.38 * wall);
      const vertical = m.radius * (0.36 + 0.12 * Math.min(3, jetStrength));
      weights[i] = p.y <= inlet.y && depth < vertical * 2
        ? Math.exp(-(dx * dx + dz * dz) / (width * width) - depth * depth / (vertical * vertical)) : 0;
      sum += weights[i];
    }
    if (sum < 1e-20) return;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], added = amount * weights[i] / sum;
      this.species["SO4(2-)"].values[i] += added;
      this.tracer[i] += added;
    }
    this.delivered += amount;
  }

  private settle(values: Float64Array, dt: number, settling: number) {
    const m = this.mask, next = this.next;
    next.set(values);
    const stride = [1, m.nx, m.nx * m.ny];
    const spacing = [2 * m.radius / m.nx, m.height / m.ny, 2 * m.radius / m.nz];
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      for (let axis = 0; axis < 3; axis++) {
        if (axis === 0 && x + 1 === m.nx || axis === 1 && y + 1 === m.ny || axis === 2 && z + 1 === m.nz) continue;
        const j = i + stride[axis];
        if (!m.data[j]) continue;
        const speed = -settling * this.velocity.gravityUp.getComponent(axis);
        const fraction = Math.min(0.72, Math.abs(speed) * dt / spacing[axis]);
        const advect = speed > 0 ? values[i] * fraction : -values[j] * fraction;
        const flux = Math.max(-next[j], Math.min(next[i], advect));
        next[i] -= flux; next[j] += flux;
      }
      if (settling && y > 0 && !m.data[i - m.nx]) {
        const deposited = Math.min(next[i], values[i] * Math.min(0.1, settling * dt / spacing[1]));
        next[i] -= deposited; this.sedimentField.deposit(z * m.nx + x, deposited);
      }
    }
    values.set(next);
  }

  dispose() { this.texture.dispose(); }
}
