import * as THREE from "three";
import { copperReactionState, type CopperReactionState } from "./tubeReactions";
import type { TemperatureField } from "./tubeTemperatureField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { TubeFlowSolver } from "./tubeFlowSolver";
import { tubeVessel } from "./vesselGeometry";

export type SpeciesId = "Cu2+" | (string & {});
export type ReactionState = CopperReactionState;

const finite = (v: number) => Number.isFinite(v) ? v : 0;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A local, closed liquid volume. Scalar arrays store amounts, while cellVolumeMl records wet physical volume. */
export class LiquidMask {
  readonly data: Uint8Array;
  readonly active: Int32Array;
  /** Physical liquid millilitres represented by each active voxel. */
  readonly cellVolumeMl: Float64Array;
  wetVolumeMl = 0;
  activeCount = 0;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly radius: number;
  readonly bottom: number;
  readonly height: number;
  private up = new THREE.Vector3(0, 1, 0);
  private readonly pointScratch = new THREE.Vector3();
  private obstacles: { center: THREE.Vector3; radius: number }[] = [];
  private level = 0;

  constructor(nx: number, ny: number, nz: number, radius: number, bottom: number, height: number) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.radius = radius; this.bottom = bottom; this.height = height;
    this.data = new Uint8Array(nx * ny * nz);
    this.active = new Int32Array(this.data.length);
    this.cellVolumeMl = new Float64Array(this.data.length);
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
    const inside = h < this.radius ? radial * radial + (h - this.radius) ** 2 < this.radius ** 2
      : radial < this.radius;
    if (!inside) return false;
    for (const obstacle of this.obstacles)
      if (p.distanceToSquared(obstacle.center) < obstacle.radius * obstacle.radius) return false;
    return true;
  }
  surfaceIsWet(p: THREE.Vector3) {
    return p.y >= this.bottom && p.y <= this.bottom + this.height
      && p.dot(this.up) <= this.level;
  }
  setObstacles(obstacles: { center: THREE.Vector3; radius: number }[]) {
    this.obstacles = obstacles;
  }
  update(up: THREE.Vector3, level: number) {
    this.up.copy(up).normalize(); this.level = level;
    this.activeCount = 0;
    const dx = 2 * this.radius / this.nx, dy = this.height / this.ny, dz = 2 * this.radius / this.nz;
    const canonical = this.radius === tubeVessel.innerRadius
      && this.height <= tubeVessel.cavityHeight
      && this.height >= tubeVessel.heightFromVolume(tubeVessel.capacityMl);
    let sampledMl = 0;
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++)
      for (let x = 0; x < this.nx; x++) {
        const i = this.index(x, y, z);
        this.data[i] = this.contains(this.point(x, y, z, this.pointScratch)) ? 1 : 0;
        this.cellVolumeMl[i] = 0;
        if (this.data[i]) {
          this.active[this.activeCount++] = i;
          const box: readonly [number, number, number, number, number, number] = [
            -this.radius + x * dx, -this.radius + (x + 1) * dx,
            y * dy, (y + 1) * dy,
            -this.radius + z * dz, -this.radius + (z + 1) * dz,
          ];
          const fraction = canonical && this.up.y > 0.999999
            ? tubeVessel.cellLiquidFraction(box, level - this.bottom)
            : canonical ? this.tiltedCellFraction(box, level) : 1;
          this.cellVolumeMl[i] = fraction * dx * dy * dz * 1e6;
          sampledMl += this.cellVolumeMl[i];
        }
      }
    // Existing fields store amounts. This physical volume map supplies their
    // concentration denominator without changing any saved or cached amounts.
    this.wetVolumeMl = canonical ? tubeVessel.volumeFromHeight(level - this.bottom) : sampledMl;
    const scale = sampledMl > 0 ? this.wetVolumeMl / sampledMl : 0;
    for (let a = 0; a < this.activeCount; a++) this.cellVolumeMl[this.active[a]] *= scale;
  }

  private tiltedCellFraction(box: readonly [number, number, number, number, number, number], level: number) {
    let wet = 0;
    const n = 3;
    for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) {
      const x = box[0] + (ix + 0.5) / n * (box[1] - box[0]);
      const h = box[2] + (iy + 0.5) / n * (box[3] - box[2]);
      const z = box[4] + (iz + 0.5) / n * (box[5] - box[4]);
      const r2 = h < this.radius ? 2 * this.radius * h - h * h : this.radius * this.radius;
      if (x * x + z * z <= r2 && this.up.x * x + this.up.y * (this.bottom + h) + this.up.z * z <= level) wet++;
    }
    return wet / (n * n * n);
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

