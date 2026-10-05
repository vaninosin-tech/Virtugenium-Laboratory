import * as THREE from "three";

/** A conservative two-dimensional dye/tracer field in a tube cross section. */
export class TubeMixingField {
  readonly width = 32;
  readonly height = 96;
  readonly dye = new Float32Array(this.width * this.height);
  readonly tracer = new Float32Array(this.width * this.height);
  readonly texture: THREE.DataTexture;
  private readonly pixels = new Uint8Array(this.width * this.height * 4);
  private readonly next = new Float32Array(this.width * this.height);
  private accumulator = 0;
  private elapsed = 0;
  private injecting = false;
  private active = false;

  constructor() {
    this.texture = new THREE.DataTexture(this.pixels, this.width, this.height, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.pixels.fill(0);
  }

  /** Starts a 1.3 s inlet pulse. The channels share transport, but remain optically distinct. */
  start(dyed: boolean) {
    this.dye.fill(0);
    this.tracer.fill(0);
    this.elapsed = 0;
    this.accumulator = 0;
    this.injecting = true;
    this.active = true;
    this.dyed = dyed;
    this.writeTexture();
  }

  private dyed = false;

  /** Mass-preserving edge fluxes; transport stops after the transient has homogenized. */
  advance(dt: number, fill: number) {
    if (!this.active) return;
    this.accumulator += Math.min(dt, 0.1);
    const step = 1 / 30;
    while (this.accumulator >= step) {
      this.accumulator -= step;
      this.elapsed += step;
      const injecting = this.injecting && this.elapsed < 1.3;
      if (!injecting) this.injecting = false;
      const yTop = Math.max(1, Math.min(this.height - 2, Math.floor(fill * (this.height - 1))));
      if (injecting) {
        // A narrow inlet near the wall, with a little irregularity from the
        // incoming trickle. All injected mass remains in the model.
        const field = this.dyed ? this.dye : this.tracer;
        const pulse = Math.floor(this.elapsed * 5.5) % 4;
        const branches = this.dyed && this.elapsed > 0.32 ? 3 : 1;
        for (let branch = 0; branch < branches; branch++) {
          const x = Math.min(this.width - 2, Math.floor(this.width *
            ([0.70, 0.38, 0.82][branch] + 0.025 * Math.sin(this.elapsed * 19 + branch * 2.3))));
          const y = Math.max(2, yTop - [0, 3, 7][branch] - [0, 2, 1, 4][pulse]);
          field[y * this.width + x] += step * 1.2 / branches;
        }
      }
      this.transport(this.dye, yTop, 0.10);
      this.transport(this.dye, yTop, 0.10);
      this.transport(this.tracer, yTop, 0.045);
      this.transport(this.tracer, yTop, 0.045);
      if (this.elapsed > 12) {
        this.active = false;
      }
    }
    this.writeTexture();
  }

  private transport(field: Float32Array, yTop: number, sinking: number) {
    this.next.set(field);
    const w = this.width;
    // Finite-volume fluxes. The stream function psi = -A sin(pi*x)sin(pi*y)
    // gives a downward wall current and an upward return current. Its curl
    // is divergence free; each shared face transfers the same amount between
    // cells, so no dye is created by the flow.
    const amplitude = 0.10 * Math.exp(-this.elapsed * 0.22);
    for (let y = 1; y <= yTop; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (x < w - 2) {
        const j = i + 1;
        const xn = (x - 0.5) / (w - 2);
        const yn = (y - 0.5) / yTop;
        const velocity = -amplitude * Math.PI * Math.sin(Math.PI * xn) * Math.cos(Math.PI * yn);
        const flux = velocity * (velocity > 0 ? field[i] : field[j])
          + (field[i] - field[j]) * 0.006;
        this.next[i] -= flux; this.next[j] += flux;
      }
      if (y > 1) {
        const j = i - w;
        const xn = (x - 1) / (w - 3);
        const yn = (y - 1) / yTop;
        const circulation = amplitude * Math.PI * Math.cos(Math.PI * xn) * Math.sin(Math.PI * yn);
        const eddy = 0.075 * Math.sin(x * 0.67 + y * 0.39 + this.elapsed * 3.4)
          * Math.sin(y * 0.19 - this.elapsed * 2.1);
        const downward = circulation + eddy < 0 ? -circulation - eddy + sinking : sinking * 0.15;
        const upward = circulation + eddy > 0 ? circulation + eddy : 0;
        const flux = downward * field[i] - upward * field[j] + (field[i] - field[j]) * 0.006;
        this.next[i] -= flux; this.next[j] += flux;
      }
    }
    field.set(this.next);
  }

  private writeTexture() {
    for (let i = 0; i < this.dye.length; i++) {
      const p = i * 4;
      // The physical field can fold a tiny clear island inside a dense eddy.
      // Blur only its optical upload: the conservative simulation and its
      // mass stay unchanged, while the projected plume has a filled core.
      let opticalDye = this.dye[i];
      if (this.dyed) {
        const x = i % this.width, y = Math.floor(i / this.width);
        let sum = 0, weight = 0;
        for (let dy = -4; dy <= 4; dy++) {
          const sy = Math.max(0, Math.min(this.height - 1, y + dy));
          for (let dx = -4; dx <= 4; dx++) {
            const sx = Math.max(0, Math.min(this.width - 1, x + dx));
            const w = 1 / (1 + dx * dx * 0.45 + dy * dy * 0.45);
            sum += this.dye[sy * this.width + sx] * w;
            weight += w;
          }
        }
        opticalDye = Math.max(opticalDye, sum / weight * 0.9);
      }
      this.pixels[p] = Math.min(255, opticalDye * 30000);
      this.pixels[p + 1] = Math.min(255, this.tracer[i] * 30000);
      this.pixels[p + 2] = 0;
      this.pixels[p + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }

  get running() { return this.active; }
  get age() { return this.elapsed; }
  totalMass(channel: "dye" | "tracer" = "dye") {
    return (channel === "dye" ? this.dye : this.tracer).reduce((sum, value) => sum + value, 0);
  }
  variance(channel: "dye" | "tracer" = "dye") {
    const field = channel === "dye" ? this.dye : this.tracer;
    const mean = this.totalMass(channel) / field.length;
    return field.reduce((sum, value) => sum + (value - mean) ** 2, 0) / field.length;
  }
  centerOfMassHeight(channel: "dye" | "tracer" = "dye") {
    const field = channel === "dye" ? this.dye : this.tracer;
    let weighted = 0;
    let mass = 0;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const value = field[y * this.width + x];
      weighted += y * value;
      mass += value;
    }
    return mass > 0 ? weighted / mass : 0;
  }
  concentratedTracerPoint(seed: number): { x: number; y: number; concentration: number } {
    let best = { x: 0.85, y: 0.85, concentration: 0 };
    for (let j = 0; j < 24; j++) {
      const x = 1 + ((seed * 13 + j * 17) % (this.width - 2));
      const y = 1 + ((seed * 29 + j * 37) % (this.height - 2));
      const concentration = this.tracer[y * this.width + x];
      if (concentration > best.concentration) best = {
        x: (x + 0.5) / this.width,
        y: (y + 0.5) / this.height,
        concentration,
      };
    }
    return best;
  }
  dispose() { this.texture.dispose(); }
}
