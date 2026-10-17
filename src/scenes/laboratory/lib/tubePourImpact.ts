import * as THREE from "three";
import { deliver, STANDARD_POUR_ML } from "./tubeAmounts";
import { POUR_MS } from "./useStandMotionStore";

export interface TubePourImpact {
  reagentId: string;
  point: THREE.Vector3;
  direction: THREE.Vector3;
  flowMlPerSecond: number;
  deliveredMl: number;
  serial: number;
}
const impacts = new Map<string, TubePourImpact>();
export const tubePourImpact = (id: string) => impacts.get(id);
export function publishTubePourImpact(tubeId: string, reagentId: string,
  point: THREE.Vector3, direction: THREE.Vector3, flowMlPerSecond: number,
  ml: number, serial: number) {
  const accepted = deliver(tubeId, reagentId, ml);
  const previous = impacts.get(tubeId);
  impacts.set(tubeId, { reagentId, point: point.clone(), direction: direction.clone(),
    flowMlPerSecond, deliveredMl: (previous?.serial === serial ? previous.deliveredMl : 0) + accepted, serial });
  return accepted;
}
/** Fixed click portion, integrated from the existing stream's thickness envelope. */
export function pourFraction(k: number) {
  const rise = THREE.MathUtils.smoothstep(k, 0.35, 0.44);
  const fade = 1 - THREE.MathUtils.smoothstep(k, 0.69, 0.76);
  return Math.min(rise, fade);
}
const integral = (() => {
  const values = new Float64Array(1025);
  for (let i = 1; i < values.length; i++) values[i] = values[i - 1]
    + (pourFraction((i - 0.5) / 1024) ** 2) / 1024;
  return values;
})();
export function pouredMl(k: number) {
  if (k <= 0.35) return 0;
  if (k >= 0.76) return STANDARD_POUR_ML;
  const x = THREE.MathUtils.clamp(k, 0, 1) * 1024;
  const i = Math.min(1023, Math.floor(x));
  return STANDARD_POUR_ML * THREE.MathUtils.lerp(integral[i], integral[i + 1], x - i) / integral[1024];
}
/** Instantaneous rate corresponding to pouredMl, in actual millilitres per second. */
export function pourFlowMlPerSecond(k: number) {
  return STANDARD_POUR_ML * pourFraction(k) ** 2 / (integral[1024] * (POUR_MS / 1000));
}
export function clearTubePourImpact(tubeId: string) { impacts.delete(tubeId); }
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __tubePourImpact?: typeof tubePourImpact }).__tubePourImpact = tubePourImpact;