export interface RisingBubbleSamples {
  readonly state: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly size: Float32Array;
}
export interface CopperAcidDelivery {
  readonly inlet: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly deliveredMl: number;
}

/** Curl of an analytic vector potential; face samples have no volume source. */
export class VelocityField {
  private readonly result = new Float64Array(3);
  readonly gravityUp = new THREE.Vector3(0, 1, 0);
  heatX = 0;
  heatZ = 0;
  sourceX = 0;
  sourceZ = 0;
  contrast = 0;
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
    // A smaller curl scale bends filaments without a volume source.
    const fx = 11.3 * X - time * 1.37 * motion;
    const fy = 8.7 * Y + time * 0.91 * motion;
    const fz = 10.1 * Z - time * 1.11 * motion;
    const fine = 0.00000012 + heat * 0.000001;
    const fineX = fine * 11.3 / r * Math.cos(fx) * Math.sin(fy) * Math.cos(fz);
    const fineY = fine * 8.7 / h * Math.sin(fx) * Math.cos(fy) * Math.cos(fz);
    const fineZ = -fine * 10.1 / r * Math.sin(fx) * Math.sin(fy) * Math.sin(fz);
    // Two travelling convection rolls are curls of horizontal vector
    // potentials. They bend liquid parcels into neighbouring up/down lanes.
    const roll = 0.00005 + heat * 0.0015;
    const phase1 = 4.2 * X + 2.4 * Z + time * 0.21;
    const phase2 = -2.1 * X + 4.1 * Z - time * 0.17;
    const a1 = roll * r / 4.2, a2 = roll * r / 4.1;
    const rollX = a1 * 5.1 / h * Math.sin(phase1) * Math.cos(5.1 * Y);
    const rollY = -roll * Math.cos(phase1) * Math.sin(5.1 * Y)
      + roll * Math.cos(phase2) * Math.sin(4.4 * Y);
    const rollZ = -a2 * 4.4 / h * Math.sin(phase2) * Math.cos(4.4 * Y);
    // Curl of (Zp, 0, -Xp), with a wandering centre. The broad updraft
    // reaches the copper surface; the return flow runs along the glass.
    const bend = 0.14 + heat * 0.14;
    const phaseX = 1.4 * Y - time * 0.67 * motion;
    const phaseZ = 1.1 * Y + time * 0.51 * motion;
    const anchor = Math.exp(-0.3 * Y);
    const driftX = bend * Math.sin(phaseX) + this.heatX * 0.42;
    const driftZ = bend * Math.cos(phaseZ) + this.heatZ * 0.42;
    const cx = this.sourceX * anchor + driftX * (1 - anchor);
    const cz = this.sourceZ * anchor + driftZ * (1 - anchor);
    const cxY = (1 - anchor) * bend * 1.4 * Math.cos(phaseX) / h
      + 0.3 * anchor * (driftX - this.sourceX) / h;
    const czY = -(1 - anchor) * bend * 1.1 * Math.sin(phaseZ) / h
      + 0.3 * anchor * (driftZ - this.sourceZ) / h;
    const U = X - cx, V = Z - cz, radial2 = U * U + V * V;
    const strength = heat * TUBE_SIMULATION.field.heatConvection + this.contrast * 0.002;
    const plume = strength * Math.exp(-2.0 * radial2);
    const plumeY = plume * 4.0 * (U * cxY + V * czY);
    const accel = this.contributions.acceleration;
    // The rising filament turns sideways at the closed liquid surface.
    // Reverse the source-directed lateral drift there instead of letting
    // colour pile up in a single top voxel row.
    const vx = rollX - 0.8 * dSdy - 0.7 * dSdz - fineY - fineZ - U * plumeY + cxY * plume
      - accel.x * 0.0001 / h;
    const vy = rollY + dSdz + 0.8 * dSdx + fineZ + fineX + plume * (2 - 4.0 * radial2);
    const vz = rollZ + 0.7 * dSdx - dSdy + fineX - fineY - V * plumeY + czY * plume
      + accel.z * 0.0001 / r;
    const g = this.gravityUp;
    this.result[0] = vx + vy * g.x;
    this.result[1] = vy * g.y;
    this.result[2] = vz + vy * g.z;
    return this.result;
  }
}

