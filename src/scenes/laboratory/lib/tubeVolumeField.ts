import * as THREE from "three";
import { copperReactionState, type CopperReactionState } from "./tubeReactions";
import type { TemperatureField } from "./tubeTemperatureField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { TubeFlowSolver } from "./tubeFlowSolver";

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
  private obstacles: { center: THREE.Vector3; radius: number }[] = [];
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
    const inside = h < this.radius ? radial * radial + (h - this.radius) ** 2 < this.radius ** 2
      : radial < this.radius;
    if (!inside) return false;
    for (const obstacle of this.obstacles)
      if (p.distanceToSquared(obstacle.center) < obstacle.radius * obstacle.radius) return false;
    return true;
  }
  setObstacles(obstacles: { center: THREE.Vector3; radius: number }[]) {
    this.obstacles = obstacles;
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
    const roll = 0.00005 + heat * 0.0015 + this.contributions.bubbles * 0.00028
      + this.contributions.gas * 0.00012;
    const phase1 = 4.2 * X + 2.4 * Z + time * 0.21;
    const phase2 = -2.1 * X + 4.1 * Z - time * 0.17;
    const a1 = roll * r / 4.2, a2 = roll * r / 4.1;
    const rollX = a1 * 5.1 / h * Math.sin(phase1) * Math.cos(5.1 * Y);
    const rollY = -roll * Math.cos(phase1) * Math.sin(5.1 * Y)
      + roll * Math.cos(phase2) * Math.sin(4.4 * Y);
    const rollZ = -a2 * 4.4 / h * Math.sin(phase2) * Math.cos(4.4 * Y);
    // Smaller convection cells split the broad rise into moving up and down
    // lanes. Their curl transports the concentration rather than drawing it.
    const lanes = heat * 0.0018 + this.contributions.bubbles * 0.0006;
    const lane1 = 8.0 * X - 0.6 * Z - time * 0.43 * motion;
    const lane2 = 0.5 * X + 8.4 * Z + time * 0.31 * motion;
    const laneX = lanes * r / h * 3.7 / 8.0 * Math.sin(lane1) * Math.cos(3.7 * Y);
    const laneY = -lanes * (Math.cos(lane1) * Math.sin(3.7 * Y)
      + Math.cos(lane2) * Math.sin(3.2 * Y));
    const laneZ = lanes * r / h * 3.2 / 8.4 * Math.sin(lane2) * Math.cos(3.2 * Y);
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
    const vx = rollX + laneX - 0.8 * dSdy - 0.7 * dSdz - fineY - fineZ - U * plumeY + cxY * plume
      - accel.x * 0.0001 / h;
    const vy = rollY + laneY + dSdz + 0.8 * dSdx + fineZ + fineX + plume * (2 - 4.0 * radial2);
    const vz = rollZ + laneZ + 0.7 * dSdx - dSdy + fineX - fineY - V * plumeY + czY * plume
      + accel.z * 0.0001 / r;
    const g = this.gravityUp;
    this.result[0] = vx + vy * g.x;
    this.result[1] = vy * g.y;
    this.result[2] = vz + vy * g.z;
    return this.result;
  }
}

