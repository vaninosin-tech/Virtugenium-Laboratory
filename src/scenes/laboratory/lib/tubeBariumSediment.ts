import * as THREE from "three";

/** Conserved bottom reservoir, indexed by the liquid field's x/z columns. */
export class BariumSedimentField {
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
  settle(dt: number) { this.compaction = Math.min(1, this.compaction + dt / 35); }
}

/** Closed fine-grained solid following the test tube's hemispherical inner floor. */
export class BariumSedimentGeometry extends THREE.BufferGeometry {
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

  update(field: BariumSedimentField) {
    const mass = field.mass;
    if (mass <= 0) return;
    const count = (this.rings + 1) * (this.sectors + 1);
    // Cell mass gives layer volume through a fixed effective packing factor.
    const thicknessPerCellMass = this.radius * 8 * (1 - field.compaction * 0.2);
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
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const sx = ix + dx, sz = iz + dz;
          if (sx < 0 || sx >= field.nx || sz < 0 || sz >= field.nz) continue;
          const w = 1 / (1 + dx * dx + dz * dz);
          const amount = field.values[sz * field.nx + sx];
          if (amount <= 0) continue;
          local += amount * w;
          weight += w;
        }
        const rawHeight = thicknessPerCellMass * local / Math.max(weight, 1);
        const cap = this.radius * 0.12;
        const height = cap * rawHeight / (cap + rawHeight);
        const grain = 0.94 + 0.035 * Math.sin(sector * 5.9 + ring * 3.1)
          + 0.025 * Math.sin(sector * 13.1 - ring * 6.3);
        const i = ring * (this.sectors + 1) + sector;
        this.position.set([x, floor + height * taper * grain, z], i * 3);
        this.position.set([x, floor - 0.00003, z], (count + i) * 3);
        this.thickness[i] = this.thickness[count + i] = height * taper * grain;
      }
    }
    this.attributes.position.needsUpdate = true;
    this.attributes.sedimentThickness.needsUpdate = true;
    this.computeVertexNormals();
    this.computeBoundingSphere();
  }
}