export class TubeVolumeField {
  private static readonly copperPatches = 10;
  readonly mask: LiquidMask;
  readonly species: Record<string, SpeciesField>;
  readonly velocity: VelocityField;
  readonly flowSolver: TubeFlowSolver;
  previous: THREE.Data3DTexture;
  current: THREE.Data3DTexture;
  readonly reaction: ReactionState = copperReactionState(0);
  private prevPixels: Float32Array;
  private pixels: Float32Array;
  private readonly sources: THREE.Vector3[];
  private readonly sourceCells: number[] = [];
  private sourcePatchWeights = new Float32Array(0);
  private sourcePatchCentres: THREE.Vector3[] = [];
  private sourceReactionWeights = new Float64Array(0);
  private readonly nearest: Int32Array;
  private readonly queue: Int32Array;
  private readonly wake: Float32Array;
  private readonly ambient = new Float64Array(3);
  private injectionDirty = true;
  private readonly injectionPoint = new THREE.Vector3();
  private readonly fallbackSource = new THREE.Vector3();
  private readonly acidInlet = new THREE.Vector3();
  private readonly acidDirection = new THREE.Vector3(0, -1, 0);
  private acidDelivered = 0;
  private acidSeeded = false;
  private jetPending = 0;
  private velocityAge = 0.2;
  private readonly priorUp = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly priorPosition = new THREE.Vector3();
  private readonly positionDelta = new THREE.Vector3();
  private positionReady = false;
  private priorLevel = Infinity;
  private accumulator = 0;
  private time = 0;
  private pending = 0;
  /** Texture-space concentrations derived from the conserved Cu(II) field. */
  meanCopperDensity = 0;
  surfaceCopperDensity = 0;
  private lastProgress = 0;
  private readonly step: number;
  readonly profile = { masks: 0, maskMs: 0, flowMs: 0, copperMs: 0, acidMs: 0, bubblesMs: 0, textureMs: 0, steps: 0, sources: 0, sourceMs: 0 };

  constructor(quality: "LOW" | "MEDIUM" | "HIGH", radius: number, bottom: number, height: number,
    sources: readonly THREE.Vector3[]) {
    const low = quality === "LOW";
    this.step = TUBE_SIMULATION.field.stepSeconds;
    const resolution = low ? TUBE_SIMULATION.field.LOW : TUBE_SIMULATION.field.HIGH;
    this.mask = new LiquidMask(resolution.width, resolution.height, resolution.depth, radius, bottom, height);
    this.species = { "Cu2+": new SpeciesField("Cu2+", this.mask), HNO3: new SpeciesField("HNO3", this.mask) };
    this.velocity = new VelocityField(this.mask);
    this.flowSolver = new TubeFlowSolver(this.mask, { lowDiffusion: true, pressureIterations: 10, eddyFraction: 0.0005, ambientStrength: 0.3 });
    this.sources = sources.map(p => p.clone());
    const n = this.mask.data.length;
    this.wake = new Float32Array(n);
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
  }

