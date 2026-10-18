import * as THREE from "three";
import { silverSedimentThickness } from "./night/render/silverOptics";

/** Conserved bottom reservoir, indexed by the liquid field's x/z columns. */
export class SilverSedimentField {
  readonly values: Float64Array;
  private readonly moved: Float64Array;
  compaction = 0;
  constructor(readonly nx: number, readonly nz: number) {
    this.values = new Float64Array(nx * nz);
    this.moved = new Float64Array(nx * nz);
  }
  get mass() { let sum = 0; for (const value of this.values) sum += value; return sum; }
  deposit(column: number, amount: number) { this.values[column] += amount; }
  release(column: number, fraction: number) {
    const amount = this.values[column] * fraction;
    this.values[column] -= amount;
    return amount;
  }
  settle(dt: number) {
    this.compaction = Math.min(1, this.compaction + dt / 35);
    // Loose curds slide down the hemispherical floor toward its low point.
    const moved = this.moved;
    moved.fill(0);
    const fraction = 1 - Math.exp(-dt * 2.5);
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const source = z * this.nx + x, mass = this.values[source];
      if (mass <= 0) continue;
      const tx = x + Math.sign((this.nx - 1) * 0.5 - x);
      const tz = z + Math.sign((this.nz - 1) * 0.5 - z);
      const destination = tz * this.nx + tx;
      moved[source] += mass * (1 - fraction);
      moved[destination] += mass * fraction;
    }
    this.values.set(moved);
  }

  /** Cohesive curd slumps only when its local column load exceeds a neighbour's. */
  settleCurd(dt: number) {
    const moved = this.moved;
    moved.set(this.values);
    let loaded = 0;
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const i = z * this.nx + x, mass = this.values[i];
      loaded = Math.max(loaded, mass);
      if (mass <= 0) continue;
      let target = -1, low = mass;
      for (let side = 0; side < 4; side++) {
        const j = side === 0 ? (x > 0 ? i - 1 : -1)
          : side === 1 ? (x + 1 < this.nx ? i + 1 : -1)
          : side === 2 ? (z > 0 ? i - this.nx : -1)
          : z + 1 < this.nz ? i + this.nx : -1;
        if (j < 0) continue;
        const xx = (j % this.nx + .5) * 2 / this.nx - 1;
        const zz = (Math.floor(j / this.nx) + .5) * 2 / this.nz - 1;
        if (xx * xx + zz * zz < 1 && this.values[j] < low) { low = this.values[j]; target = j; }
      }
      if (target < 0 || mass <= low * 1.8) continue;
      const transfer = Math.min((mass - low * 1.8) * 0.15 * dt, mass * 0.1);
      moved[i] -= transfer; moved[target] += transfer;
    }
    this.values.set(moved);
    // Pressure from deposited mass closes pores; with no deposit there is no compaction.
    this.compaction = Math.min(1, this.compaction + dt * loaded / (loaded + 0.02) * 0.1);
  }
}

/** Closed fine-grained solid following the test tube's hemispherical inner floor. */
export class SilverSedimentGeometry extends THREE.BufferGeometry {
  private readonly position: Float32Array;
  private readonly thickness: Float32Array;
  private readonly rings = 14;
  private readonly sectors = 40;
  constructor(private readonly radius: number, private readonly bottom: number) {
    super();
    const count = 1 + this.rings * this.sectors;
    this.position = new Float32Array(count * 2 * 3);
    this.thickness = new Float32Array(count * 2);
    this.setAttribute("position", new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    this.setAttribute("sedimentThickness", new THREE.BufferAttribute(this.thickness, 1).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    const vertex = (ring: number, sector: number) => 1 + (ring - 1) * this.sectors + sector % this.sectors;
    for (let sector = 0; sector < this.sectors; sector++) {
      const a = vertex(1, sector), b = vertex(1, sector + 1);
      indices.push(0, b, a, count, count + a, count + b);
    }
    for (let ring = 1; ring < this.rings; ring++) for (let sector = 0; sector < this.sectors; sector++) {
      const a = vertex(ring, sector), b = vertex(ring, sector + 1);
      const c = vertex(ring + 1, sector), d = vertex(ring + 1, sector + 1);
      indices.push(a, b, c, b, d, c);
      indices.push(count + a, count + c, count + b, count + b, count + c, count + d);
    }
    for (let sector = 0; sector < this.sectors; sector++) {
      const a = vertex(this.rings, sector), b = vertex(this.rings, sector + 1);
      indices.push(a, b, count + a, b, count + b, count + a);
    }
    this.setIndex(indices);
  }

  update(field: SilverSedimentField) {
    const count = 1 + this.rings * this.sectors;
    for (let ring = 0; ring <= this.rings; ring++) {
      const u = ring / this.rings;
      const r = this.radius * 0.96 * u;
      const taper = 1 - THREE.MathUtils.smoothstep(u, 0.82, 1);
      const floor = this.bottom + this.radius - Math.sqrt(this.radius * this.radius - r * r);
      for (let sector = 0; sector < (ring === 0 ? 1 : this.sectors); sector++) {
        const angle = sector / this.sectors * Math.PI * 2;
        const x = r * Math.cos(angle), z = r * Math.sin(angle);
        const gx = (x / this.radius + 1) * field.nx * 0.5 - 0.5;
        const gz = (z / this.radius + 1) * field.nz * 0.5 - 0.5;
        const ix = Math.floor(gx), iz = Math.floor(gz);
        let local = 0, weight = 0;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          const sx = ix + dx, sz = iz + dz;
          if (sx < 0 || sx >= field.nx || sz < 0 || sz >= field.nz) continue;
          const distanceSq = (sx - gx) ** 2 + (sz - gz) ** 2;
          const w = Math.exp(-distanceSq * 0.75);
          const amount = field.values[sz * field.nx + sx];
          local += Math.max(0, Number.isFinite(amount) ? amount : 0) * w;
          weight += w;
        }
        // Fixed, broad curd variation modulates deposited mass; it does not
        // move or create any layer when a column contains no sediment.
        const grain = 0.91 + 0.055 * Math.sin(5 * angle + u * 11)
          + 0.035 * Math.sin(9 * angle - u * 17);
        const height = silverSedimentThickness(local / Math.max(weight, 1e-8),
          this.radius, field.compaction) * taper * grain;
        const i = ring === 0 ? 0 : 1 + (ring - 1) * this.sectors + sector;
        this.position.set([x, floor + height, z], i * 3);
        this.position.set([x, floor, z], (count + i) * 3);
        this.thickness[i] = this.thickness[count + i] = height;
      }
    }
    this.attributes.position.needsUpdate = true;
    this.attributes.sedimentThickness.needsUpdate = true;
    this.computeVertexNormals();
    this.computeBoundingSphere();
  }
}
