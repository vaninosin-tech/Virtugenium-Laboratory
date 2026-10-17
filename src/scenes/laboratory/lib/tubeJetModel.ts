import * as THREE from "three";
import type { LiquidMask } from "./tubeVolumeField";
import type { SurfaceSpread } from "./tubeFlowSolver";

export interface SilverJetOptions {
  flow?: number;
  speed?: number;
  radius?: number;
  entrainment?: number;
  penetration?: number;
  ambientSpeed?: number;
  /** Experimental comparison with the wave-12 axial kernel. */
  distribution?: "legacy";
}

/** A force distribution, not a second liquid or scalar source. */
export class TubeJetModel {
  readonly source: Float32Array;
  readonly momentum = new Float64Array(3);
  readonly appliedMomentum = new Float64Array(3);
  readonly faceCount = new Int32Array(3);
  readonly blockedMomentum = new Float64Array(3);
  readonly weights: Float64Array;
  readonly spacing: readonly number[];
  penetration = 0;
  entrainmentFlux = 0;
  speed = 0;
  radius = 0;
  area = 0;
  flow = 0;
  constructor(readonly mask: LiquidMask) {
    this.source = new Float32Array(mask.data.length * 3);
    this.weights = new Float64Array(mask.data.length);
    this.spacing = [2 * mask.radius / mask.nx, mask.height / mask.ny, 2 * mask.radius / mask.nz];
  }
  prepare(dt: number, inlet: THREE.Vector3, direction: THREE.Vector3,
    surface: SurfaceSpread, options: SilverJetOptions = {}) {
    this.source.fill(0); this.momentum.fill(0); this.appliedMomentum.fill(0);
    this.blockedMomentum.fill(0); this.faceCount.fill(0);
    const m = this.mask;
    // PourStream's downstream ring (t=1) is 0.75 mm at full visual flow.
    // The ledger has no lip point or visual flow fraction, so the impact ring
    // is the reproducible stream-area convention, not a free-fall estimate.
    const legacy = options.distribution === "legacy";
    const radius = Math.max(0.0003, Math.min(0.003, options.radius ?? (legacy ? 0.00115 : 0.00075)));
    const entrainment = Math.max(0, Math.min(0.2, options.entrainment ?? 0.08));
    const flow = Math.max(0, options.flow ?? surface.flow);
    this.radius = radius; this.area = Math.PI * radius * radius; this.flow = flow;
    // Q [m3/s] / A [m2] = U [m/s]; rho Q U is force [N].
    this.speed = Math.max(0, options.speed ?? (legacy
      ? Math.max(0.25, Math.min(1.5, flow / this.area)) : flow / this.area));
    const d = direction.clone().normalize();
    const axis = [d.x, d.y, d.z];
    for (let k = 0; k < 3; k++) this.momentum[k] = 1000 * flow * this.speed * axis[k];
    // Find the bowl floor along this jet, rather than using the global bottom.
    // The hemisphere makes that floor substantially higher near the side wall.
    let floor = Infinity;
    const lateralReach = Math.max(radius + this.spacing[0], this.spacing[0] * 1.5);
    for (let a = 0; a < m.activeCount; a++) {
      const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
      const z = Math.floor(i / (m.nx * m.ny)), p = m.point(x, y, z);
      if (Math.hypot(p.x - inlet.x, p.z - inlet.z) <= lateralReach)
        floor = Math.min(floor, p.y - this.spacing[1] * 0.5);
    }
    const wetDepth = Number.isFinite(floor) ? Math.max(0, surface.level - floor) : 0;
    // Round-jet volume entrainment: Q(z)=Q0(1+2 alpha z/r0), with virtual
    // origin z0=r0/(2 alpha). Stop when core speed reaches the surrounding
    // speed plus a 0.05 m/s dissipative threshold, or at the actual floor.
    const ambient = Math.max(0, options.ambientSpeed ?? 0);
    const dynamicDepth = entrainment > 0
      ? radius / (2 * entrainment) * Math.max(0, this.speed / (ambient + 0.05) - 1)
      : wetDepth;
    this.penetration = Math.min(wetDepth, Math.max(0, options.penetration ?? (legacy ? 0.018 : dynamicDepth)));
    this.entrainmentFlux = flow * (1 + 2 * entrainment * this.penetration / radius);
    if (!(flow > 0 && dt > 0 && this.penetration > 0)) {
      this.blockedMomentum.set(this.momentum); return;
    }
    const cellVolume = this.spacing[0] * this.spacing[1] * this.spacing[2];
    for (let k = 0; k < 3; k++) {
      if (axis[k] === 0) continue;
      let sum = 0;
      this.weights.fill(0);
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a], x = i % m.nx, y = Math.floor(i / m.nx) % m.ny;
        const z = Math.floor(i / (m.nx * m.ny));
        const j = k === 0 ? i + 1 : k === 1 ? i + m.nx : i + m.nx * m.ny;
        if ((k === 0 && x + 1 === m.nx) || (k === 1 && y + 1 === m.ny)
          || (k === 2 && z + 1 === m.nz) || !m.data[j]) continue;
        const p = m.point(x, y, z);
        const depth = inlet.y - p.y;
        if (depth < -this.spacing[1] || depth > this.penetration + this.spacing[1] * 0.5) continue;
        const along = Math.max(0, depth);
        const cx = inlet.x + along * d.x / Math.max(0.2, -d.y);
        const cz = inlet.z + along * d.z / Math.max(0.2, -d.y);
        // The 1.15 mm core is subcell. Spread its force over a resolvable
        // kernel while retaining the physical radius in the entrainment law.
        const width = Math.max(radius + entrainment * along,
          (legacy ? 3.5 : 1.25) * Math.max(this.spacing[0], this.spacing[2]));
        const r2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
        // d[F0/(1+2 alpha z/r0)]/dz is the momentum handed to entrained
        // liquid. Its surviving core momentum is deposited at the wet floor.
        const factor = 1 + 2 * entrainment * along / radius;
        const distributed = (2 * entrainment / radius) * this.spacing[1] / (factor * factor);
        const atFloor = wetDepth <= this.penetration + this.spacing[1] * 0.5
          && along >= this.penetration - this.spacing[1] ? 1 / (1 + 2 * entrainment * this.penetration / radius) : 0;
        const w = Math.exp(-r2 / (width * width)) * (legacy ? 1 / factor : distributed + atFloor);
        this.weights[i] = w; sum += w; this.faceCount[k]++;
      }
      if (sum === 0) { this.blockedMomentum[k] = this.momentum[k]; continue; }
      const scale = flow * this.speed * dt * axis[k] / (cellVolume * sum);
      for (let a = 0; a < m.activeCount; a++) {
        const i = m.active[a];
        if (!this.weights[i]) continue;
        const velocity = this.weights[i] * scale;
        this.source[3 * i + k] = velocity;
        this.appliedMomentum[k] += 1000 * cellVolume * velocity / dt;
      }
    }
  }
}
