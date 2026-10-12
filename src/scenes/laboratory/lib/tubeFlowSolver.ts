import * as THREE from "three";
import { LiquidMask } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";

/** Closed, staggered 3D liquid flow. A face exists only between two wet cells. */
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
  constructor(readonly mask: LiquidMask, readonly options: { lowDiffusion?: boolean } = {}) {
    const n = mask.data.length;
    for (let axis = 0; axis < 3; axis++) this.faces[axis] = new Float32Array(n);
    this.previousFaces = Array.from({ length: 3 }, () => new Float32Array(n));
    this.flow = new Float32Array(n * 3);
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
  private neighbor(i: number, axis: number, sign: number) {
    return this.adjacent[axis * 2 + (sign > 0 ? 1 : 0)][i];
  }
  /** Adds momentum at the impact only, then transports, damps and projects the entire velocity. */
  step(dt: number, inlet: THREE.Vector3, direction: THREE.Vector3, impulse: number,
    agitation = 0, background?: (x: number, y: number, z: number) => ArrayLike<number>) {
    const started = typeof performance !== "undefined" ? performance.now() : 0;
    const m = this.mask, old = this.previousFaces;
    for (let axis = 0; axis < 3; axis++) old[axis].set(this.faces[axis]);
    const d = this.direction.copy(direction).normalize();
    const width2 = (m.radius * 0.32) ** 2;
    const damp = Math.exp(-dt * (TUBE_SIMULATION.jetFlow.viscousDamping + agitation * 0.2));
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a];
      const x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny));
      const p = m.point(x, y, z, this.scratch);
      const distance2 = p.distanceToSquared(inlet);
      const source = Math.exp(-distance2 / width2) * impulse;
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
        this.faces[axis][i] = Math.max(-0.09, Math.min(0.09,
          (advected + dt * TUBE_SIMULATION.jetFlow.molecularDiffusivity * laplace) * damp
          + source * d.getComponent(axis)
          + (ambient?.[axis] ?? 0) * dt * 0.15));
      }
    }
    this.project();
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
  private project() {
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
    for (let iteration = 0; iteration < TUBE_SIMULATION.jetFlow.pressureIterations; iteration++) {
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a]; let sum = 0;
        for (let axis = 0; axis < 3; axis++) {
          const left = this.adjacent[axis * 2][i], right = this.adjacent[axis * 2 + 1][i];
          const w = this.inverseSpacingSquared[axis];
          if (left >= 0) sum += p[left] * w;
          if (right >= 0) sum += p[right] * w;
        }
        p[i] = this.pressureWeight[i] ? (sum - this.divergence[i]) / this.pressureWeight[i] : 0;
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
  transport(values: Float64Array, dt: number, diffusivity: number) {
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
          + this.eddy[i] * (this.options.lowDiffusion ? 0.02 : 1)) * dt / this.spacing[axis] ** 2);
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
