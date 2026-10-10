import * as THREE from "three";
import { copperReactionState, type CopperReactionState } from "./tubeReactions";

export type SpeciesId = "Cu2+" | (string & {});
export type ReactionState = CopperReactionState;

const finite = (v: number) => Number.isFinite(v) ? v : 0;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A local, closed liquid volume. Each occupied voxel has equal numerical volume. */
export class LiquidMask {
  readonly data: Uint8Array;
  readonly active: Int32Array;
  activeCount = 0;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly radius: number;
  readonly bottom: number;
  readonly height: number;
  private up = new THREE.Vector3(0, 1, 0);
  private readonly pointScratch = new THREE.Vector3();
  private level = 0;

  constructor(nx: number, ny: number, nz: number, radius: number, bottom: number, height: number) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.radius = radius; this.bottom = bottom; this.height = height;
    this.data = new Uint8Array(nx * ny * nz);
    this.active = new Int32Array(this.data.length);
    this.update(this.up, bottom + height * 0.7);
  }

  index(x: number, y: number, z: number) { return (z * this.ny + y) * this.nx + x; }
  point(x: number, y: number, z: number, out = new THREE.Vector3()) {
    return out.set(
      (x + 0.5) / this.nx * this.radius * 2 - this.radius,
      this.bottom + (y + 0.5) / this.ny * this.height,
      (z + 0.5) / this.nz * this.radius * 2 - this.radius,
    );
  }
  contains(p: THREE.Vector3) {
    const h = p.y - this.bottom;
    if (h < 0 || h > this.height || p.dot(this.up) > this.level) return false;
    const radial = Math.hypot(p.x, p.z);
    return h < this.radius ? radial * radial + (h - this.radius) ** 2 < this.radius ** 2
      : radial < this.radius;
  }
  update(up: THREE.Vector3, level: number) {
    this.up.copy(up).normalize(); this.level = level;
    this.activeCount = 0;
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++)
      for (let x = 0; x < this.nx; x++) {
        const i = this.index(x, y, z);
        this.data[i] = this.contains(this.point(x, y, z, this.pointScratch)) ? 1 : 0;
        if (this.data[i]) this.active[this.activeCount++] = i;
      }
  }
}

export class SpeciesField {
  readonly values: Float64Array;
  constructor(readonly id: SpeciesId, readonly mask: LiquidMask) {
    this.values = new Float64Array(mask.data.length);
  }
  get total() { let total = 0; for (const v of this.values) total += v; return total; }
}

export interface VelocityContributions {
  gas: number;
  buoyancy: number;
  bubbles: number;
  acceleration: THREE.Vector3;
}

/** Curl of an analytic vector potential; face samples have no volume source. */
export class VelocityField {
  private readonly result = new Float64Array(3);
  readonly contributions: VelocityContributions = {
    gas: 0, buoyancy: 0, bubbles: 0, acceleration: new THREE.Vector3(),
  };
  constructor(readonly mask: LiquidMask) {}
  at(x: number, y: number, z: number, time: number) {
    const r = this.mask.radius, h = this.mask.height;
    const X = x / r, Y = (y - this.mask.bottom) / h, Z = z / r;
    const heat = this.contributions.buoyancy;
    const motion = 0.38 + 0.62 * heat + 0.25 * this.contributions.gas;
    const ax = 3.7 * X + time * 0.81 * motion, ay = 4.1 * Y - time * 0.59 * motion;
    const az = 3.2 * Z + time * 0.73 * motion;
    const sx = Math.sin(ax), sy = Math.sin(ay), sz = Math.sin(az);
    const swirl = 0.000002 + heat * 0.000005 + this.contributions.gas * 0.000002;
    const dSdx = swirl * 3.7 / r * Math.cos(ax) * sy * sz;
    const dSdy = swirl * 4.1 / h * sx * Math.cos(ay) * sz;
    const dSdz = swirl * 3.2 / r * sx * sy * Math.cos(az);
    // Curl of (Zp, 0, -Xp), with a wandering centre. The broad updraft
    // reaches the copper surface; the return flow runs along the glass.
    const bend = 0.14 + heat * 0.14;
    const phaseX = 1.4 * Y - time * 0.67 * motion;
    const phaseZ = 1.1 * Y + time * 0.51 * motion;
    const cx = bend * Math.sin(phaseX), cz = bend * Math.cos(phaseZ);
    const cxY = bend * 1.4 * Math.cos(phaseX) / h;
    const czY = -bend * 1.1 * Math.sin(phaseZ) / h;
    const U = X - cx, V = Z - cz, radial2 = U * U + V * V;
    const strength = 0.00022 + this.contributions.gas * 0.0006
      + heat * 0.001 + this.contributions.bubbles * 0.0003;
    const plume = strength * Math.exp(-0.65 * radial2);
    const plumeY = plume * 1.3 * (U * cxY + V * czY);
    const accel = this.contributions.acceleration;
    this.result[0] = -0.8 * dSdy - 0.7 * dSdz - U * plumeY + cxY * plume - accel.x * 0.0001 / h;
    this.result[1] = dSdz + 0.8 * dSdx + plume * (2 - 1.3 * radial2);
    this.result[2] = 0.7 * dSdx - dSdy - V * plumeY + czY * plume + accel.z * 0.0001 / r;
    return this.result;
  }
}

