import * as THREE from "three";
import { LiquidMask, SpeciesField, VelocityField } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { SilverSedimentField } from "./tubeSilverSediment";
import { TubeFlowSolver } from "./tubeFlowSolver";
import { precipitatePair, settleParticleClass } from "./tubePrecipitationPhysics";

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
  readonly sedimentField: SilverSedimentField;
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
    readonly silverAmount = 1.15) {
    const size = quality === "LOW" ? TUBE_SIMULATION.jetFlow.LOW : TUBE_SIMULATION.jetFlow.HIGH;
    this.mask = new LiquidMask(size.width, size.height, size.depth, radius, bottom, height);
    this.velocity = new VelocityField(this.mask);
    this.solver = new TubeFlowSolver(this.mask);
    this.species = { "Ag+": new SpeciesField("Ag+", this.mask),
      "Cl-": new SpeciesField("Cl-", this.mask) };
    this.suspension = [0, 1, 2].map(() => new Float64Array(this.mask.data.length));
    this.coarse = new Float64Array(this.mask.data.length);
    this.tracer = new Float64Array(this.mask.data.length);
    this.productSource = new Float64Array(this.mask.data.length);
    this.sedimentField = new SilverSedimentField(this.mask.nx, this.mask.nz);
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
  get totalSolidMass() { return this.suspensionMass + this.coarseMass + this.sedimentMass; }
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
    return { suspended: this.suspensionMass, coarse: this.coarseMass,
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
          this.species["Ag+"].values[m.active[a]] = this.silverAmount / m.activeCount;
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
      const ionMixing = 0.00012 + agitation * 0.000003;
      for (const field of Object.values(this.species)) this.solver.transport(field.values, step, ionMixing);
      this.solver.transport(this.tracer, step, ionMixing);
      const calm = this.delivered >= 0.999 && agitation < 0.02
        && kinetic / Math.max(1, m.activeCount) < 0.00004;
      const targetBoost = calm ? TUBE_SIMULATION.silver.settlingAcceleration : 1;
      this.settlingBoost += (targetBoost - this.settlingBoost) * (1 - Math.exp(-step / 0.8));
      this.sedimentField.settle(step);
      for (let k = 0; k < 3; k++) {
        this.solver.transport(this.suspension[k], step, 0.000018);
        this.settle(this.suspension[k], step,
          TUBE_SIMULATION.silver.settlingSpeeds[k] * this.settlingBoost);
      }
      this.solver.transport(this.coarse, step, 0.000003);
      const ba = this.species["Ag+"].values, so = this.species["Cl-"].values;
      this.productSource.fill(0);
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        const formed = precipitatePair(ba[i], so[i], m.activeCount, 0.0005, step,
          this.suspension[0][i] + this.suspension[1][i] + this.suspension[2][i]);
        ba[i] -= formed; so[i] -= formed; this.extent += formed;
        this.productSource[i] = formed;
        // Dense, freshly nucleated parcels flocculate locally. All visible
        // lobes draw from this solid reservoir; dilute parcels remain fine.
        const flocculation = THREE.MathUtils.smoothstep(
          (formed + this.suspension[0][i]) * m.activeCount, 0.001, 0.035);
        const aggregate = formed * TUBE_SIMULATION.silver.flocMassFraction * flocculation;
        this.coarse[i] += aggregate;
        const fine = formed - aggregate;
        for (let k = 0; k < 3; k++) this.suspension[k][i] += fine * [0.58, 0.28, 0.14][k];
      }
      this.advanceFlocs(step, agitation);
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
      const opticalMix = THREE.MathUtils.clamp((suspensionMass - 0.12) * 4, 0, 0.55);
      for (let i = 0; i < this.pixels.length; i++) {
        const local = (this.suspension[0][i] + this.suspension[1][i]
          + this.suspension[2][i]) * m.activeCount;
        // Coarse-grain the conserved fine phase as mixing spreads through the
        // liquid. The spatial mean remains the same, so no optical mass appears.
        this.pixels[i] = m.data[i] ? ((1 - opticalMix) * local
          + opticalMix * suspensionMass)
          * TUBE_SIMULATION.silver.suspensionOpticalScale : 0;
      }
      this.texture.needsUpdate = true;
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
    for (let n = this.flocs.length - 1; n >= 0; n--) {
      const floc = this.flocs[n];
      const ix = THREE.MathUtils.clamp(Math.floor((floc.position.x / m.radius + 1) * m.nx / 2), 0, m.nx - 1);
      const iy = THREE.MathUtils.clamp(Math.floor((floc.position.y - m.bottom) / m.height * m.ny), 0, m.ny - 1);
      const iz = THREE.MathUtils.clamp(Math.floor((floc.position.z / m.radius + 1) * m.nz / 2), 0, m.nz - 1);
      const i = m.index(ix, iy, iz);
      const flow = new THREE.Vector3(this.flow[i * 3], this.flow[i * 3 + 1], this.flow[i * 3 + 2]);
      const settling = TUBE_SIMULATION.silver.coarseSettlingSpeed * this.settlingBoost
        * Math.sqrt(Math.max(0.16, floc.mass * 28)) * (0.3 + 0.7 * (1 - floc.porosity))
        * (1 + 3 * (1 - THREE.MathUtils.smoothstep(floc.porosity, 0.3, 0.65)));
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
            shape: floc.shape + 97 + this.flocs.length });
        } else this.suspension[0][i] += detached * 0.45;
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
      const width = m.radius * (0.20 + 0.06 * Math.min(3, jetStrength)) * (1 - 0.38 * wall);
      const vertical = m.radius * (0.36 + 0.12 * Math.min(3, jetStrength));
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

  dispose() { this.texture.dispose(); }
}