export class TubeVolumeField {
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
  private readonly nearest: Int32Array;
  private readonly queue: Int32Array;
  private readonly wake: Float32Array;
  private readonly wakeCargo: Float64Array;
  private readonly wakeCell: Int32Array;
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
    this.flowSolver = new TubeFlowSolver(this.mask, { lowDiffusion: true, pressureIterations: 10, eddyFraction: 0.002, ambientStrength: 0.2 });
    this.sources = sources.map(p => p.clone());
    const n = this.mask.data.length;
    this.wake = new Float32Array(n);
    this.wakeCargo = new Float64Array(384);
    this.wakeCell = new Int32Array(384); this.wakeCell.fill(-1);
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
            const wakeSpeed = Math.min(0.0035, wake * 0.0015);
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
      this.profile.copperMs += performance.now() - stamp;
      stamp = performance.now();
      this.advectBubbleCargo(bubbles, bubbleCenter);
      this.profile.bubblesMs += performance.now() - stamp;
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
      if (bubbles.state[b] !== 2) continue;
      const x = Math.floor(((bubbles.x[b] - center.x) / m.radius + 1) * m.nx / 2);
      const y = Math.floor((bubbles.y[b] - m.bottom) / m.height * m.ny);
      const z = Math.floor(((bubbles.z[b] - center.z) / m.radius + 1) * m.nz / 2);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -2; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ix = x + dx, iy = y + dy, iz = z + dz;
          if (ix < 0 || ix >= m.nx || iy < 0 || iy >= m.ny || iz < 0 || iz >= m.nz) continue;
          const i = m.index(ix, iy, iz);
          if (m.data[i]) this.wake[i] += 0.12 * Math.exp(-(dx * dx + dz * dz + dy * dy * 0.5));
        }
    }
  }

  /** Resolved bubbles carry a small local parcel; every transfer stays inside the Cu field. */
  private advectBubbleCargo(bubbles?: RisingBubbleSamples, center?: THREE.Vector3) {
    if (!bubbles || !center) return;
    const values = this.species["Cu2+"].values;
    const m = this.mask;
    this.rebuildSourceCells();
    for (let b = 0; b < Math.min(bubbles.state.length, this.wakeCell.length); b++) {
      if (bubbles.state[b] !== 2) {
        this.wakeCell[b] = -1; this.wakeCargo[b] = 0;
        continue;
      }
      const x = bubbles.x[b] - center.x, y = bubbles.y[b], z = bubbles.z[b] - center.z;
      const ix = Math.max(0, Math.min(m.nx - 1, Math.floor((x / m.radius + 1) * m.nx / 2)));
      const iy = Math.max(0, Math.min(m.ny - 1, Math.floor((y - m.bottom) / m.height * m.ny)));
      const iz = Math.max(0, Math.min(m.nz - 1, Math.floor((z / m.radius + 1) * m.nz / 2)));
      const raw = m.index(ix, iy, iz);
      const target = m.data[raw] ? raw : this.nearestWet(this.injectionPoint.set(x, y, z));
      if (target < 0) continue;
      const prior = this.wakeCell[b];
      if (prior < 0) {
        let source = -1, distance = Infinity;
        for (const i of this.sourceCells) {
          const p = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny,
            Math.floor(i / (m.nx * m.ny)), this.injectionPoint);
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < distance && values[i] > 0) { distance = d; source = i; }
        }
        if (source < 0) continue;
        const sx = source % m.nx, sy = Math.floor(source / m.nx) % m.ny;
        const sz = Math.floor(source / (m.nx * m.ny));
        let separation = Infinity;
        for (let other = 0; other < Math.min(bubbles.state.length, this.wakeCargo.length); other++) {
          if (other === b || bubbles.state[other] !== 2 || this.wakeCargo[other] <= 1e-6) continue;
          separation = Math.min(separation, Math.hypot(bubbles.x[other] - bubbles.x[b],
            bubbles.z[other] - bubbles.z[b]));
        }
        const distinctWake = Math.min(1, separation / (3 * m.radius / m.nx));
        const capacity = Math.min(0.01, 0.01 * (bubbles.size[b] / (m.radius * 0.13)) ** 3)
          * distinctWake;
        let pickup = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const px = sx + dx, py = sy + dy, pz = sz + dz;
            if (px < 0 || px >= m.nx || py < 0 || py >= m.ny || pz < 0 || pz >= m.nz) continue;
            const parcel = m.index(px, py, pz);
            if (!m.data[parcel] || pickup >= capacity) continue;
            const moved = Math.min(capacity - pickup, values[parcel] * 0.32);
            values[parcel] -= moved; pickup += moved;
          }
        values[target] += pickup;
        this.wakeCargo[b] = pickup; this.wakeCell[b] = target;
      } else {
        const move = Math.min(values[prior], this.wakeCargo[b]) * 0.91;
        values[prior] -= move; values[target] += move;
        this.wakeCargo[b] = move; this.wakeCell[b] = target;
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
    let nearest = -1, distance = Infinity;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const d = m.point(i % m.nx, Math.floor(i / m.nx) % m.ny,
        Math.floor(i / (m.nx * m.ny)), this.injectionPoint).distanceToSquared(point);
      if (d < distance) { distance = d; nearest = i; }
    }
    return nearest;
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
        const outward = this.injectionPoint.subVectors(surface, centre).normalize();
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
          seen.add(cellIndex); this.sourceCells.push(cellIndex);
        }
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
      const i = m.active[a]; values[i] += 4.4 * delta * weights[i] / sum;
    }
    else {
      const i = this.nearestWet(this.acidInlet);
      if (i >= 0) values[i] += 4.4 * delta;
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
    for (const i of this.sourceCells) {
      if (acid[i] <= threshold) continue;
      const fraction = acid[i] / available;
      acid[i] -= 4.4 * d * fraction;
      copper[i] += 1.65 * d * fraction;
    }
    Object.assign(this.reaction, copperReactionState(this.reaction.extent + d));
    return d;
  }

  private writeTexture() {
    const m = this.mask, v = this.species["Cu2+"].values;
    // Normalize by a whole-tube amount, not by max voxel, so hue preserves mass.
    const scale = m.data.length * TUBE_SIMULATION.field.opticalDensityScale;
    for (let i = 0; i < v.length; i++) {
      if (!m.data[i]) { this.pixels[i] = 0; continue; }
      this.pixels[i] = Math.max(0, finite(v[i]) * scale);
    }
    this.current.needsUpdate = true;
  }
  dispose() { this.previous.dispose(); this.current.dispose(); }
}



