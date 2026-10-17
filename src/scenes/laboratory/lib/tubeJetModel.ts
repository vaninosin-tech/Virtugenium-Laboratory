import * as THREE from "three";
import type { LiquidMask } from "./tubeVolumeField";
import type { SurfaceSpread } from "./tubeFlowSolver";

export interface SilverJetOptions {
  flow?: number;
  speed?: number;
  radius?: number;
  entrainment?: number;
  penetration?: number;
}

/** A force distribution, not a second liquid or scalar source. */
export class TubeJetModel {
  readonly source: Float32Array;
  readonly momentum = new Float64Array(3);
  readonly appliedMomentum = new Float64Array(3);
  readonly faceCount = new Int32Array(3);
  readonly weights: Float64Array;
  readonly spacing: readonly number[];
  penetration = 0;
  entrainmentFlux = 0;
  speed = 0;
  constructor(readonly mask: LiquidMask) {
    this.source = new Float32Array(mask.data.length * 3);
    this.weights = new Float64Array(mask.data.length);
    this.spacing = [2 * mask.radius / mask.nx, mask.height / mask.ny, 2 * mask.radius / mask.nz];
  }
  prepare(dt: number, inlet: THREE.Vector3, direction: THREE.Vector3,
    surface: SurfaceSpread, options: SilverJetOptions = {}) {
    this.source.fill(0); this.momentum.fill(0); this.appliedMomentum.fill(0); this.faceCount.fill(0);
    const m = this.mask;
    const radius = Math.max(0.0005, Math.min(0.003, options.radius ?? 0.00115));
    const entrainment = Math.max(0, Math.min(0.2, options.entrainment ?? 0.08));
    const flow = Math.max(0, options.flow ?? surface.flow);
    this.speed = Math.max(0, Math.min(1.5, options.speed ?? Math.max(0.25, flow / (Math.PI * radius * radius))));
    // The potential core spans several jet radii. The falling jet broadens and shares
    // momentum with an increasing liquid volume; the axial momentum is conserved.
    this.penetration = Math.min(Math.max(0, inlet.y - m.bottom),
      Math.max(radius, Math.min(0.018, options.penetration ?? (12 * radius + 2 * radius * this.speed))));
    this.entrainmentFlux = flow * (1 + 2 * entrainment * this.penetration / radius);
    if (!(flow > 0 && dt > 0 && this.penetration > 0)) return;
    const d = direction.clone().normalize();
    const cellVolume = this.spacing[0] * this.spacing[1] * this.spacing[2];
    const axis = [d.x, d.y, d.z];
    for (let k = 0; k < 3; k++) this.momentum[k] = 1000 * flow * this.speed * axis[k];
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
        if (depth < -this.spacing[1] || depth > this.penetration) continue;
        const along = Math.max(0, depth);
        const cx = inlet.x + along * d.x / Math.max(0.2, -d.y);
        const cz = inlet.z + along * d.z / Math.max(0.2, -d.y);
        // The 1.15 mm core is subcell. Spread its force over a resolvable
        // kernel while retaining the physical radius in the entrainment law.
        const width = Math.max(radius + entrainment * along, 3.5 * Math.max(this.spacing[0], this.spacing[2]));
        const r2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
        const w = Math.exp(-r2 / (width * width)) / (1 + 2 * entrainment * along / radius);
        this.weights[i] = w; sum += w; this.faceCount[k]++;
      }
      if (sum === 0) continue;
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