  get alpha() { return clamp(this.accumulator / this.step, 0, 1); }
  get copperII() { return this.species["Cu2+"].total; }
  private patchPulse(patch: number) {
    return 0.04 + Math.pow(0.5 + 0.5 * Math.sin(this.time * (1.5 + patch * 0.23)
      + patch * 2.43), 4);
  }
  surfaceActivityAt(point: THREE.Vector3) {
    const width2 = (this.mask.radius * 0.15) ** 2;
    let activity = 0.01;
    for (let patch = 0; patch < this.sourcePatchCentres.length; patch++)
      activity += this.patchPulse(patch)
        * Math.exp(-point.distanceToSquared(this.sourcePatchCentres[patch]) / width2);
    return activity;
  }
  setSources(points: readonly THREE.Vector3[], count = points.length) {
    if (this.sources.length !== count) this.injectionDirty = true;
    const tolerance = Math.min(2 * this.mask.radius / this.mask.nx,
      this.mask.height / this.mask.ny) * 0.25;
    for (let i = 0; i < count; i++) {
      if (!this.sources[i] || this.sources[i].distanceToSquared(points[i]) > tolerance * tolerance)
        this.injectionDirty = true;
    }
    if (this.injectionDirty) for (let i = 0; i < count; i++) {
      if (this.sources[i]) this.sources[i].copy(points[i]);
      else this.sources[i] = points[i].clone();
    }
    this.sources.length = count;
    if (this.injectionDirty) {
      const obstacles: { center: THREE.Vector3; radius: number }[] = [];
      for (let start = 0; start + 24 <= count; start += 24) {
        const center = new THREE.Vector3();
        for (let i = start; i < start + 24; i++) center.add(this.sources[i]);
        center.divideScalar(24);
        let radius = 0;
        for (let i = start; i < start + 24; i++)
          radius = Math.max(radius, center.distanceTo(this.sources[i]));
        obstacles.push({ center, radius: radius * 0.72 });
      }
      this.mask.setObstacles(obstacles);
    }
    if (count > 0) {
      let x = 0, z = 0;
      for (let i = 0; i < count; i++) { x += points[i].x; z += points[i].z; }
      this.velocity.sourceX = x / (count * this.mask.radius);
      this.velocity.sourceZ = z / (count * this.mask.radius);
    }
  }
  /** The controller owns ξ. This only integrates positive increments of its progress. */
  advance(dt: number, progress: number, up: THREE.Vector3, level: number, gasDrive = 0,
    temperature = 0, temperatureField?: TemperatureField, worldPosition?: THREE.Vector3,
    bubbles?: RisingBubbleSamples, bubbleCenter?: THREE.Vector3, acidDelivery?: CopperAcidDelivery) {
    const p = clamp(finite(progress), 0, 1);
    const delta = Math.max(0, p - this.lastProgress);
    this.lastProgress = p;
    this.pending += delta;
    if (acidDelivery) {
      this.acidInlet.copy(acidDelivery.inlet);
      this.acidDirection.copy(acidDelivery.direction).normalize();
    }
    this.velocity.contributions.gas = clamp(finite(gasDrive), 0, 1);
    this.velocity.contributions.buoyancy = clamp(finite(temperatureField?.mean ?? temperature), 0, 1);
    this.flowSolver.options.ambientStrength = 0.2 + this.velocity.contributions.buoyancy * 0.22;
    this.velocity.heatX = temperatureField?.hotX ?? 0;
    this.velocity.heatZ = temperatureField?.hotZ ?? 0;
    this.velocity.contrast = temperatureField?.contrast ?? 0;
    const acceleration = this.velocity.contributions.acceleration;
    acceleration.multiplyScalar(0.85).add(up).sub(this.velocity.gravityUp);
    if (worldPosition) {
      if (this.positionReady && dt > 0)
        acceleration.addScaledVector(this.positionDelta.subVectors(worldPosition, this.priorPosition),
          0.8 / Math.max(0.01, dt));
      this.priorPosition.copy(worldPosition);
      this.positionReady = true;
    }
    acceleration.clampLength(0, 1);
    this.velocity.gravityUp.copy(up);
    this.accumulator = Math.min(this.step * 2, this.accumulator + clamp(finite(dt), 0, 0.25));
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.step && steps++ < 2) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      if (this.injectionDirty || this.priorUp.distanceToSquared(up) > 0.0004 || Math.abs(this.priorLevel - level) > this.mask.height / this.mask.ny * 0.75) {
        const stamp = performance.now();
        this.mask.update(up, level);
        this.flowSolver.refreshMask();
        this.reconcileMask();
        this.injectionDirty = true;
        this.velocityAge = 0.2;
        this.priorUp.copy(up); this.priorLevel = level;
        this.profile.masks++; this.profile.maskMs += performance.now() - stamp;
      }
      this.velocityAge += this.step;
      if (this.velocityAge >= 0.2) {
        const stamp = performance.now();
        this.updateBubbleWake(bubbles, bubbleCenter);
        this.flowSolver.step(this.velocityAge,
          acidDelivery ? this.acidInlet : this.fallbackSource.set(0, this.mask.bottom + this.mask.radius, 0),
          acidDelivery ? this.acidDirection : up, this.jetPending, 0, (x, y, z) => {
            const v = this.velocity.at(x, y, z, this.time);
            const m = this.mask;
            const ix = Math.max(0, Math.min(m.nx - 1, Math.floor((x / m.radius + 1) * m.nx / 2)));
            const iy = Math.max(0, Math.min(m.ny - 1, Math.floor((y - m.bottom) / m.height * m.ny)));
            const iz = Math.max(0, Math.min(m.nz - 1, Math.floor((z / m.radius + 1) * m.nz / 2)));
            const wake = this.wake[m.index(ix, iy, iz)];
            const wakeSpeed = Math.min(0.24, wake * 0.9);
            this.ambient[0] = v[0] * 5 + up.x * wakeSpeed;
            const acid = this.species.HNO3.values[m.index(ix, iy, iz)];
            const acidContrast = Math.min(2, acid * m.activeCount / 4.4);
            this.ambient[1] = v[1] * 5 + up.y * wakeSpeed - acidContrast * 0.007;
            this.ambient[2] = v[2] * 5 + up.z * wakeSpeed;
            return this.ambient;
          }, acidDelivery ? this.mask.height * 0.8 : 0);
        this.jetPending = 0;
        this.velocityAge = 0;
        this.profile.flowMs += performance.now() - stamp;
      }
      const oldTexture = this.previous; this.previous = this.current; this.current = oldTexture;
      const oldPixels = this.prevPixels; this.prevPixels = this.pixels; this.pixels = oldPixels;
      let stamp = performance.now();
      this.flowSolver.transport(this.species["Cu2+"].values, this.step,
        TUBE_SIMULATION.field.baseDiffusivity + this.velocity.contributions.buoyancy * TUBE_SIMULATION.field.heatDiffusivity);
      this.mixCopperFromBubbles();
      this.profile.copperMs += performance.now() - stamp;
      stamp = performance.now();
      this.flowSolver.transport(this.species.HNO3.values, this.step, 0.000008);
      this.profile.acidMs += performance.now() - stamp;
      if (acidDelivery) this.deliverAcid(acidDelivery.deliveredMl);
      else if (!this.acidSeeded) this.seedAcid();
      if (this.acidSeeded) this.relocalizeSeedAcid();
      if (this.pending > 0) this.pending -= this.reactAtCopper(this.pending);
      stamp = performance.now();
      this.writeTexture();
      this.profile.textureMs += performance.now() - stamp;
      this.profile.steps++;
      this.time += this.step;
    }
  }

  private updateBubbleWake(bubbles?: RisingBubbleSamples, center?: THREE.Vector3) {
    this.wake.fill(0);
    if (!bubbles || !center) return;
    const m = this.mask;
    for (let b = 0; b < bubbles.state.length; b++) {
      const state = bubbles.state[b];
      if (state !== 1 && state !== 2) continue;
      const x = Math.floor(((bubbles.x[b] - center.x) / m.radius + 1) * m.nx / 2);
      const y = Math.floor((bubbles.y[b] - m.bottom) / m.height * m.ny);
      const z = Math.floor(((bubbles.z[b] - center.z) / m.radius + 1) * m.nz / 2);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -2; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ix = x + dx, iy = y + dy, iz = z + dz;
          if (ix < 0 || ix >= m.nx || iy < 0 || iy >= m.ny || iz < 0 || iz >= m.nz) continue;
          const i = m.index(ix, iy, iz);
          // Growing attached bubbles displace the adjacent liquid before
          // detachment. A released bubble produces a stronger moving wake.
          if (m.data[i]) this.wake[i] += (state === 1 ? 0.045 : 0.12)
            * Math.exp(-(dx * dx + dz * dz + dy * dy * 0.5));
        }
    }
  }

  private reconcileMask() {
    const mask = this.mask;
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
    for (const field of Object.values(this.species)) {
      const values = field.values;
      for (let i = 0; i < values.length; i++) {
        if (mask.data[i] || values[i] === 0) continue;
        const target = nearest[i];
        if (target >= 0) values[target] += values[i];
        values[i] = 0;
      }
    }
  }

  private nearestWet(point: THREE.Vector3) {
    const m = this.mask;
    const x = clamp(Math.floor((point.x / m.radius + 1) * m.nx / 2), 0, m.nx - 1);
    const y = clamp(Math.floor((point.y - m.bottom) / m.height * m.ny), 0, m.ny - 1);
    const z = clamp(Math.floor((point.z / m.radius + 1) * m.nz / 2), 0, m.nz - 1);
    return this.nearest[m.index(x, y, z)];
  }

  private rebuildSourceCells() {
    if (!this.injectionDirty) return;
    const stamp = performance.now();
    this.sourceCells.length = 0;
    const seen = new Set<number>();
    const m = this.mask;
    const cell = Math.min(2 * m.radius / m.nx, m.height / m.ny);
    for (let start = 0; start < this.sources.length; start += 24) {
      const end = Math.min(start + 24, this.sources.length);
      const centre = new THREE.Vector3();
      for (let s = start; s < end; s++) centre.add(this.sources[s]);
      centre.divideScalar(end - start);
      for (let s = start; s < end; s++) {
        const surface = this.sources[s];
        if (!m.surfaceIsWet(surface)) continue;
        const outward = surface.clone().sub(centre).normalize();
        const adjacent = surface.clone().addScaledVector(outward, cell * 0.6);
        const i = this.nearestWet(adjacent);
        if (i < 0) continue;
        const ix = i % m.nx, iy = Math.floor(i / m.nx) % m.ny;
        const iz = Math.floor(i / (m.nx * m.ny));
        for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0],
          [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const x = ix + dx, y = iy + dy, z = iz + dz;
          if (x < 0 || x >= m.nx || y < 0 || y >= m.ny || z < 0 || z >= m.nz) continue;
          const cellIndex = m.index(x, y, z);
          if (!m.data[cellIndex] || seen.has(cellIndex)) continue;
          const point = m.point(x, y, z, this.injectionPoint);
          if (point.distanceToSquared(surface) > (cell * 1.25) ** 2) continue;
          if (end - start >= 4 && point.clone().sub(centre).dot(outward)
            < surface.clone().sub(centre).dot(outward) - cell * 0.1) continue;
          seen.add(cellIndex); this.sourceCells.push(cellIndex);
        }
      }
    }
    this.sourcePatchWeights = new Float32Array(this.sourceCells.length * TubeVolumeField.copperPatches);
    this.sourceReactionWeights = new Float64Array(this.sourceCells.length);
    if (!this.sourceCells.length) {
      this.sourcePatchCentres = [];
      this.injectionDirty = false;
      return;
    }
    // Surface chemistry is patchy in 3D. Patch centres come from actual wet
    // copper-adjacent cells, so none are tied to the camera or rear wall.
    const surface = this.sourceCells.map(i => m.point(i % m.nx,
      Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny))));
    const meanY = surface.reduce((sum, point) => sum + point.y, 0) / surface.length;
    const exposed = surface.filter(point => point.y >= meanY - m.radius * 0.12);
    const candidates = exposed.length >= TubeVolumeField.copperPatches ? exposed : surface;
    const centres: THREE.Vector3[] = [candidates[Math.floor(candidates.length * 0.17)]];
    while (centres.length < Math.min(TubeVolumeField.copperPatches, candidates.length)) {
      let best = candidates[0], spread = -1;
      for (const point of candidates) {
        const distance = Math.min(...centres.map(centre => point.distanceToSquared(centre)));
        if (distance > spread) { best = point; spread = distance; }
      }
      centres.push(best);
    }
    this.sourcePatchCentres = centres;
    const width = m.radius * 0.15;
    for (let s = 0; s < this.sourceCells.length; s++) {
      const i = this.sourceCells[s];
      const point = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny,
        Math.floor(i / (m.nx * m.ny)), this.injectionPoint);
      for (let patch = 0; patch < centres.length; patch++) {
        const distance2 = point.distanceToSquared(centres[patch]);
        this.sourcePatchWeights[s * TubeVolumeField.copperPatches + patch] = Math.exp(-distance2 / (width * width));
      }
    }
    this.injectionDirty = false;
    this.profile.sources++; this.profile.sourceMs += performance.now() - stamp;
  }

  private seedAcid() {
    this.acidSeeded = true;
    this.rebuildSourceCells();
    const sites = this.sourceCells;
    if (!sites.length) return;
    const values = this.species.HNO3.values;
    for (const i of sites) values[i] += 4.4 / sites.length;
  }

  /** Standalone field tests without a pour start with acid already wetting copper. */
  private relocalizeSeedAcid() {
    this.rebuildSourceCells();
    if (!this.sourceCells.length) return;
    const values = this.species.HNO3.values;
    let total = 0;
    for (const value of values) total += value;
    values.fill(0);
    for (const i of this.sourceCells) values[i] = total / this.sourceCells.length;
  }

  private deliverAcid(deliveredMl: number) {
    const total = clamp(finite(deliveredMl), 0, 1);
    const delta = Math.max(0, total - this.acidDelivered);
    if (!delta) return;
    this.acidDelivered = total;
    this.jetPending += 2 * delta;
    const m = this.mask, values = this.species.HNO3.values;
    // This is a pour into an otherwise dry copper tube. The stream strikes
    // the wall above the numerical liquid surface, then drains to the metal.
    // Depositing everything at the inlet left almost no acid in the copper's
    // source cells for the entire cold observation, despite a full 1 ml pour.
    this.rebuildSourceCells();
    const wetting = this.sourceCells.length ? 0.78 : 0;
    if (wetting) {
      let low = Infinity, high = -Infinity;
      for (const i of this.sourceCells) {
        const y = Math.floor(i / m.nx) % m.ny;
        low = Math.min(low, y); high = Math.max(high, y);
      }
      let weightSum = 0;
      const sourceWeights = this.sourceCells.map(i => {
        const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
        const z = Math.floor(i / (m.nx * m.ny));
        // All wetted faces emit Cu(II). The upper face gets more acid and
        // slight azimuthal variation breaks a symmetric halo.
        const upper = (y - low) / Math.max(1, high - low);
        const weight = (0.45 + 1.6 * upper) *
          (0.8 + 0.2 * Math.sin(x * 2.17 + z * 1.31));
        weightSum += weight;
        return weight;
      });
      for (let n = 0; n < this.sourceCells.length; n++)
        values[this.sourceCells[n]] += 4.4 * delta * wetting * sourceWeights[n] / weightSum;
    }
    const dx = 2 * m.radius / m.nx, dy = m.height / m.ny;
    const weights = new Float64Array(m.data.length);
    let sum = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const point = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny,
        Math.floor(i / (m.nx * m.ny)), this.injectionPoint);
      const r2 = ((point.x - this.acidInlet.x) / (1.5 * dx)) ** 2
        + ((point.y - this.acidInlet.y) / (2 * dy)) ** 2
        + ((point.z - this.acidInlet.z) / (1.5 * dx)) ** 2;
      const w = Math.exp(-r2);
      weights[i] = w; sum += w;
    }
    if (sum > 1e-12) for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a]; values[i] += 4.4 * delta * (1 - wetting) * weights[i] / sum;
    }
    else {
      const i = this.nearestWet(this.acidInlet);
      if (i >= 0) values[i] += 4.4 * delta * (1 - wetting);
    }
  }

  private reactAtCopper(requested: number) {
    this.rebuildSourceCells();
    const acid = this.species.HNO3.values;
    const threshold = 0.000001;
    let available = 0;
    for (const i of this.sourceCells) if (acid[i] > threshold) available += acid[i];
    const d = Math.min(requested, this.reaction.copper / 1.65,
      this.reaction.acid / 4.4, available / 4.4);
    if (!(d > 0)) return 0;
    const copper = this.species["Cu2+"].values;
    // Irregular wet surface patches pulse independently, with one normalized
    // Cu(II) budget. Activity changes position without creating extra mass.
    const weights = this.sourceReactionWeights;
    const pulses = Array.from({ length: TubeVolumeField.copperPatches }, (_, patch) => this.patchPulse(patch));
    let weightSum = 0;
    for (let s = 0; s < this.sourceCells.length; s++) {
      let patch = 0;
      for (let active = 0; active < this.sourcePatchCentres.length; active++)
        patch += this.sourcePatchWeights[s * TubeVolumeField.copperPatches + active] * pulses[active];
      // Concentrate a fixed Cu(II) budget in the currently active wet patches.
      // A linear blend across all surface cells smears late sources into a halo.
      weights[s] = 0.002 + patch * patch;
      weightSum += weights[s];
    }
    for (let s = 0; s < this.sourceCells.length; s++) {
      const i = this.sourceCells[s];
      if (acid[i] <= threshold) continue;
      const fraction = acid[i] / available;
      acid[i] -= 4.4 * d * fraction;
    }
    for (let s = 0; s < this.sourceCells.length; s++)
      copper[this.sourceCells[s]] += 1.65 * d * weights[s] / weightSum;
    Object.assign(this.reaction, copperReactionState(this.reaction.extent + d));
    return d;
  }

  private mixCopperFromBubbles() {
    // Unresolved bubble-driven circulation exchanges old liquid throughout
    // the tube. It acts on conserved Cu(II), while fresh narrow plumes are
    // injected at the copper after transport.
    const values = this.species["Cu2+"].values;
    const active = this.mask.active;
    const count = this.mask.activeCount;
    if (!count || this.velocity.contributions.bubbles <= 0) return;
    let total = 0;
    for (let a = 0; a < count; a++) total += values[active[a]];
    const mean = total / count;
    const fraction = 1 - Math.exp(-this.step * 0.11 * this.velocity.contributions.bubbles);
    for (let a = 0; a < count; a++) {
      const i = active[a];
      values[i] += fraction * (mean - values[i]);
    }
  }

  private writeTexture() {
    const m = this.mask, v = this.species["Cu2+"].values;
    // Normalize by a whole-tube amount, not by max voxel, so hue preserves mass.
    const scale = m.data.length * TUBE_SIMULATION.field.opticalDensityScale;
    let bulk = 0, surface = 0, surfaceCells = 0;
    let topRow = -1;
    for (let a = 0; a < m.activeCount; a++)
      topRow = Math.max(topRow, Math.floor(m.active[a] / m.nx) % m.ny);
    for (let i = 0; i < v.length; i++) {
      if (!m.data[i]) { this.pixels[i] = 0; continue; }
      this.pixels[i] = Math.max(0, finite(v[i]) * scale);
      bulk += this.pixels[i];
      if (Math.floor(i / m.nx) % m.ny >= topRow - 2) {
        surface += this.pixels[i]; surfaceCells++;
      }
    }
    this.meanCopperDensity = bulk / Math.max(1, m.activeCount);
    this.surfaceCopperDensity = surface / Math.max(1, surfaceCells);
    this.current.needsUpdate = true;
  }
  dispose() { this.previous.dispose(); this.current.dispose(); }
}



