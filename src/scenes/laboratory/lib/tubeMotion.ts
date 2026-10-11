import * as THREE from "three";

/** Samples the actual tube world transform. Small tracking jitter is ignored. */
export class TubeMotion {
  private readonly position = new THREE.Vector3();
  private readonly previous = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly previousVelocity = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly previousRotation = new THREE.Quaternion();
  private readonly deltaRotation = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  readonly impulse = new THREE.Vector3();
  intensity = 0;
  private ready = false;

  sample(object: THREE.Object3D, dt: number) {
    if (dt <= 0) return this.intensity;
    object.getWorldPosition(this.position);
    object.getWorldQuaternion(this.rotation);
    if (dt > 0.2) {
      this.previous.copy(this.position); this.previousVelocity.set(0, 0, 0);
      this.previousRotation.copy(this.rotation); this.impulse.set(0, 0, 0);
      this.intensity = 0; this.ready = true;
      return 0;
    }
    if (!this.ready) {
      this.previous.copy(this.position); this.previousRotation.copy(this.rotation);
      this.ready = true; return 0;
    }
    this.velocity.subVectors(this.position, this.previous).divideScalar(dt);
    this.impulse.subVectors(this.velocity, this.previousVelocity).divideScalar(dt);
    this.deltaRotation.copy(this.previousRotation).invert().multiply(this.rotation);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(this.deltaRotation.w)));
    this.axis.set(this.deltaRotation.x, this.deltaRotation.y, this.deltaRotation.z);
    const angularSpeed = angle / dt;
    const acceleration = this.impulse.length();
    const shake = Math.max(0, acceleration - 0.35) * 0.18
      + Math.max(0, angularSpeed - 1.5) * 0.12;
    this.intensity += (Math.min(1, shake) - this.intensity) * (1 - Math.exp(-dt / 0.12));
    this.impulse.clampLength(0, 8).multiplyScalar(this.intensity / 8);
    this.previous.copy(this.position); this.previousVelocity.copy(this.velocity);
    this.previousRotation.copy(this.rotation);
    return this.intensity;
  }
}
