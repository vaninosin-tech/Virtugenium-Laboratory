import * as THREE from "three";
import { LiquidMask, SpeciesField, VelocityField } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";

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
  readonly species: Record<string, SpeciesField>;
  readonly texture: THREE.Data3DTexture;
  readonly pixels: Float32Array;
  extent = 0;
  delivered = 0;
  private age = 0;
  private accumulator = 0;
  private initialized = false;
  private readonly scratch = new THREE.Vector3();
  private readonly next: Float64Array;
  private readonly flow: Float32Array;
  private readonly inlet = new THREE.Vector3();
  private jetStrength = 1;
  private readonly priorUp = new THREE.Vector3(Infinity, Infinity, Infinity);
  private priorLevel = Infinity;

  constructor(quality: "LOW" | "MEDIUM" | "HIGH", radius: number, bottom: number, height: number,
    readonly sulfiteAmount = 6, readonly acidAmount = 7.2, readonly relativeDensity = 1) {
    const size = quality === "LOW" ? TUBE_SIMULATION.field.LOW
      : { width: 16, height: 32, depth: 16 };
    this.mask = new LiquidMask(size.width, size.height, size.depth, radius, bottom, height);
    this.velocity = new VelocityField(this.mask);
    this.species = Object.fromEntries(["MnO4-", "SO3(2-)", "H+", "SO4(2-)", "Mn2+"]
      .map(id => [id, new SpeciesField(id, this.mask)]));
    this.next = new Float64Array(this.mask.data.length);
    this.flow = new Float32Array(this.mask.data.length * 3);
    this.pixels = new Float32Array(this.mask.data.length);
    this.texture = new THREE.Data3DTexture(this.pixels, this.mask.nx, this.mask.ny, this.mask.nz);
    this.texture.format = THREE.RedFormat; this.texture.type = THREE.FloatType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1; this.texture.needsUpdate = true;
  }

  get progress() { return Math.min(1, this.extent / Math.min(1, this.sulfiteAmount / 5, this.acidAmount / 6)); }

  advance(dt: number, up: THREE.Vector3, level: number, inlet: THREE.Vector3,
    delivered: number, jetStrength = 1) {
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
        for (const field of Object.values(this.species)) for (let i = 0; i < prior.length; i++) {
          if (!prior[i] || m.data[i] || field.values[i] === 0) continue;
          const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
          let best = -1, distance = Infinity;
          for (let a = 0; a < m.activeCount; a++) {
            const j = m.active[a];
            const dx = j % m.nx - x, dy = Math.floor(j / m.nx) % m.ny - y;
            const dz = Math.floor(j / (m.nx * m.ny)) - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < distance) { best = j; distance = d; }
          }
          if (best >= 0) field.values[best] += field.values[i];
          field.values[i] = 0;
        }
      }
      this.inject(inlet, Math.max(0, Math.min(2, delivered) - this.delivered));
      this.updateFlow();
      for (const field of Object.values(this.species)) this.transport(field.values, step, field.id === "MnO4-");
      // Unresolved eddies exchange the premixed receiving solution across
      // the coarse grid. This is conservative; the dye itself stays local.
      for (const id of ["SO3(2-)", "H+"]) {
        const values = this.species[id].values;
        let total = 0;
        for (let a = 0; a < m.activeCount; a++) total += values[m.active[a]];
        const mean = total / Math.max(1, m.activeCount);
        for (let a = 0; a < m.activeCount; a++) {
          const i = m.active[a]; values[i] += 0.18 * (mean - values[i]);
        }
      }
      const mn = this.species["MnO4-"].values, so = this.species["SO3(2-)"].values;
      const acid = this.species["H+"].values, sulfate = this.species["SO4(2-)"].values;
      const manganese = this.species["Mn2+"].values;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        // A concentrated incoming core excludes the receiving solution on
        // this coarse grid. Dilute edges have the greatest effective contact.
        const contact = Math.min(so[i] / (so[i] + mn[i] + 1e-30),
          acid[i] / (acid[i] + 1.2 * mn[i] + 1e-30));
        const r = reactR4(mn[i], so[i], acid[i], (1 - Math.exp(-40 * step)) * contact);
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
      const depth = Math.max(0, inlet.y - p.y);
      const reach = m.radius * (0.45 + 2.6 * Math.min(1, this.age / 0.9)) * this.jetStrength;
      const along = depth / reach;
      let weight = 0;
      if (p.y <= inlet.y + m.radius * 0.2 && along < 1.1) for (let branch = 0; branch < 3; branch++) {
        const phase = this.age * (3.2 + branch * 0.4) + branch * 2.09;
        const x0 = inlet.x + m.radius * (0.12 * Math.sin(phase)
          + along * (0.19 * Math.sin(phase + along * 5.4) + (branch - 1) * 0.30));
        const z0 = inlet.z + m.radius * (0.12 * Math.cos(phase * 0.85)
          + along * 0.21 * Math.cos(phase - along * 4.8));
        const width = m.radius * (0.095 + along * 0.035);
        const radial = ((p.x - x0) ** 2 + (p.z - z0) ** 2) / (width * width);
        const tip = Math.min(1, Math.max(0, (1.1 - along) * 10));
        weight += (branch === 0 ? 1 : 0.55) * Math.exp(-radial)
          * Math.exp(-along * 1.4) * tip;
      }
      weights[i] = weight; sum += weight;
    }
    if (sum < 1e-12) {
      let best = -1, distance = Infinity;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
        const z = Math.floor(i / (m.nx * m.ny));
        const d = m.point(x, y, z, this.scratch).distanceToSquared(inlet);
        if (d < distance) { best = i; distance = d; }
      }
      if (best >= 0) this.species["MnO4-"].values[best] += amount;
    } else for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a]; this.species["MnO4-"].values[i] += amount * weights[i] / sum;
    }
    this.delivered += amount;
  }

  private updateFlow() {
    const m = this.mask, flow = this.flow;
    const up = this.velocity.gravityUp;
    const jetDecay = Math.exp(-this.age / 2.4);
    const curlDecay = Math.exp(-this.age / 3.5);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      const p = m.point(x, y, z, this.scratch);
      const v = this.velocity.at(p.x, p.y, p.z, this.age);
      const depth = Math.max(0, this.inlet.y - p.y);
      const bend = depth / m.radius;
      const centreX = this.inlet.x + m.radius * 0.27 * Math.sin(bend * 1.1 + this.age * 1.7);
      const centreZ = this.inlet.z + m.radius * 0.24 * Math.sin(bend * 1.4 - this.age * 1.3);
      const spread = m.radius * (0.23 + 0.06 * bend);
      const jetMask = Math.exp(-((p.x - centreX) ** 2 + (p.z - centreZ) ** 2)
        / (spread * spread)) * Math.exp(-depth / (m.height * 0.8));
      const jet = 0.017 * this.jetStrength * jetMask * jetDecay;
      const curl = 0.0032 * jetMask * curlDecay;
      const phase = bend * 2.7 + this.age * 4.3 + p.z / m.radius * 3.1;
      flow[i * 3] = v[0] - jet * up.x + curl * Math.sin(phase);
      flow[i * 3 + 1] = v[1] - jet * up.y;
      flow[i * 3 + 2] = v[2] - jet * up.z + curl * Math.cos(phase * 0.9);
    }
  }

  private transport(values: Float64Array, dt: number, incoming: boolean) {
    const m = this.mask, next = this.next;
    next.set(values);
    const offsets = [1, m.nx, m.nx * m.ny];
    const spacings = [2 * m.radius / m.nx, m.height / m.ny, 2 * m.radius / m.nz];
    const density = incoming ? this.relativeDensity * 0.0028 * Math.exp(-this.age / 4) : 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      for (let axis = 0; axis < 3; axis++) {
        if ((axis === 0 && x + 1 === m.nx) || (axis === 1 && y + 1 === m.ny)
          || (axis === 2 && z + 1 === m.nz)) continue;
        const j = i + offsets[axis];
        if (!m.data[j]) continue;
        // Jet momentum is shared by the liquid; density adds only a small
        // relative drift to the incoming reagent.
        const speed = this.flow[i * 3 + axis]
          - density * this.velocity.gravityUp.getComponent(axis);
        const f = Math.min(0.30, Math.abs(speed) * dt / spacings[axis]);
        const advect = speed >= 0 ? values[i] * f : -values[j] * f;
        const diffuse = (values[i] - values[j]) * (incoming ? 0.07 : 0.08);
        const flux = Math.max(-values[j] * 0.34, Math.min(values[i] * 0.34, advect + diffuse));
        next[i] -= flux; next[j] += flux;
      }
    }
    for (let i = 0; i < values.length; i++) values[i] = finitePositive(next[i]);
  }

  dispose() { this.texture.dispose(); }
}
