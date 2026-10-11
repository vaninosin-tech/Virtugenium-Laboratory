import * as THREE from "three";
import { LiquidMask, SpeciesField, VelocityField } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { TubeFlowSolver } from "./tubeFlowSolver";

const finitePositive = (v: number) => Number.isFinite(v) ? Math.max(0, v) : 0;

/** R4 in normalized tube units. A voxel contains amounts, not optical intensity. */
export function reactR4(manganate: number, sulfite: number, acid: number, fraction = 1) {
  const extent = Math.min(finitePositive(manganate) / 2, finitePositive(sulfite) / 5,
    finitePositive(acid) / 6) * Math.max(0, Math.min(1, fraction));
  return { extent, manganate: finitePositive(manganate) - 2 * extent,
    sulfite: finitePositive(sulfite) - 5 * extent, acid: finitePositive(acid) - 6 * extent,
    sulfate: 5 * extent, manganeseII: 2 * extent };
}

/** Three advected dissolved reagents and two local products in the shared tube geometry. */
export class TubePermanganateField {
  readonly mask: LiquidMask;
  readonly velocity: VelocityField;
  readonly solver: TubeFlowSolver;
  readonly species: Record<string, SpeciesField>;
  readonly tracer: Float64Array;
  readonly texture: THREE.Data3DTexture;
  readonly pixels: Float32Array;
  extent = 0;
  delivered = 0;
  private age = 0;
  private accumulator = 0;
  private initialized = false;
  private readonly scratch = new THREE.Vector3();
  private readonly next: Float64Array;
  private readonly inlet = new THREE.Vector3();
  private jetStrength = 1;
  private readonly priorUp = new THREE.Vector3(Infinity, Infinity, Infinity);
  private priorLevel = Infinity;

  constructor(quality: "LOW" | "MEDIUM" | "HIGH", radius: number, bottom: number, height: number,
    readonly sulfiteAmount = 6, readonly acidAmount = 7.2, readonly relativeDensity = 1) {
    const size = quality === "LOW" ? TUBE_SIMULATION.jetFlow.LOW : TUBE_SIMULATION.jetFlow.HIGH;
    this.mask = new LiquidMask(size.width, size.height, size.depth, radius, bottom, height);
    this.velocity = new VelocityField(this.mask);
    this.solver = new TubeFlowSolver(this.mask);
    this.species = Object.fromEntries(["MnO4-", "SO3(2-)", "H+", "SO4(2-)", "Mn2+"]
      .map(id => [id, new SpeciesField(id, this.mask)]));
    this.tracer = new Float64Array(this.mask.data.length);
    this.next = new Float64Array(this.mask.data.length);
    this.pixels = new Float32Array(this.mask.data.length);
    this.texture = new THREE.Data3DTexture(this.pixels, this.mask.nx, this.mask.ny, this.mask.nz);
    this.texture.format = THREE.RedFormat; this.texture.type = THREE.FloatType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1; this.texture.needsUpdate = true;
  }

  get progress() { return Math.min(1, this.extent / Math.min(1, this.sulfiteAmount / 5, this.acidAmount / 6)); }

