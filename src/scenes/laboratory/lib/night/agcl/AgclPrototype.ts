import * as THREE from "three";
import type { FlocAggregate } from "../../tubeSilverField";
import { SilverSedimentField } from "../../tubeSilverSediment";

export type VelocitySampler = (x: number, y: number, z: number) => readonly [number, number, number];
export type Vec3 = [number, number, number];

export interface CottonAggregate {
  position: Vec3;
  velocity: Vec3;
  mass: number;
  porosity: number;
  shape: number;
  /** Principal ellipsoid multipliers. Their product is approximately one. */
  axes: Vec3;
  /** Smooth, low frequency radial offsets for a soft, irregular silhouette. */
  modes: [number, number, number, number];
  strain: number;
  segregated?: boolean;
}

export interface FineParcel { position: Vec3; mass: number }

export interface PrototypeOptions {
  radius?: number;
  bottom?: number;
  height?: number;
  nx?: number;
  nz?: number;
  seed?: number;
  /** Effective viscosity includes unresolved fluid drag, in Pa s. */
  dragViscosity?: number;
  /** Dynamic viscosity used for the local shear stress, in Pa s. */
  shearViscosity?: number;
  maxAggregates?: number;
}

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
const sum = (values: readonly { mass: number }[]) => values.reduce((s, v) => s + v.mass, 0);

/** Standalone mass ledger and particle dynamics. Distances are metres; time is seconds. */
export class AgclPrototype {
  readonly aggregates: CottonAggregate[] = [];
  readonly fine: FineParcel[] = [];
  readonly sediment: SilverSedimentField;
  readonly radius: number;
  readonly bottom: number;
  readonly height: number;
  readonly dragViscosity: number;
  readonly shearViscosity: number;
  readonly maxAggregates: number;
  injectedMass = 0;
  private rngState: number;

  constructor(readonly flow: VelocitySampler, options: PrototypeOptions = {}) {
    this.radius = options.radius ?? 0.007;
    this.bottom = options.bottom ?? 0;
    this.height = options.height ?? 0.055;
    this.dragViscosity = options.dragViscosity ?? 0.03;
    this.shearViscosity = options.shearViscosity ?? 0.001;
    this.maxAggregates = options.maxAggregates ?? 128;
    this.sediment = new SilverSedimentField(options.nx ?? 12, options.nz ?? 12);
    this.rngState = (options.seed ?? 1) >>> 0 || 1;
  }

  get totalMass() { return sum(this.aggregates) + sum(this.fine) + this.sediment.mass; }
  get massError() { return this.totalMass - this.injectedMass; }

  private random() {
    let x = this.rngState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 0x100000000;
  }

  /** Pour one parcel at a moving source. The caller controls the rate and trajectory. */
  pour(position: Vec3, mass: number, aggregateFraction = 0.7, porosity?: number) {
    if (!Number.isFinite(mass) || mass < 0) throw new RangeError("mass must be finite and nonnegative");
    if (!Number.isFinite(aggregateFraction) || aggregateFraction < 0 || aggregateFraction > 1)
      throw new RangeError("aggregateFraction must be in [0, 1]");
    if (mass === 0) return;
    const p = this.bound([ ...position ] as Vec3);
    const coarse = mass * aggregateFraction;
    const fine = mass - coarse;
    if (coarse > 0) {
      if (this.aggregates.length < this.maxAggregates)
        this.aggregates.push(this.create(p, coarse, porosity ?? 0.45 + 0.4 * this.random()));
      else this.fine.push({ position: p, mass: coarse });
    }
    if (fine > 0) this.fine.push({ position: [...p], mass: fine });
    this.injectedMass += mass;
  }

  addAggregate(aggregate: CottonAggregate) {
    if (!(aggregate.mass > 0) || !Number.isFinite(aggregate.mass)) throw new RangeError("invalid mass");
    this.aggregates.push(aggregate);
    this.injectedMass += aggregate.mass;
  }

  /** Conservative fine capture by a nearby aggregate. */
  captureFine(fineIndex: number, aggregateIndex: number) {
    const f = this.fine[fineIndex], a = this.aggregates[aggregateIndex];
    if (!f || !a) throw new RangeError("invalid parcel index");
    a.mass += f.mass;
    this.fine.splice(fineIndex, 1);
  }

