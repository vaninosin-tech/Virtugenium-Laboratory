/** Normalized liquid temperature on a coarse cylindrical grid. Zero is room temperature. */
export class TemperatureField {
  readonly nx = 8;
  readonly ny = 16;
  readonly nz = 8;
  readonly values = new Float32Array(this.nx * this.ny * this.nz);
  private readonly next = new Float32Array(this.values.length);
  private readonly cells: number[] = [];
  private readonly weights = new Float32Array(this.values.length);
  mean = 0;
  hotX = 0;
  hotZ = 0;
  contrast = 0;

  constructor(initial = 0) {
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++)
      for (let x = 0; x < this.nx; x++) {
        const X = (x + 0.5) / this.nx * 2 - 1;
        const Z = (z + 0.5) / this.nz * 2 - 1;
        if (X * X + Z * Z < 1) this.cells.push((z * this.ny + y) * this.nx + x);
      }
    this.setUniform(initial);
  }

  setUniform(value: number) {
    this.mean = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    for (const i of this.cells) this.values[i] = this.mean;
    this.hotX = this.hotZ = this.contrast = 0;
  }

  /** Heat enters at the bottom glass. `side` shifts the contact across its diameter. */
  advance(dt: number, power: number, side: number, riseSeconds: number, coolSeconds: number) {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    if (!dt) return;
    power = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
    side = Math.max(-1, Math.min(1, Number.isFinite(side) ? side : 0));
    const { nx, ny, nz, values, next } = this;
    let weightSum = 0;
    if (power > 0) for (const i of this.cells) {
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      const X = (x + 0.5) / nx * 2 - 1;
      const Z = (z + 0.5) / nz * 2 - 1;
      const w = Math.exp(-((X - side * 0.62) ** 2 + Z * Z) * 6 - (y / ny) ** 2 * 18);
      this.weights[i] = w;
      weightSum += w;
    }
    // Diffusion is conservative within the liquid. A small wall loss cools
    // the boundary first; the final normalization sets the calibrated mean.
    for (const i of this.cells) {
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      let sum = 0, count = 0;
      for (const j of [x ? i - 1 : -1, x + 1 < nx ? i + 1 : -1,
        y ? i - nx : -1, y + 1 < ny ? i + nx : -1,
        z ? i - nx * ny : -1, z + 1 < nz ? i + nx * ny : -1]) {
        if (j < 0 || !this.inside(j)) continue;
        sum += values[j] - values[i]; count++;
      }
      const wall = (6 - count) * (power > 0 ? 0 : 0.018) * dt * values[i];
      next[i] = Math.max(0, values[i] + sum * 0.9 * dt - wall
        + (power > 0 ? this.weights[i] * dt * this.cells.length / weightSum * power / riseSeconds : 0));
    }
    const target = Math.max(0, Math.min(1, this.mean + (power > 0 ? power * dt / riseSeconds : -dt / coolSeconds)));
    let rawMean = 0;
    for (const i of this.cells) rawMean += next[i];
    rawMean /= this.cells.length;
    let deviationMin = 0, deviationMax = 0;
    for (const i of this.cells) {
      deviationMin = Math.min(deviationMin, next[i] - rawMean);
      deviationMax = Math.max(deviationMax, next[i] - rawMean);
    }
    const scale = Math.min(1,
      deviationMax > 0 ? (1 - target) / deviationMax : 1,
      deviationMin < 0 ? target / -deviationMin : 1);
    let max = 0, weightedX = 0, weightedZ = 0, excess = 0;
    for (const i of this.cells) {
      const value = target + (next[i] - rawMean) * scale;
      values[i] = value;
      max = Math.max(max, value);
      const above = Math.max(0, value - target);
      weightedX += ((i % nx + 0.5) / nx * 2 - 1) * above;
      weightedZ += ((Math.floor(i / (nx * ny)) + 0.5) / nz * 2 - 1) * above;
      excess += above;
    }
    let actual = 0;
    for (const i of this.cells) actual += values[i];
    this.mean = actual / this.cells.length;
    this.hotX = excess ? weightedX / excess : 0;
    this.hotZ = excess ? weightedZ / excess : 0;
    this.contrast = Math.max(0, max - this.mean);
  }

  private inside(i: number) {
    const x = (i % this.nx + 0.5) / this.nx * 2 - 1;
    const z = (Math.floor(i / (this.nx * this.ny)) + 0.5) / this.nz * 2 - 1;
    return x * x + z * z < 1;
  }
}
