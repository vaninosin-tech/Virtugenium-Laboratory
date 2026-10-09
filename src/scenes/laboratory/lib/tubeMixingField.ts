import * as THREE from "three";

function dyeNoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const low = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx;
  const high = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx;
  return low * (1 - sy) + high * sy;
}

function smoothDye(value: number, low: number, high: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

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
  private precipitate: "silver" | "barium" | null = null;

  constructor() {
    this.texture = new THREE.DataTexture(this.pixels, this.width, this.height, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.pixels.fill(0);
  }

  /** Starts a 1.3 s inlet pulse. The channels share transport, but remain optically distinct. */
  start(dyed: boolean, precipitate: "silver" | "barium" | null = null) {
    this.dye.fill(0);
    this.tracer.fill(0);
    this.elapsed = 0;
    this.accumulator = 0;
    this.injecting = true;
    this.active = true;
    this.dyed = dyed;
    this.precipitate = precipitate;
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
          if (this.precipitate === "barium") {
            // Nucleation spreads around the incoming jet rather than tracing
            // a one-cell line. Each deposited puff is then advected below.
            for (let dy = -3; dy <= 3; dy++) for (let dx = -5; dx <= 5; dx++) {
              const sx = Math.max(1, Math.min(this.width - 2, x + dx));
              const sy = Math.max(1, Math.min(yTop, y + dy));
              field[sy * this.width + sx] += step * 0.22
                * Math.exp(-dx * dx / 9 - dy * dy / 3);
            }
          } else field[y * this.width + x] += step * 1.2 / branches;
        }
      }
      this.transport(this.dye, yTop, 0.10);
      this.transport(this.dye, yTop, 0.10);
      const tracerSinking = this.precipitate === "barium" ? 0.62
        : this.precipitate === "silver" ? 0.48 : 0.045;
      this.transport(this.tracer, yTop, tracerSinking);
      this.transport(this.tracer, yTop, tracerSinking);
      if (this.elapsed > 12) {
        this.active = false;
      }
    }
    // Optical dye is fully bleached by 3 s; keep conserving its simulated
    // mass, but stop rebuilding a texture that can no longer be seen.
    if (!this.dyed || this.elapsed < 3.1) this.writeTexture();
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
        const eddy = this.dyed && field === this.dye
          ? 0.15 * (dyeNoise(x * 0.12 + this.elapsed * 0.32, y * 0.085 - this.elapsed * 0.21) - 0.5)
            + 0.07 * (dyeNoise(x * 0.28 - this.elapsed * 0.18, y * 0.19 + 6.7) - 0.5)
          : 0.075 * Math.sin(x * 0.67 + y * 0.39 + this.elapsed * 3.4)
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
    const sampleDye = (x: number, y: number) => {
      const sx = Math.max(0, Math.min(this.width - 1.001, x));
      const sy = Math.max(0, Math.min(this.height - 1.001, y));
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const fx = sx - ix, fy = sy - iy;
      const a = this.dye[iy * this.width + ix] * (1 - fx)
        + this.dye[iy * this.width + ix + 1] * fx;
      const b = this.dye[(iy + 1) * this.width + ix] * (1 - fx)
        + this.dye[(iy + 1) * this.width + ix + 1] * fx;
      return a * (1 - fy) + b * fy;
    };
    for (let i = 0; i < this.dye.length; i++) {
      const p = i * 4;
      let opticalDye = this.dye[i];
      if (this.dyed) {
        const x = i % this.width, y = Math.floor(i / this.width);
        // Warp the transported concentration, then break only its optical
        // edge into folds and fine threads. The simulation retains its mass.
        const coarseX = dyeNoise(x * 0.085 + 3.7, y * 0.062 + 1.9);
        const coarseY = dyeNoise(x * 0.071 + 12.1, y * 0.054 + 5.3);
        const fold = dyeNoise(x * 0.19 + 7.4, y * 0.13 + 11.8);
        const fiber = dyeNoise(x * 0.47 + 2.8, y * 0.31 + 6.2);
        const warped = sampleDye(x + (coarseX - 0.5) * 4.2 + (fold - 0.5) * 1.2,
          y + (coarseY - 0.5) * 3.1);
        const concentration = warped * 900;
        const edge = 0.13 + (1 - fold) * 0.28 + (1 - fiber) * 0.08;
        const ribbon = (center: number, seed: number, width: number) => {
          const bend = (dyeNoise(y * 0.065 + seed, this.elapsed * 0.24 + seed * 1.7) - 0.5) * 0.15
            + (dyeNoise(y * 0.17 + seed * 2.1, this.elapsed * 0.31 + 7.3) - 0.5) * 0.055;
          const radius = width * (0.73 + 0.65 * dyeNoise(y * 0.11 + seed * 3.4, 2.8));
          const distance = (x / (this.width - 1) - center - bend) / radius;
          return Math.exp(-distance * distance * 1.35);
        };
        const tongues = Math.max(
          ribbon(0.70, 1.3, 0.13),
          ribbon(0.38, 4.7, 0.085) * smoothDye(this.elapsed, 0.26, 0.55)
            * smoothDye(dyeNoise(y * 0.18 + 3.1, this.elapsed * 0.21 + 1.2), 0.29, 0.67),
          ribbon(0.82, 8.1, 0.055) * smoothDye(this.elapsed, 0.48, 0.85)
            * smoothDye(dyeNoise(y * 0.23 + 9.7, this.elapsed * 0.16 + 4.5), 0.35, 0.72),
        );
        const threads = 0.70 + 0.30 * fiber;
        opticalDye = smoothDye(concentration, edge, edge + 0.63) * tongues * threads;
      }
      this.pixels[p] = Math.min(255, opticalDye * (this.dyed ? 255 : 30000));
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