  /** A disrupted surface becomes suspended fine material. */
  erode(aggregateIndex: number, fraction: number) {
    const a = this.aggregates[aggregateIndex];
    if (!a || !Number.isFinite(fraction) || fraction < 0 || fraction > 1)
      throw new RangeError("invalid erosion");
    const mass = a.mass * fraction;
    a.mass -= mass;
    if (mass > 0) this.fine.push({ position: [...a.position], mass });
    if (a.mass === 0) this.aggregates.splice(aggregateIndex, 1);
  }

  /** Lift bottom material back into the liquid, as a fine parcel. */
  resuspend(column: number, fraction: number, position: Vec3) {
    if (!Number.isInteger(column) || column < 0 || column >= this.sediment.values.length
      || !Number.isFinite(fraction) || fraction < 0 || fraction > 1)
      throw new RangeError("invalid release");
    const mass = this.sediment.release(column, fraction);
    if (mass > 0) this.fine.push({ position: this.bound([...position]), mass });
  }

  create(position: Vec3, mass: number, porosity: number): CottonAggregate {
    if (!(mass > 0) || !Number.isFinite(mass)) throw new RangeError("invalid mass");
    const shape = this.rngState;
    const modes: [number, number, number, number] = [0, 0, 0, 0]
      .map(() => (this.random() - 0.5) * 0.16) as [number, number, number, number];
    return { position: [...position], velocity: [0, 0, 0], mass,
      porosity: clamp(porosity, 0.08, 0.95), shape, axes: [1, 1, 1], modes, strain: 0 };
  }

  /** Dry mass scale maps normalized reagent amounts to a visible radius. */
  effectiveRadius(a: CottonAggregate) {
    return 0.00026 * Math.cbrt(a.mass / (0.01 * (1 - a.porosity)));
  }

  /** Smooth non-crystalline radial profile for a renderer sampling unit directions. */
  surfaceRadius(a: CottonAggregate, direction: Vec3) {
    const [x, y, z] = direction;
    const ellipsoid = 1 / Math.sqrt((x / a.axes[0]) ** 2 + (y / a.axes[1]) ** 2
      + (z / a.axes[2]) ** 2);
    const [m0, m1, m2, m3] = a.modes;
    return this.effectiveRadius(a) * ellipsoid * (1 + m0 * (2 * y * y - x * x - z * z)
      + m1 * x * y + m2 * y * z + m3 * x * z);
  }

  floor(x: number, z: number) {
    const radial = Math.min(this.radius, Math.hypot(x, z));
    return this.bottom + this.radius - Math.sqrt(this.radius ** 2 - radial ** 2);
  }

  private bound(p: Vec3): Vec3 {
    const radial = Math.hypot(p[0], p[2]);
    const limit = this.radius * 0.94;
    if (radial > limit) { p[0] *= limit / radial; p[2] *= limit / radial; }
    p[1] = clamp(p[1], this.floor(p[0], p[2]), this.bottom + this.height);
    return p;
  }

  private column(x: number, z: number) {
    const ix = clamp(Math.floor((x / this.radius + 1) * this.sediment.nx / 2), 0, this.sediment.nx - 1);
    const iz = clamp(Math.floor((z / this.radius + 1) * this.sediment.nz / 2), 0, this.sediment.nz - 1);
    return iz * this.sediment.nx + ix;
  }

  private shearRate(p: Vec3, span: number) {
    let square = 0;
    for (let axis = 0; axis < 3; axis++) {
      const plus = [...p] as Vec3, minus = [...p] as Vec3;
      plus[axis] += span; minus[axis] -= span;
      const a = this.flow(...plus), b = this.flow(...minus);
      for (let component = 0; component < 3; component++)
        square += ((a[component] - b[component]) / (2 * span)) ** 2;
    }
    return Math.sqrt(square);
  }