export class TubeVolumeField {
  readonly mask: LiquidMask;
  readonly species: Record<string, SpeciesField>;
  readonly velocity: VelocityField;
  previous: THREE.Data3DTexture;
  current: THREE.Data3DTexture;
  readonly reaction: ReactionState = copperReactionState(0);
  private prevPixels: Float32Array;
  private pixels: Float32Array;
  private readonly sources: THREE.Vector3[];
  private readonly faceX: Float32Array;
  private readonly faceY: Float32Array;
  private readonly faceZ: Float32Array;
  private readonly facesX: Int32Array;
  private readonly facesY: Int32Array;
  private readonly facesZ: Int32Array;
  private countX = 0;
  private countY = 0;
  private countZ = 0;
  private readonly fluxX: Float64Array;
  private readonly fluxY: Float64Array;
  private readonly fluxZ: Float64Array;
  private readonly outgoing: Float64Array;
  private readonly nextValues: Float64Array;
  private readonly injectionWeights: Float64Array;
  private readonly nearest: Int32Array;
  private readonly queue: Int32Array;
  private injectionTotal = 0;
  private injectionDirty = true;
  private readonly injectionPoint = new THREE.Vector3();
  private readonly fallbackSource = new THREE.Vector3();
  private readonly kernelX = new Float64Array(32);
  private readonly kernelY = new Float64Array(32);
  private readonly kernelZ = new Float64Array(32);
  private readonly kernelWeight = new Float64Array(32);
  private velocityAge = Infinity;
  private readonly priorUp = new THREE.Vector3(Infinity, Infinity, Infinity);
  private priorLevel = Infinity;
  private accumulator = 0;
  private time = 0;
  private pending = 0;
  private lastProgress = 0;
  private readonly step: number;

  constructor(quality: "LOW" | "MEDIUM" | "HIGH", radius: number, bottom: number, height: number,
    sources: readonly THREE.Vector3[]) {
    const low = quality === "LOW";
    this.step = 1 / 20;
    this.mask = new LiquidMask(low ? 16 : 22, low ? 32 : 44, low ? 16 : 22, radius, bottom, height);
    this.species = { "Cu2+": new SpeciesField("Cu2+", this.mask) };
    this.velocity = new VelocityField(this.mask);
    this.sources = sources.map(p => p.clone());
    const n = this.mask.data.length;
    this.faceX = new Float32Array(n); this.faceY = new Float32Array(n); this.faceZ = new Float32Array(n);
    this.facesX = new Int32Array(n); this.facesY = new Int32Array(n); this.facesZ = new Int32Array(n);
    this.fluxX = new Float64Array(n); this.fluxY = new Float64Array(n); this.fluxZ = new Float64Array(n);
    this.outgoing = new Float64Array(n); this.nextValues = new Float64Array(n);
    this.injectionWeights = new Float64Array(n);
    this.nearest = new Int32Array(n); this.queue = new Int32Array(n);
    this.prevPixels = new Float32Array(n); this.pixels = new Float32Array(n);
    const texture = (pixels: Float32Array) => {
      const t = new THREE.Data3DTexture(pixels, this.mask.nx, this.mask.ny, this.mask.nz);
      t.format = THREE.RedFormat; t.type = THREE.FloatType;
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    };
    this.previous = texture(this.prevPixels); this.current = texture(this.pixels);
    this.rebuildFaces();
  }

