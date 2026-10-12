import * as THREE from "three";
import { LiquidMask } from "./tubeVolumeField";

/** Amounts are stored per voxel; activities use the mean wet-voxel amount as unit. */
export function precipitatePair(a: number, b: number, wetCells: number, ksp: number, dt: number,
  existingSolid = 0) {
  if (a <= 0 || b <= 0 || wetCells <= 0) return 0;
  const concentrationA = a * wetCells, concentrationB = b * wetCells;
  const saturation = concentrationA * concentrationB / ksp;
  if (saturation <= 1) return 0;
  const equilibrium = (concentrationA + concentrationB
    - Math.sqrt((concentrationA - concentrationB) ** 2 + 4 * ksp)) * 0.5 / wetCells;
  const rate = (existingSolid > 0 ? 60 : 42) * (saturation - 1) / (saturation + 3);
  return Math.min(a, b, Math.max(0, equilibrium) * (1 - Math.exp(-rate * dt)));
}

/** Conservative gravity slip. A dry face deposits only where it meets the rounded floor. */
export function settleParticleClass(mask: LiquidMask, values: Float64Array, scratch: Float64Array,
  up: THREE.Vector3, dt: number, slip: number, deposit: (column: number, mass: number) => void) {
  scratch.set(values);
  const spacing = [2 * mask.radius / mask.nx, mask.height / mask.ny, 2 * mask.radius / mask.nz];
  const stride = [1, mask.nx, mask.nx * mask.ny];
  for (let n = 0; n < mask.activeCount; n++) {
    const i = mask.active[n];
    const x = i % mask.nx, y = Math.floor(i / mask.nx) % mask.ny;
    const z = Math.floor(i / (mask.nx * mask.ny));
    const coords = [x, y, z], limits = [mask.nx, mask.ny, mask.nz];
    const radial = Math.hypot(mask.point(x, y, z).x, mask.point(x, y, z).z);
    const floor = mask.bottom + mask.radius - Math.sqrt(Math.max(0, mask.radius ** 2 - radial ** 2));
    for (let axis = 0; axis < 3; axis++) {
      const velocity = -slip * up.getComponent(axis);
      if (velocity === 0) continue;
      const sign = Math.sign(velocity);
      const neighbor = coords[axis] + sign;
      const fraction = Math.min(0.3, Math.abs(velocity) * dt / spacing[axis]);
      if (neighbor >= 0 && neighbor < limits[axis] && mask.data[i + sign * stride[axis]]) {
        const j = i + sign * stride[axis];
        const moved = Math.min(scratch[i], values[i] * fraction);
        scratch[i] -= moved; scratch[j] += moved;
      } else if (axis === 1 && sign < 0 && mask.point(x, y, z).y - floor < spacing[1] * 1.6) {
        const moved = Math.min(scratch[i], values[i] * fraction);
        scratch[i] -= moved; deposit(z * mask.nx + x, moved);
      }
    }
  }
  values.set(scratch);
}