  /** Fragment only if local viscous stress beats the wet network's strength. */
  strength(a: CottonAggregate) {
    return 0.045 * ((1 - a.porosity) / 0.4) ** 1.5
      * Math.pow(0.01 / Math.max(a.mass, 0.0001), 0.18);
  }

  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new RangeError("dt must be in (0, 0.1]");
    const newborn = new Set<CottonAggregate>();
    for (let i = this.fine.length - 1; i >= 0; i--) {
      const f = this.fine[i], u = this.flow(...f.position);
      f.position[0] += u[0] * dt; f.position[1] += (u[1] - 0.00004) * dt;
      f.position[2] += u[2] * dt;
      this.bound(f.position);
      if (f.position[1] <= this.floor(f.position[0], f.position[2]) + 0.00002) {
        this.sediment.deposit(this.column(f.position[0], f.position[2]), f.mass);
        this.fine.splice(i, 1);
      }
    }
    const initialCount = this.aggregates.length;
    for (let i = initialCount - 1; i >= 0; i--) {
      const a = this.aggregates[i];
      const radius = this.effectiveRadius(a);
      const shear = this.shearRate(a.position, Math.max(radius, 0.00008));
      const stress = this.shearViscosity * shear;
      // Deformation and compaction happen before any fracture decision.
      const deformation = clamp(shear * radius * 55, 0, 2.5);
      a.strain += (deformation - a.strain) * (1 - Math.exp(-dt * 3));
      a.axes[1] = clamp(1 + a.strain * 0.65, 1, 2.5);
      a.axes[0] = a.axes[2] = 1 / Math.sqrt(a.axes[1]);
      a.porosity = clamp(a.porosity - dt * shear * 0.0006 * (a.porosity - 0.08), 0.08, 0.95);
      const u = this.flow(...a.position);
      const densityDifference = (1 - a.porosity) * (5560 - 1000);
      const settling = (2 / 9) * densityDifference * 9.81 * radius * radius / this.dragViscosity;
      const response = 1 - Math.exp(-dt * 9 * this.dragViscosity
        / (2 * (1000 + densityDifference) * radius * radius));
      const target: Vec3 = [u[0], u[1] - settling, u[2]];
      for (let axis = 0; axis < 3; axis++) {
        a.velocity[axis] += (target[axis] - a.velocity[axis]) * response;
        a.position[axis] += a.velocity[axis] * dt;
      }
      this.bound(a.position);
      if (a.position[1] <= this.floor(a.position[0], a.position[2]) + radius * 0.45) {
        this.sediment.deposit(this.column(a.position[0], a.position[2]), a.mass);
        this.aggregates.splice(i, 1);
        continue;
      }
      if (stress > this.strength(a) && a.mass > 0.0002 && this.aggregates.length < this.maxAggregates) {
        const childMass = a.mass * clamp(0.15 + 0.12 * (stress / this.strength(a) - 1), 0.15, 0.4);
        a.mass -= childMass;
        const child = this.create([...a.position], childMass, clamp(a.porosity + 0.04, 0.08, 0.95));
        child.velocity = [...a.velocity]; child.segregated = true;
        child.position[0] += radius * 0.7 * (this.random() - 0.5);
        child.position[2] += radius * 0.7 * (this.random() - 0.5);
        this.bound(child.position);
        this.aggregates.push(child);
        newborn.add(child);
      }
    }
    // Connected curds stick on contact. Weighted properties conserve mass and momentum.
    for (let i = this.aggregates.length - 1; i >= 0; i--) {
      const a = this.aggregates[i];
      for (let j = 0; j < i; j++) {
        const b = this.aggregates[j];
        if (newborn.has(a) || newborn.has(b)) continue;
        const reach = 0.55 * (this.effectiveRadius(a) + this.effectiveRadius(b));
        if (Math.hypot(...a.position.map((v, k) => v - b.position[k]) as Vec3) > reach) continue;
        const total = a.mass + b.mass, wa = a.mass / total, wb = b.mass / total;
        for (let axis = 0; axis < 3; axis++) {
          b.position[axis] = a.position[axis] * wa + b.position[axis] * wb;
          b.velocity[axis] = a.velocity[axis] * wa + b.velocity[axis] * wb;
        }
        b.porosity = a.porosity * wa + b.porosity * wb;
        b.strain = a.strain * wa + b.strain * wb;
        b.axes = [a.axes[0] * wa + b.axes[0] * wb,
          a.axes[1] * wa + b.axes[1] * wb, a.axes[2] * wa + b.axes[2] * wb];
        b.mass = total;
        this.aggregates.splice(i, 1);
        break;
      }
    }
  }
}

export function fromFloc(floc: FlocAggregate, prototype: AgclPrototype): CottonAggregate {
  const a = prototype.create([floc.position.x, floc.position.y, floc.position.z],
    floc.mass, floc.porosity);
  a.velocity = [floc.velocity.x, floc.velocity.y, floc.velocity.z];
  a.shape = floc.shape;
  a.segregated = floc.segregated;
  return a;
}

export function toFloc(a: CottonAggregate): FlocAggregate {
  return { position: new THREE.Vector3(...a.position), velocity: new THREE.Vector3(...a.velocity),
    mass: a.mass, porosity: a.porosity, shape: a.shape, segregated: a.segregated };
}
