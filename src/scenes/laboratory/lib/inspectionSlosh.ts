/** Pure, frame-rate-independent inspection motion. Angles are radians. */
export const TILT_DURATION = 1.6;
export const SLOSH_DURATION = TILT_DURATION + 3;
/** Buttons unlock shortly after the deliberate bottle tilt ends; the subtle liquid tail may keep fading visually. */
export const SHAKE_CONTROL_LOCK_DURATION = TILT_DURATION + 0.2;
const KEYS = [0, 6, -6, 3, 0];
const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function inspectionTilt(time: number): number {
  if (time <= 0 || time >= TILT_DURATION) return 0;
  const segment = time / TILT_DURATION * 4;
  const i = Math.floor(segment);
  const t = segment - i;
  const ease = t * t * t * (t * (t * 6 - 15) + 10);
  return (KEYS[i] + (KEYS[i + 1] - KEYS[i]) * ease) * Math.PI / 180;
}

export class InspectionSlosh {
  elapsed = 0;
  angle = 0;
  velocity = 0;
  strength = 0;

  reset() { this.elapsed = this.angle = this.velocity = this.strength = 0; }

  advance(delta: number) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const end = Math.min(this.elapsed + delta, SLOSH_DURATION);
    // Bounded substeps keep the damped spring stable after a slow frame.
    while (this.elapsed < end) {
      const dt = Math.min(1 / 120, end - this.elapsed);
      this.elapsed += dt;
      const target = -inspectionTilt(this.elapsed);
      // Blend into free motion during the final return, avoiding a damping step.
      const release = smooth(Math.max(0, Math.min(1, (this.elapsed - TILT_DURATION + 0.4) / 0.4)));
      const damping = 11 + (4.8 - 11) * release;
      this.velocity += (144 * (target - this.angle) - damping * this.velocity) * dt;
      this.angle += this.velocity * dt;
      // Oscillator energy stays smooth at direction reversals; |velocity|
      // alone made the small ripples pulse twice during every oscillation.
      const energy = Math.hypot(this.velocity, 12 * this.angle);
      this.strength += (Math.min(1, energy * 0.5) - this.strength) * (1 - Math.exp(-6 * dt));
    }
  }

  get tilt() { return inspectionTilt(this.elapsed); }
  get done() { return this.elapsed >= SLOSH_DURATION; }
  get controlsUnlocked() { return this.elapsed >= SHAKE_CONTROL_LOCK_DURATION; }
  /** Smoothly reaches exact rest, with no residual displacement at unlock. */
  get settle() {
    const t = Math.max(0, Math.min(1, (SLOSH_DURATION - this.elapsed) / (SLOSH_DURATION - TILT_DURATION)));
    return smooth(t);
  }
}
