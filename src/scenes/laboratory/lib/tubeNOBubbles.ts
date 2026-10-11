import * as THREE from "three";
import type { VelocityField } from "./tubeVolumeField";
import { TUBE_SIMULATION } from "./tubeSimulationConfig";

const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const NO_BUBBLE_CAPACITY = TUBE_SIMULATION.bubbles.capacity;

/** A fixed pool of visible samples of the NO flux, stepped in elapsed time. */
export class TubeNOBubbles {
  readonly capacity = NO_BUBBLE_CAPACITY;
  readonly state = new Uint8Array(this.capacity); // 0 free, 1 attached, 2 rising
  readonly x = new Float32Array(this.capacity);
  readonly y = new Float32Array(this.capacity);
  readonly z = new Float32Array(this.capacity);
  readonly size = new Float32Array(this.capacity);
  readonly age = new Float32Array(this.capacity);
  readonly growTime = new Float32Array(this.capacity);
  readonly site = new Uint16Array(this.capacity);
  private accumulator = 0;
  private serial = 0;
  private next = 0;
  private readonly velocityScratch = new THREE.Vector3();
  born = 0;
  popped = 0;
  activeRising = 0;

  reset() {
    this.state.fill(0);
    this.accumulator = this.serial = this.next = this.born = this.popped = this.activeRising = 0;
  }

  /** source positions are actual wetted vertices supplied by the caller. */
  advance(dt: number, noSource: number, wettedArea: number, sources: readonly THREE.Vector3[],
    up: THREE.Vector3, level: number, center: THREE.Vector3, radius: number,
    velocity?: VelocityField, time = 0, onPop?: (x: number, z: number, size: number) => void) {
    const boundedDt = Math.max(0, Math.min(dt, 0.25));
    // Visible events sample chemical flux, with area modulating the number
    // of active surface sites. The fractional remainder survives frame splits.
    this.accumulator += Math.max(0, noSource) * TUBE_SIMULATION.bubbles.samplesPerNO * Math.sqrt(Math.max(0, wettedArea));
    const births = Math.min(32, Math.floor(this.accumulator + 1e-9));
    this.accumulator = Math.max(0, this.accumulator - births);
    for (let b = 0; b < births && sources.length; b++) {
      let slot = -1;
      for (let n = 0; n < this.capacity; n++) {
        const candidate = (this.next + n) % this.capacity;
        if (this.state[candidate] === 0) { slot = candidate; this.next = (candidate + 1) % this.capacity; break; }
      }
      if (slot < 0) break;
      const serial = this.serial++;
      const site = Math.floor(rand(serial + 19) * sources.length);
      const p = sources[site];
      this.state[slot] = 1; this.site[slot] = site;
      this.x[slot] = p.x; this.y[slot] = p.y; this.z[slot] = p.z;
      this.size[slot] = radius * (0.05 + Math.pow(rand(serial + 47), 2.5) * 0.08);
      this.growTime[slot] = TUBE_SIMULATION.bubbles.attachedSeconds[0]
        + rand(serial + 61) * (TUBE_SIMULATION.bubbles.attachedSeconds[1] - TUBE_SIMULATION.bubbles.attachedSeconds[0]);
      this.age[slot] = 0; this.born++;
    }
    this.activeRising = 0;
    for (let i = 0; i < this.capacity; i++) {
      const state = this.state[i];
      if (!state) continue;
      this.age[i] += boundedDt;
      if (state === 1) {
        // The copper mesh moves and shrinks with the reaction.
        const p = sources[this.site[i]];
        if (p) { this.x[i] = p.x; this.y[i] = p.y; this.z[i] = p.z; }
        if (this.age[i] >= this.growTime[i]) { this.state[i] = 2; this.age[i] = 0; }
        continue;
      }
      this.activeRising++;
      const size = this.size[i];
      const speed = 0.018 + 0.095 * Math.sqrt(size / radius);
      const flow = velocity?.at(this.x[i] - center.x, this.y[i], this.z[i] - center.z, time);
      this.velocityScratch.set(flow?.[0] ?? 0, flow?.[1] ?? 0, flow?.[2] ?? 0);
      this.x[i] += (up.x * speed + this.velocityScratch.x) * boundedDt;
      this.y[i] += (up.y * speed + this.velocityScratch.y) * boundedDt;
      this.z[i] += (up.z * speed + this.velocityScratch.z) * boundedDt;
      const dx = this.x[i] - center.x, dz = this.z[i] - center.z;
      const radial = Math.hypot(dx, dz);
      const limit = radius * 0.87 - size;
      if (radial > limit) {
        const scale = limit / radial;
        this.x[i] = center.x + dx * scale; this.z[i] = center.z + dz * scale;
      }
      if (up.x * this.x[i] + up.y * this.y[i] + up.z * this.z[i] >= level - size) {
        this.state[i] = 0; this.activeRising--; this.popped++;
        onPop?.(this.x[i], this.z[i], size);
      }
    }
  }
}
