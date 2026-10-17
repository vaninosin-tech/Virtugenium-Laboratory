import * as THREE from "three";
import { LiquidMask } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";
import { TubeJetModel, type SilverJetOptions } from "./tubeJetModel";

/** Closed, staggered 3D liquid flow. A face exists only between two wet cells. */
/** Parameters of the surface-spreading closure of a plunging jet (SI units). */
export interface SurfaceSpread { x: number; z: number; level: number; flow: number; alpha: number; delta: number; r0: number; relaxation: number; }

export class TubeFlowSolver {
  readonly flow: Float32Array;
  lastStepMs = 0;
  private readonly stepTimes = new Float32Array(32);
  private stepSamples = 0;
  private readonly faces = [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
  private readonly previousFaces: Float32Array[];
  private readonly pressure: Float32Array;
  private readonly divergence: Float32Array;
  private readonly scratch = new THREE.Vector3();
  private readonly spacing: number[];
  private readonly inverseSpacingSquared: number[];
  private readonly stride: number[];
  private readonly outgoing: Float64Array;
  private readonly flux: Float64Array;
  private readonly next: Float64Array;
  private readonly adjacent: Int32Array[];
  private readonly pressureWeight: Float32Array;
  private readonly eddy: Float32Array;
  private readonly direction = new THREE.Vector3();
  private jetModel?: TubeJetModel;
  readonly lastStrain: Float32Array;
  readonly lastVorticity: Float32Array;
  lastJetMomentumSource: readonly number[] = [0, 0, 0];
  lastEntrainmentFlux = 0;
  lastJetPenetration = 0;
  lastJetClippedMomentum = 0;
  lastJetProjectionChange: readonly number[] = [0, 0, 0];
  constructor(readonly mask: LiquidMask, readonly options: { lowDiffusion?: boolean; pressureIterations?: number; eddyFraction?: number; ambientStrength?: number } = {}) {
    const n = mask.data.length;
    for (let axis = 0; axis < 3; axis++) this.faces[axis] = new Float32Array(n);
    this.previousFaces = Array.from({ length: 3 }, () => new Float32Array(n));
    this.flow = new Float32Array(n * 3);
    this.lastStrain = new Float32Array(n);
    this.lastVorticity = new Float32Array(n);
    this.pressure = new Float32Array(n);
    this.divergence = new Float32Array(n);
    this.outgoing = new Float64Array(n); this.flux = new Float64Array(n * 3);
    this.next = new Float64Array(n);
    this.adjacent = Array.from({ length: 6 }, () => new Int32Array(n));
    this.pressureWeight = new Float32Array(n);
    this.eddy = new Float32Array(n);
    this.spacing = [2 * mask.radius / mask.nx, mask.height / mask.ny, 2 * mask.radius / mask.nz];
    this.inverseSpacingSquared = this.spacing.map(s => 1 / (s * s));
    this.stride = [1, mask.nx, mask.nx * mask.ny];
    this.refreshMask();
  }
  refreshMask() {
    const m = this.mask;
    for (const neighbors of this.adjacent) neighbors.fill(-1);
    this.pressureWeight.fill(0);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
        const c = axis === 0 ? x : axis === 1 ? y : z;
        const limit = axis === 0 ? m.nx : axis === 1 ? m.ny : m.nz;
        const j = i + sign * this.stride[axis];
        if (c + sign < 0 || c + sign >= limit || !m.data[j]) continue;
        this.adjacent[axis * 2 + (sign > 0 ? 1 : 0)][i] = j;
        this.pressureWeight[i] += this.inverseSpacingSquared[axis];
      }
    }
    for (let axis = 0; axis < 3; axis++) for (let i = 0; i < m.data.length; i++)
      if (this.adjacent[axis * 2 + 1][i] < 0) this.faces[axis][i] = 0;
  }
  /**
   * First-order closure: u_r(r,z) = alpha*Q/(2*pi*r*delta) * [1 - exp(-(r/r0)^2)] * exp(-z/delta) outward from the
   * impact point, acting as a relaxation of the horizontal face velocity towards u_r (a momentum correction, not a
   * second inflow). The projection that follows removes the divergence, so volume is preserved.
   */
  private surfaceSpreadTerm(s: SurfaceSpread, p: THREE.Vector3, axis: number, v: number, dt: number) {
    const depth = s.level - p.y;
    if (depth < -1e-9 || depth > 4 * s.delta) return 0;
    const rx = p.x - s.x, rz = p.z - s.z, r = Math.hypot(rx, rz);
    if (r < 1e-6) return 0;
    const ur = s.alpha * s.flow / (2 * Math.PI * r * s.delta)
      * (1 - Math.exp(-((r / s.r0) ** 2))) * Math.exp(-Math.max(0, depth) / s.delta);
    const target = ur * (axis === 0 ? rx : rz) / r;
    return (target - v) * Math.min(1, s.relaxation * dt);
  }
  private neighbor(i: number, axis: number, sign: number) {
    return this.adjacent[axis * 2 + (sign > 0 ? 1 : 0)][i];
  }
  /** Adds momentum at the impact only, then transports, damps and projects the entire velocity. */
  step(dt: number, inlet: THREE.Vector3, direction: THREE.Vector3, impulse: number,
    agitation = 0, background?: (x: number, y: number, z: number) => ArrayLike<number>,
    jetReach = 0, load?: { values: Float64Array; scale: number; down: THREE.Vector3 },
    surface?: SurfaceSpread) {
    const started = typeof performance !== "undefined" ? performance.now() : 0;
    const m = this.mask, old = this.previousFaces;
    const flag = (globalThis as { __silverJetModel?: boolean | SilverJetOptions }).__silverJetModel;
    const jet = flag && surface ? (this.jetModel ??= new TubeJetModel(m)) : undefined;
    this.lastJetMomentumSource = [0, 0, 0];
    this.lastEntrainmentFlux = 0;
    this.lastJetPenetration = 0;
    this.lastJetClippedMomentum = 0;
    this.lastJetProjectionChange = [0, 0, 0];
    if (jet && surface) {
      jet.prepare(dt, inlet, direction, surface, typeof flag === "object" ? flag : {});
      this.lastJetMomentumSource = Array.from(jet.appliedMomentum);
      this.lastEntrainmentFlux = jet.entrainmentFlux;
      this.lastJetPenetration = jet.penetration;
    }
    for (let axis = 0; axis < 3; axis++) old[axis].set(this.faces[axis]);
    const d = this.direction.copy(direction).normalize();
    const width2 = (m.radius * 0.32) ** 2;
    const damp = Math.exp(-dt * (TUBE_SIMULATION.jetFlow.viscousDamping + agitation * 0.2));
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      const p = m.point(x, y, z, this.scratch);
      const dx = p.x - inlet.x, dy = p.y - inlet.y, dz = p.z - inlet.z;
      const along = dx * d.x + dy * d.y + dz * d.z;
      const distance2 = dx * dx + dy * dy + dz * dz;
      const radial2 = Math.max(0, distance2 - along * along);
      const source = jetReach > 0
        ? Math.exp(-radial2 / width2) * Math.exp(-Math.max(0, along) / jetReach)
          * (along >= -m.radius * 0.15 ? impulse : 0)
        : Math.exp(-distance2 / width2) * impulse;
      const ambient = background?.(p.x, p.y, p.z);
      for (let axis = 0; axis < 3; axis++) {
        const j = this.neighbor(i, axis, 1);
        if (j < 0) { this.faces[axis][i] = 0; continue; }
        // Local transport of momentum by the previous face field.
        const v = old[axis][i];
        let advected = v;
        for (let b = 0; b < 3; b++) {
          const speed = this.flow[i * 3 + b];
          const upstream = this.neighbor(i, b, speed >= 0 ? -1 : 1);
          const fraction = Math.min(0.1, Math.abs(speed) * dt / this.spacing[b]);
          if (upstream >= 0) advected += fraction * (old[axis][upstream] - v);
        }
        let laplace = 0;
        for (let b = 0; b < 3; b++) {
          const prev = this.neighbor(i, b, -1), next = this.neighbor(i, b, 1);
          laplace += ((prev >= 0 ? old[axis][prev] : v)
            + (next >= 0 ? old[axis][next] : v) - 2 * v) * this.inverseSpacingSquared[b];
        }
        const rawFace = (advected + dt * TUBE_SIMULATION.jetFlow.molecularDiffusivity * laplace) * damp
          + (jet ? jet.source[3 * i + axis] : source * d.getComponent(axis))
          // Heavy suspended solid loads the liquid: a body force along gravity.
          + (load ? dt * load.scale * 0.5 * (load.values[i] + load.values[j]) * load.down.getComponent(axis) : 0)
          + (ambient?.[axis] ?? 0) * dt * (this.options.ambientStrength ?? 0.15)
          // Near-surface outward spreading of a plunging jet; the pressure projection below keeps it incompressible.
          + (surface && !jet && axis !== 1 ? this.surfaceSpreadTerm(surface, p, axis, v, dt) : 0);
        this.faces[axis][i] = Math.max(-0.09, Math.min(0.09, rawFace));
        if (jet) this.lastJetClippedMomentum += Math.abs(rawFace - this.faces[axis][i])
          * 1000 * this.spacing[0] * this.spacing[1] * this.spacing[2] / dt;
      }
    }
    let pre: number[] | undefined;
    if (jet) pre = this.totalFaceMomentum(dt);
    if (jet) this.project(300);
    else if (flag && this.jetModel) this.project(30);
    else this.project();
    if (jet && pre) {
      const post = this.totalFaceMomentum(dt);
      this.lastJetProjectionChange = post.map((v, axis) => v - pre![axis]);
    }
    if (flag || (globalThis as { __silverDiag?: unknown }).__silverDiag === "tracer") this.measureJetGradients();
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      this.eddy[i] = TUBE_SIMULATION.jetFlow.eddyDiffusivity * Math.min(1, Math.hypot(
        this.flow[i * 3], this.flow[i * 3 + 1], this.flow[i * 3 + 2]) / 0.005);
    }
    if (started) {
      this.lastStepMs = performance.now() - started;
      this.stepTimes[this.stepSamples++ % this.stepTimes.length] = this.lastStepMs;
    }
  }
  private totalFaceMomentum(dt: number) {
    const result = [0, 0, 0], m = this.mask;
    const factor = 1000 * this.spacing[0] * this.spacing[1] * this.spacing[2] / dt;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      for (let k = 0; k < 3; k++) if (this.neighbor(i, k, 1) >= 0)
        result[k] += this.faces[k][i] * factor;
    }
    return result;
  }
  private measureJetGradients() {
    const m = this.mask;
    this.lastStrain.fill(0); this.lastVorticity.fill(0);
    const g = new Float64Array(9);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      g.fill(0);
      for (let axis = 0; axis < 3; axis++) {
        const l = this.neighbor(i, axis, -1), r = this.neighbor(i, axis, 1);
        if (l < 0 && r < 0) continue;
        const h = this.spacing[axis] * (l >= 0 && r >= 0 ? 2 : 1);
        for (let component = 0; component < 3; component++)
          g[component * 3 + axis] = (this.flow[3 * (r >= 0 ? r : i) + component]
            - this.flow[3 * (l >= 0 ? l : i) + component]) / h;
      }
      let strain2 = 0;
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
        const s = 0.5 * (g[3 * j + k] + g[3 * k + j]);
        strain2 += 2 * s * s;
      }
      this.lastStrain[i] = Math.sqrt(strain2);
      this.lastVorticity[i] = Math.hypot(g[7] - g[5], g[2] - g[6], g[3] - g[1]);
    }
  }
  private project(iterations?: number) {
    const m = this.mask;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a]; let div = 0;
      for (let axis = 0; axis < 3; axis++) {
        const plus = this.neighbor(i, axis, 1), minus = this.neighbor(i, axis, -1);
        div += ((plus >= 0 ? this.faces[axis][i] : 0)
          - (minus >= 0 ? this.faces[axis][minus] : 0)) / this.spacing[axis];
      }
      this.divergence[i] = div;
    }
    const p = this.pressure;
    p.fill(0);
    for (let iteration = 0; iteration < (iterations ?? this.options.pressureIterations ?? TUBE_SIMULATION.jetFlow.pressureIterations); iteration++) {
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a]; let sum = 0;
        for (let axis = 0; axis < 3; axis++) {
          const left = this.adjacent[axis * 2][i], right = this.adjacent[axis * 2 + 1][i];
          const w = this.inverseSpacingSquared[axis];
          if (left >= 0) sum += p[left] * w;
          if (right >= 0) sum += p[right] * w;
        }
        const target = this.pressureWeight[i] ? (sum - this.divergence[i]) / this.pressureWeight[i] : 0;
        p[i] += (iterations ? 1.65 : 1) * (target - p[i]);
      }
    }
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      for (let axis = 0; axis < 3; axis++) {
        const j = this.neighbor(i, axis, 1);
        if (j >= 0) this.faces[axis][i] -= (p[j] - p[i]) / this.spacing[axis];
        const minus = this.neighbor(i, axis, -1);
        this.flow[i * 3 + axis] = ((j >= 0 ? this.faces[axis][i] : 0)
          + (minus >= 0 ? this.faces[axis][minus] : 0)) * 0.5;
      }
    }
  }
  transport(values: Float64Array, dt: number, diffusivity: number, eddyScale?: number) {
    const m = this.mask;
    this.next.set(values); this.outgoing.fill(0); this.flux.fill(0);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      for (let axis = 0; axis < 3; axis++) {
        const j = this.neighbor(i, axis, 1);
        if (j < 0) continue;
        const f = this.faces[axis][i] * dt / this.spacing[axis];
        // Six wet faces may export from one cell; keep explicit diffusion below its CFL limit.
        const mixing = Math.min(0.12, (diffusivity
          + this.eddy[i] * (eddyScale ?? this.options.eddyFraction ?? (this.options.lowDiffusion ? 0.02 : 1))) * dt / this.spacing[axis] ** 2);
        let donorValue = f >= 0 ? values[i] : values[j];
        if (this.options.lowDiffusion) {
          const donor = f >= 0 ? i : j;
          const upstream = this.neighbor(donor, axis, f >= 0 ? -1 : 1);
          const downstream = this.neighbor(donor, axis, f >= 0 ? 1 : -1);
          if (upstream >= 0 && downstream >= 0) {
            const left = donorValue - values[upstream];
            const right = values[downstream] - donorValue;
            const slope = left * right > 0 ? Math.sign(left) * Math.min(Math.abs(left), Math.abs(right)) : 0;
            donorValue = Math.max(0, donorValue + 0.5 * (1 - Math.min(1, Math.abs(f))) * slope);
          }
        }
        const raw = donorValue * f + (values[i] - values[j]) * mixing;
        this.flux[i * 3 + axis] = raw;
        this.outgoing[raw >= 0 ? i : j] += Math.abs(raw);
      }
    }
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      for (let axis = 0; axis < 3; axis++) {
        const j = this.neighbor(i, axis, 1);
        if (j < 0) continue;
        const raw = this.flux[i * 3 + axis], donor = raw >= 0 ? i : j;
        const amount = raw * Math.min(1, values[donor] / Math.max(1e-30, this.outgoing[donor]));
        this.next[i] -= amount; this.next[j] += amount;
      }
    }
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      values[i] = Math.max(0, this.next[i]);
    }
  }
  diagnostics() {
    let energy = 0, moving = 0, divergence = 0;
    const m = this.mask;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a]; let squared = 0, div = 0;
      for (let axis = 0; axis < 3; axis++) {
        squared += this.flow[i * 3 + axis] ** 2;
        const plus = this.neighbor(i, axis, 1), minus = this.neighbor(i, axis, -1);
        div += ((plus >= 0 ? this.faces[axis][i] : 0)
          - (minus >= 0 ? this.faces[axis][minus] : 0)) / this.spacing[axis];
      }
      energy += squared; if (squared > 1e-12) moving++;
      divergence += Math.abs(div);
    }
    const count = Math.min(this.stepSamples, this.stepTimes.length);
    const sorted = Array.from(this.stepTimes.slice(0, count)).sort((a, b) => a - b);
    return { energy, movingFraction: moving / Math.max(1, m.activeCount),
      meanAbsDivergence: divergence / Math.max(1, m.activeCount), stepMs: this.lastStepMs,
      medianStepMs: sorted[Math.floor(count / 2)] ?? 0 };
  }
  scalarDiagnostics(values: Float64Array) {
    const m = this.mask;
    let mass = 0, x = 0, y = 0, z = 0, occupied = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], v = values[i];
      mass += v; x += v * (i % m.nx); y += v * (Math.floor(i / m.nx) % m.ny);
      z += v * Math.floor(i / (m.nx * m.ny));
      if (v > 1e-8) occupied++;
    }
    x /= Math.max(1e-30, mass); y /= Math.max(1e-30, mass); z /= Math.max(1e-30, mass);
    let variance = 0;
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], dx = i % m.nx - x;
      const dy = Math.floor(i / m.nx) % m.ny - y;
      const dz = Math.floor(i / (m.nx * m.ny)) - z;
      variance += values[i] * (dx * dx + dy * dy + dz * dz);
    }
    return { mass, variance: variance / Math.max(1e-30, mass),
      occupiedFraction: occupied / Math.max(1, m.activeCount) };
  }
}
