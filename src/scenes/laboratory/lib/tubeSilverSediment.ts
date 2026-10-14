import * as THREE from "three";

/** Conserved bottom reservoir, indexed by the liquid field's x/z columns. */
export class SilverSedimentField {
  readonly values: Float64Array;
  compaction = 0;
  constructor(readonly nx: number, readonly nz: number) {
    this.values = new Float64Array(nx * nz);
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
    const moved = new Float64Array(this.values.length);
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
}

/** Closed fine-grained solid following the test tube's hemispherical inner floor. */
export class SilverSedimentGeometry extends THREE.BufferGeometry {
  private readonly position: Float32Array;
  private readonly thickness: Float32Array;
  private readonly rings = 14;
  private readonly sectors = 40;
  constructor(private readonly radius: number, private readonly bottom: number) {
    super();
    const count = (this.rings + 1) * (this.sectors + 1);
    this.position = new Float32Array(count * 2 * 3);
    this.thickness = new Float32Array(count * 2);
    this.setAttribute("position", new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    this.setAttribute("sedimentThickness", new THREE.BufferAttribute(this.thickness, 1).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    const stride = this.sectors + 1;
    for (let ring = 0; ring < this.rings; ring++) for (let sector = 0; sector < this.sectors; sector++) {
      const a = ring * stride + sector, b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      indices.push(count + a, count + b, count + a + 1,
        count + a + 1, count + b, count + b + 1);
    }
    for (let sector = 0; sector < this.sectors; sector++) {
      const a = this.rings * stride + sector, b = a + 1;
      indices.push(a, count + a, b, b, count + a, count + b);
    }
    this.setIndex(indices);
  }

  update(field: SilverSedimentField) {
    const mass = field.mass;
    if (mass <= 0) return;
    const count = (this.rings + 1) * (this.sectors + 1);
    // A loose curd bed contains mostly trapped liquid, so its visible volume
    // grows nonlinearly with the conserved mass that has reached the bowl.
    const pileHeight = this.radius * Math.min(5.1,
      (0.50 + 9.0 * Math.sqrt(mass)) * (1 - field.compaction * 0.12));
    for (let ring = 0; ring <= this.rings; ring++) {
      const u = ring / this.rings;
      const r = this.radius * 0.96 * u;
      const taper = 1 - THREE.MathUtils.smoothstep(u, 0.76, 1);
      const floor = this.bottom + this.radius - Math.sqrt(this.radius * this.radius - r * r);
      for (let sector = 0; sector <= this.sectors; sector++) {
        const angle = sector / this.sectors * Math.PI * 2;
        const x = r * Math.cos(angle), z = r * Math.sin(angle);
        const gx = THREE.MathUtils.clamp((x / this.radius + 1) * field.nx * 0.5, 0, field.nx - 1);
        const gz = THREE.MathUtils.clamp((z / this.radius + 1) * field.nz * 0.5, 0, field.nz - 1);
        const ix = Math.floor(gx), iz = Math.floor(gz);
        let local = 0, weight = 0;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          const sx = ix + dx, sz = iz + dz;
          if (sx < 0 || sx >= field.nx || sz < 0 || sz >= field.nz) continue;
          const w = Math.exp(-(dx * dx + dz * dz) * 0.43);
          const amount = field.values[sz * field.nx + sx];
          local += amount * w;
          weight += w;
        }
        const concentration = local / Math.max(weight * mass, 0.000001);
        const profile = Math.pow(Math.max(0, 1 - u * u), 1.35);
        const height = pileHeight * profile
          * THREE.MathUtils.clamp(0.80 + concentration * 0.8, 0.80, 1.18);
        const grain = 0.83 + 0.17 * Math.sin(sector * 5.9 + ring * 3.1)
          + 0.14 * Math.sin(sector * 13.1 - ring * 6.3);
        const i = ring * (this.sectors + 1) + sector;
        this.position.set([x, floor + height * taper * grain, z], i * 3);
        this.position.set([x, floor - 0.00003, z], (count + i) * 3);
        this.thickness[i] = this.thickness[count + i] = height * taper;
      }
    }
    this.attributes.position.needsUpdate = true;
    this.attributes.sedimentThickness.needsUpdate = true;
    this.computeVertexNormals();
    this.computeBoundingSphere();
  }
}