  advance(dt: number, up: THREE.Vector3, level: number, inlet: THREE.Vector3,
    delivered: number, jetStrength = 1, jetDirection?: THREE.Vector3) {
    const m = this.mask;
    this.inlet.copy(inlet);
    this.jetStrength = Math.min(3, Math.max(0.4, jetStrength));
    this.velocity.gravityUp.copy(up);
    this.accumulator = Math.min(0.1, this.accumulator + Math.max(0, Math.min(0.25, dt)));
    while (this.accumulator + 1e-10 >= TUBE_SIMULATION.field.stepSeconds) {
      const step = TUBE_SIMULATION.field.stepSeconds;
      this.accumulator -= step; this.age += step;
      // Mask follows the liquid and tube pose. Reassign displaced amounts to the
      // nearest occupied cell, so a moving meniscus does not destroy matter.
      const maskChanged = this.priorUp.distanceToSquared(up) > 0.0004
        || Math.abs(this.priorLevel - level) > m.height / m.ny * 0.5;
      const prior = maskChanged ? m.data.slice() : null;
      if (maskChanged) {
        m.update(up, level);
        this.solver.refreshMask();
        this.priorUp.copy(up); this.priorLevel = level;
      }
      if (!this.initialized && m.activeCount) {
        for (let a = 0; a < m.activeCount; a++) {
          const i = m.active[a];
          this.species["SO3(2-)"].values[i] = this.sulfiteAmount / m.activeCount;
          this.species["H+"].values[i] = this.acidAmount / m.activeCount;
        }
        this.initialized = true;
      } else if (prior && this.initialized) {
        for (const field of [...Object.values(this.species).map(s => s.values), this.tracer]) for (let i = 0; i < prior.length; i++) {
          if (!prior[i] || m.data[i] || field[i] === 0) continue;
          const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
          let best = -1, distance = Infinity;
          for (let a = 0; a < m.activeCount; a++) {
            const j = m.active[a];
            const dx = j % m.nx - x, dy = Math.floor(j / m.nx) % m.ny - y;
            const dz = Math.floor(j / (m.nx * m.ny)) - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < distance) { best = j; distance = d; }
          }
          if (best >= 0) field[best] += field[i];
          field[i] = 0;
        }
      }
      const amount = Math.max(0, Math.min(2, delivered) - this.delivered);
      this.inject(inlet, amount);
      this.solver.step(step, inlet, jetDirection ?? up.clone().negate(), amount > 0 ? 0.2 * this.jetStrength : 0,
        this.velocity.contributions.acceleration.length(),
        this.velocity.contributions.acceleration.lengthSq() > 0.0001
          ? (x, y, z) => this.velocity.at(x, y, z, this.age) : undefined);
      // Subcycle the conservative flux so strong sub-voxel contact stays stable.
      for (let pass = 0; pass < 3; pass++) {
        for (const field of Object.values(this.species))
          this.solver.transport(field.values, step / 3, 0.00012);
        this.solver.transport(this.tracer, step / 3, 0.00012);
      }
      const mn = this.species["MnO4-"].values, so = this.species["SO3(2-)"].values;
      const acid = this.species["H+"].values, sulfate = this.species["SO4(2-)"].values;
      const manganese = this.species["Mn2+"].values;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        // A concentrated incoming core excludes the receiving solution on
        // this coarse grid. Dilute edges have the greatest effective contact.
        const r = reactR4(mn[i], so[i], acid[i], 1 - Math.exp(-40 * step));
        mn[i] = r.manganate; so[i] = r.sulfite; acid[i] = r.acid;
        sulfate[i] += r.sulfate; manganese[i] += r.manganeseII; this.extent += r.extent;
      }
      const scale = m.data.length * 0.06;
      for (let i = 0; i < this.pixels.length; i++)
        this.pixels[i] = m.data[i] ? finitePositive(mn[i]) * scale : 0;
      this.texture.needsUpdate = true;
    }
  }

  private inject(inlet: THREE.Vector3, amount: number) {
    if (amount <= 0) return;
    const m = this.mask, weights = this.next;
    let sum = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
      const p = m.point(x, y, z, this.scratch);
      const dx = p.x - inlet.x, dy = p.y - inlet.y, dz = p.z - inlet.z;
      const width = m.radius * 0.3;
      const weight = Math.exp(-(dx * dx + dz * dz + dy * dy) / (width * width));      weights[i] = weight; sum += weight;
    }
    if (sum < 1e-12) {
      let best = -1, distance = Infinity;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
        const z = Math.floor(i / (m.nx * m.ny));
        const d = m.point(x, y, z, this.scratch).distanceToSquared(inlet);
        if (d < distance) { best = i; distance = d; }
      }
      if (best >= 0) { this.species["MnO4-"].values[best] += amount; this.tracer[best] += amount; }
    } else for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], added = amount * weights[i] / sum;
      this.species["MnO4-"].values[i] += added; this.tracer[i] += added;
    }
    this.delivered += amount;
  }

  diagnostics() {
    return { flow: this.solver.diagnostics(), tracer: this.solver.scalarDiagnostics(this.tracer),
      reagent: this.solver.scalarDiagnostics(this.species["MnO4-"].values), extent: this.extent };
  }

  dispose() { this.texture.dispose(); }
}