  get alpha() { return clamp(this.accumulator / this.step, 0, 1); }
  get copperII() { return this.species["Cu2+"].total; }
  setSources(points: readonly THREE.Vector3[], count = points.length) {
    if (this.sources.length !== count) this.injectionDirty = true;
    const tolerance = Math.min(2 * this.mask.radius / this.mask.nx,
      this.mask.height / this.mask.ny) * 0.25;
    for (let i = 0; i < count; i++) {
      if (this.sources[i]) {
        if (this.sources[i].distanceToSquared(points[i]) > tolerance * tolerance) this.injectionDirty = true;
        if (this.injectionDirty) this.sources[i].copy(points[i]);
      } else { this.sources[i] = points[i].clone(); this.injectionDirty = true; }
    }
    this.sources.length = count;
  }
  /** The controller owns ξ. This only integrates positive increments of its progress. */
  advance(dt: number, progress: number, up: THREE.Vector3, level: number, gasDrive = 0, temperature = 0) {
    const p = clamp(finite(progress), 0, 1);
    const delta = Math.max(0, p - this.lastProgress);
    this.lastProgress = p;
    this.pending += delta;
    this.velocity.contributions.gas = clamp(finite(gasDrive), 0, 1);
    this.velocity.contributions.buoyancy = clamp(finite(temperature), 0, 1);
    this.accumulator = Math.min(this.step * 2, this.accumulator + clamp(finite(dt), 0, 0.25));
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.step && steps++ < 2) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      if (this.priorUp.distanceToSquared(up) > 0.0004 || Math.abs(this.priorLevel - level) > this.mask.height / this.mask.ny * 0.75) {
        this.mask.update(up, level);
        this.rebuildFaces();
        this.reconcileMask();
        this.injectionDirty = true;
        this.velocityAge = Infinity;
        this.priorUp.copy(up); this.priorLevel = level;
      }
      this.velocityAge += this.step;
      if (this.velocityAge >= 0.4) { this.updateVelocities(); this.velocityAge = 0; }
      const oldTexture = this.previous; this.previous = this.current; this.current = oldTexture;
      const oldPixels = this.prevPixels; this.prevPixels = this.pixels; this.pixels = oldPixels;
      this.transport(this.step);
      if (this.pending > 0) { this.inject(this.pending); this.pending = 0; }
      this.writeTexture();
      this.time += this.step;
    }
  }

  private rebuildFaces() {
    const m = this.mask, slice = m.nx * m.ny;
    this.countX = this.countY = this.countZ = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      if (i % m.nx + 1 < m.nx && m.data[i + 1]) this.facesX[this.countX++] = i;
      if (Math.floor(i / m.nx) % m.ny + 1 < m.ny && m.data[i + m.nx]) this.facesY[this.countY++] = i;
      if (i + slice < m.data.length && m.data[i + slice]) this.facesZ[this.countZ++] = i;
    }
  }

  private reconcileMask() {
    const values = this.species["Cu2+"].values, mask = this.mask;
    const nearest = this.nearest, queue = this.queue;
    nearest.fill(-1);
    let head = 0, tail = 0;
    for (let a = 0; a < mask.activeCount; a++) {
      const i = mask.active[a]; nearest[i] = i; queue[tail++] = i;
    }
    const slice = mask.nx * mask.ny;
    while (head < tail) {
      const i = queue[head++], target = nearest[i];
      const x = i % mask.nx, y = Math.floor(i / mask.nx) % mask.ny, z = Math.floor(i / slice);
      if (x > 0 && nearest[i - 1] < 0) { nearest[i - 1] = target; queue[tail++] = i - 1; }
      if (x + 1 < mask.nx && nearest[i + 1] < 0) { nearest[i + 1] = target; queue[tail++] = i + 1; }
      if (y > 0 && nearest[i - mask.nx] < 0) { nearest[i - mask.nx] = target; queue[tail++] = i - mask.nx; }
      if (y + 1 < mask.ny && nearest[i + mask.nx] < 0) { nearest[i + mask.nx] = target; queue[tail++] = i + mask.nx; }
      if (z > 0 && nearest[i - slice] < 0) { nearest[i - slice] = target; queue[tail++] = i - slice; }
      if (z + 1 < mask.nz && nearest[i + slice] < 0) { nearest[i + slice] = target; queue[tail++] = i + slice; }
    }
    for (let i = 0; i < values.length; i++) {
      if (mask.data[i] || values[i] === 0) continue;
      const target = nearest[i];
      if (target >= 0) values[target] += values[i];
      values[i] = 0;
    }
  }

  private transport(dt: number) {
    const m = this.mask, values = this.species["Cu2+"].values;
    const dx = 2 * m.radius / m.nx, dy = m.height / m.ny, dz = 2 * m.radius / m.nz;
    const diffusivity = 0.00002 + this.velocity.contributions.buoyancy * 0.000035
      + this.velocity.contributions.gas * 0.000015;
    const { fluxX, fluxY, fluxZ, outgoing, nextValues } = this;
    outgoing.fill(0);
    nextValues.set(values);
    for (let axis = 0; axis < 3; axis++) {
      const faces = axis === 0 ? this.facesX : axis === 1 ? this.facesY : this.facesZ;
      const speeds = axis === 0 ? this.faceX : axis === 1 ? this.faceY : this.faceZ;
      const fluxes = axis === 0 ? fluxX : axis === 1 ? fluxY : fluxZ;
      const count = axis === 0 ? this.countX : axis === 1 ? this.countY : this.countZ;
      const offset = axis === 0 ? 1 : axis === 1 ? m.nx : m.nx * m.ny;
      const spacing = axis === 0 ? dx : axis === 1 ? dy : dz;
      const cfl = dt / spacing, mix = Math.min(0.42, diffusivity * dt / (spacing * spacing));
      for (let k = 0; k < count; k++) {
        const a = faces[k], b = a + offset;
        const fraction = Math.max(-0.2, Math.min(0.2, speeds[a] * cfl));
        const raw = (fraction >= 0 ? values[a] : values[b]) * fraction + (values[a] - values[b]) * mix;
        fluxes[a] = raw;
        if (raw > 0) outgoing[a] += raw;
        else outgoing[b] -= raw;
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      const faces = axis === 0 ? this.facesX : axis === 1 ? this.facesY : this.facesZ;
      const fluxes = axis === 0 ? fluxX : axis === 1 ? fluxY : fluxZ;
      const count = axis === 0 ? this.countX : axis === 1 ? this.countY : this.countZ;
      const offset = axis === 0 ? 1 : axis === 1 ? m.nx : m.nx * m.ny;
      for (let k = 0; k < count; k++) {
        const a = faces[k], b = a + offset, raw = fluxes[a];
        if (raw === 0) continue;
        const donor = raw > 0 ? a : b;
        const flux = raw * Math.min(1, values[donor] / Math.max(1e-30, outgoing[donor]));
        nextValues[a] -= flux; nextValues[b] += flux;
      }
    }
    values.set(nextValues);
  }

  private updateVelocities() {
    const m = this.mask;
    const dx = 2 * m.radius / m.nx, dy = m.height / m.ny, dz = 2 * m.radius / m.nz;
    for (let axis = 0; axis < 3; axis++) {
      const faces = axis === 0 ? this.facesX : axis === 1 ? this.facesY : this.facesZ;
      const speeds = axis === 0 ? this.faceX : axis === 1 ? this.faceY : this.faceZ;
      const count = axis === 0 ? this.countX : axis === 1 ? this.countY : this.countZ;
      for (let k = 0; k < count; k++) {
        const i = faces[k];
        const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
        const px = -m.radius + (x + 0.5) * dx;
        const py = m.bottom + (y + 0.5) * dy;
        const pz = -m.radius + (z + 0.5) * dz;
        speeds[i] = this.velocity.at(px + (axis === 0 ? dx / 2 : 0),
          py + (axis === 1 ? dy / 2 : 0), pz + (axis === 2 ? dz / 2 : 0), this.time)[axis];
      }
    }
  }

  private inject(dXi: number) {
    const d = Math.min(dXi, this.reaction.copper / 3, this.reaction.acid / 8);
    if (d <= 0) return;
    Object.assign(this.reaction, copperReactionState(this.reaction.extent + d));
    const values = this.species["Cu2+"].values, m = this.mask;
    this.fallbackSource.set(0, m.bottom + m.radius, 0);
    const zones = this.sources.length ? this.sources : [this.fallbackSource];
    const zoneCount = Math.min(zones.length, this.kernelX.length);
    const weights = this.injectionWeights;
    if (this.injectionDirty) {
      for (let s = 0; s < zoneCount; s++) {
        const source = zones[s];
        const angle = s * 2.399;
        this.kernelX[s] = source.x + Math.cos(angle) * m.radius * 0.15;
        this.kernelY[s] = source.y;
        this.kernelZ[s] = source.z + Math.sin(angle) * m.radius * 0.15;
        this.kernelWeight[s] = 0.25 + 0.75 * Math.sin(s * 7.1) ** 2;
      }
      let total = 0;
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny, z = Math.floor(i / (m.nx * m.ny));
        const q = m.point(x, y, z, this.injectionPoint);
        let w = 0;
        for (let s = 0; s < zoneCount; s++) {
          const r2 = ((q.x - this.kernelX[s]) / (m.radius * 0.22)) ** 2
            + ((q.y - this.kernelY[s]) / (m.radius * 0.18)) ** 2
            + ((q.z - this.kernelZ[s]) / (m.radius * 0.22)) ** 2;
          w += this.kernelWeight[s] * Math.exp(-r2 * 2.8);
        }
        weights[i] = w > 1e-6 ? w : 0;
        total += weights[i];
      }
      this.injectionTotal = total;
      this.injectionDirty = false;
    }
    if (this.injectionTotal === 0) return;
    const scale = 3 * d / this.injectionTotal;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a]; values[i] += scale * weights[i];
    }
  }

  private writeTexture() {
    const m = this.mask, v = this.species["Cu2+"].values;
    // Normalize by a whole-tube amount, not by max voxel, so hue preserves mass.
    const scale = m.data.length * 0.018;
    for (let i = 0; i < v.length; i++) this.pixels[i] = m.data[i] ? Math.max(0, finite(v[i]) * scale) : 0;
    this.current.needsUpdate = true;
  }
  dispose() { this.previous.dispose(); this.current.dispose(); }
}
